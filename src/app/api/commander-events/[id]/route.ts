import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

const UpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).nullable().optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

async function getCallerPlatoonIds(
  callerAssignments: { role: string; unitId: string; unitType: string; cycleId: string }[],
  cycleId: string,
): Promise<string[]> {
  const platoonIds: string[] = [];
  for (const a of callerAssignments.filter((a) => a.cycleId === cycleId)) {
    const eRole = effectiveRole(a.role as Role);
    if (eRole === "platoon_commander") {
      platoonIds.push(a.unitId);
    } else if (eRole === "company_commander") {
      const company = await prisma.company.findUnique({
        where: { id: a.unitId },
        select: { platoons: { select: { id: true } } },
      });
      if (company) platoonIds.push(...company.platoons.map((p) => p.id));
    }
  }
  return platoonIds;
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

  const event = await prisma.commanderEvent.findUnique({ where: { id } });
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const platoonIds = await getCallerPlatoonIds(session.user.cycleAssignments, event.cycleId);
  if (!platoonIds.includes(event.platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.startDate !== undefined) data.startDate = new Date(parsed.data.startDate + "T00:00:00.000Z");
  if (parsed.data.endDate !== undefined) data.endDate = new Date(parsed.data.endDate + "T00:00:00.000Z");

  // Validate date range if either date is being updated
  const newStart = (data.startDate as Date | undefined) ?? event.startDate;
  const newEnd = (data.endDate as Date | undefined) ?? event.endDate;
  if (newStart > newEnd) {
    return NextResponse.json({ error: "startDate must be <= endDate" }, { status: 400 });
  }

  const updated = await prisma.commanderEvent.update({ where: { id }, data });
  return NextResponse.json(updated);
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

  const event = await prisma.commanderEvent.findUnique({ where: { id } });
  if (!event) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const platoonIds = await getCallerPlatoonIds(session.user.cycleAssignments, event.cycleId);
  if (!platoonIds.includes(event.platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.commanderEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
