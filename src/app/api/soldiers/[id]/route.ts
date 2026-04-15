import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { validateProfileImage } from "@/lib/api/validate-image";
import { effectiveRole } from "@/lib/auth/permissions";
import { toE164 } from "@/lib/phone";
import type { Role } from "@/types";

const patchSchema = z.object({
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  idNumber: z.string().nullable().optional(),
  civilianId: z.string().nullable().optional(),
  rank: z.string().nullable().optional(),
  status: z.enum(["active", "transferred", "dropped", "injured"]).optional(),
  profileImage: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  emergencyPhone: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  apt: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

async function isSquadInScope(
  rawRole: string,
  unitId: string,
  squadId: string
): Promise<boolean> {
  const role = effectiveRole(rawRole as Role);
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
        select: {
          id: true,
          result: true,
          grade1: true,
          grade2: true,
          grade3: true,
          grade4: true,
          grade5: true,
          grade6: true,
          note: true,
          activity: {
            select: {
              id: true,
              name: true,
              date: true,
              isRequired: true,
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

  // Active activities in the soldier's platoon with no report (missing gaps)
  const missingActivities = await prisma.activity.findMany({
    where: {
      platoonId: soldier.squad.platoonId,
      status: "active",
      isRequired: true,
      date: { lt: new Date() },
      reports: { none: { soldierId: soldier.id } },
    },
    select: {
      id: true,
      name: true,
      date: true,
      activityType: { select: { name: true } },
    },
    orderBy: { date: "desc" },
  });

  return NextResponse.json({ ...soldier, missingActivities });
}

export async function DELETE(
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
    select: { cycleId: true, squadId: true },
  });
  if (!soldier) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const assignment = session.user.cycleAssignments.find(
    (a) => a.cycleId === soldier.cycleId
  );
  if (!assignment) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const role = effectiveRole(assignment.role as Role);

  // Only platoon_commander and above can delete (matches activity deletion logic)
  if (role === "squad_commander") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inScope = await isSquadInScope(assignment.role, assignment.unitId, soldier.squadId);
  if (!inScope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Activity reports and requests cascade-delete via Prisma schema
  await prisma.soldier.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
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

  const imageError = validateProfileImage(parsed.data.profileImage);
  if (imageError) {
    return NextResponse.json({ error: imageError }, { status: 422 });
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.givenName !== undefined)
    updateData.givenName = parsed.data.givenName.trim();
  if (parsed.data.familyName !== undefined)
    updateData.familyName = parsed.data.familyName.trim();
  if (parsed.data.idNumber !== undefined) updateData.idNumber = parsed.data.idNumber;
  if (parsed.data.civilianId !== undefined) updateData.civilianId = parsed.data.civilianId;
  if (parsed.data.rank !== undefined) updateData.rank = parsed.data.rank;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.profileImage !== undefined)
    updateData.profileImage = parsed.data.profileImage;
  if (parsed.data.phone !== undefined) {
    if (parsed.data.phone) {
      const e164 = toE164(parsed.data.phone);
      if (!e164) return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 422 });
      updateData.phone = e164;
    } else {
      updateData.phone = null;
    }
  }
  if (parsed.data.emergencyPhone !== undefined) {
    if (parsed.data.emergencyPhone) {
      const e164 = toE164(parsed.data.emergencyPhone);
      if (!e164) return NextResponse.json({ error: "מספר טלפון חירום לא תקין" }, { status: 422 });
      updateData.emergencyPhone = e164;
    } else {
      updateData.emergencyPhone = null;
    }
  }
  if (parsed.data.street !== undefined) updateData.street = parsed.data.street;
  if (parsed.data.apt !== undefined) updateData.apt = parsed.data.apt;
  if (parsed.data.city !== undefined) updateData.city = parsed.data.city;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const soldier = await prisma.soldier.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(soldier);
}
