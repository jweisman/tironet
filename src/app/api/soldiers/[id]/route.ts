import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

const patchSchema = z.object({
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  rank: z.string().nullable().optional(),
  status: z.enum(["active", "transferred", "dropped", "injured"]).optional(),
  profileImage: z.string().nullable().optional(),
});

async function isSquadInScope(
  role: string,
  unitId: string,
  squadId: string
): Promise<boolean> {
  if (role === "squad_commander") {
    return unitId === squadId;
  }
  if (role === "platoon_commander") {
    const squad = await prisma.squad.findUnique({
      where: { id: squadId },
      select: { platoonId: true },
    });
    return squad?.platoonId === unitId;
  }
  if (role === "company_commander") {
    const squad = await prisma.squad.findUnique({
      where: { id: squadId },
      select: { platoon: { select: { companyId: true } } },
    });
    return squad?.platoon.companyId === unitId;
  }
  return true; // admin
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const soldier = await prisma.soldier.findUnique({
    where: { id },
    include: {
      squad: {
        select: {
          id: true,
          name: true,
          platoonId: true,
          platoon: { select: { id: true, name: true } },
        },
      },
      activityReports: {
        include: {
          activity: {
            select: {
              id: true,
              name: true,
              date: true,
              activityType: { select: { name: true } },
              status: true,
            },
          },
        },
        orderBy: { activity: { date: "desc" } },
      },
    },
  });

  if (!soldier) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Check scope
  if (!session.user.isAdmin) {
    const assignment = session.user.cycleAssignments.find(
      (a) => a.cycleId === soldier.cycleId
    );
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const inScope = await isSquadInScope(
      assignment.role,
      assignment.unitId,
      soldier.squadId
    );
    if (!inScope) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json(soldier);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  // Find existing soldier to check scope
  const existing = await prisma.soldier.findUnique({
    where: { id },
    select: { cycleId: true, squadId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!session.user.isAdmin) {
    const assignment = session.user.cycleAssignments.find(
      (a) => a.cycleId === existing.cycleId
    );
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const inScope = await isSquadInScope(
      assignment.role,
      assignment.unitId,
      existing.squadId
    );
    if (!inScope) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.givenName !== undefined)
    updateData.givenName = parsed.data.givenName.trim();
  if (parsed.data.familyName !== undefined)
    updateData.familyName = parsed.data.familyName.trim();
  if (parsed.data.rank !== undefined) updateData.rank = parsed.data.rank;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.profileImage !== undefined)
    updateData.profileImage = parsed.data.profileImage;

  const soldier = await prisma.soldier.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(soldier);
}
