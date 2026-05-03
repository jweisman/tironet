import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

const patchSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(["in_order", "deficiencies"]).optional(),
  notes: z.string().nullable().optional(),
});

function canEditDelete(role: string): boolean {
  const eRole = effectiveRole(role as Role);
  return eRole === "platoon_commander" || eRole === "company_commander";
}

async function isSoldierInScope(
  rawRole: string,
  unitId: string,
  squadId: string,
): Promise<boolean> {
  const role = effectiveRole(rawRole as Role);
  if (role === "squad_commander") return unitId === squadId;
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
  return false;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
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

  const existing = await prisma.homeVisit.findUnique({
    where: { id },
    select: { soldierId: true, soldier: { select: { cycleId: true, squadId: true } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const assignment = session.user.cycleAssignments.find(
    (a) => a.cycleId === existing.soldier.cycleId,
  );
  if (!assignment || !canEditDelete(assignment.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inScope = await isSoldierInScope(assignment.role, assignment.unitId, existing.soldier.squadId);
  if (!inScope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.date !== undefined) updateData.date = new Date(parsed.data.date + "T00:00:00.000Z");
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;

  const homeVisit = await prisma.homeVisit.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(homeVisit);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const existing = await prisma.homeVisit.findUnique({
    where: { id },
    select: { soldierId: true, soldier: { select: { cycleId: true, squadId: true } } },
  });
  if (!existing) {
    return new NextResponse(null, { status: 200 });
  }

  const assignment = session.user.cycleAssignments.find(
    (a) => a.cycleId === existing.soldier.cycleId,
  );
  if (!assignment || !canEditDelete(assignment.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inScope = await isSoldierInScope(assignment.role, assignment.unitId, existing.soldier.squadId);
  if (!inScope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.homeVisit.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
