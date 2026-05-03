import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

const patchSchema = z.object({
  type: z.enum(["commendation", "discipline", "safety"]).optional(),
  subtype: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  description: z.string().min(1).optional(),
  response: z.string().nullable().optional(),
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

  const existing = await prisma.incident.findUnique({
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
  if (parsed.data.type !== undefined) updateData.type = parsed.data.type;
  if (parsed.data.subtype !== undefined) updateData.subtype = parsed.data.subtype;
  if (parsed.data.date !== undefined) updateData.date = new Date(parsed.data.date + "T00:00:00.000Z");
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.response !== undefined) updateData.response = parsed.data.response;

  const incident = await prisma.incident.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json(incident);
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

  const existing = await prisma.incident.findUnique({
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

  await prisma.incident.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}
