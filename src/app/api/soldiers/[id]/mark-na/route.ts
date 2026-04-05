import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: soldierId } = await params;

  // Find soldier with squad/platoon info
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: {
      id: true,
      cycleId: true,
      squadId: true,
      squad: { select: { platoonId: true } },
    },
  });

  if (!soldier) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Scope check: user must have access to this soldier's cycle and unit
  const { scope, error, user } = await getActivityScope(soldier.cycleId);
  if (error || !scope || !user) return error!;

  const canEdit =
    scope.role === "squad_commander"
      ? scope.squadId === soldier.squadId
      : scope.platoonIds.includes(soldier.squad.platoonId);

  if (!canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Find all active activities for soldier's platoon in this cycle
  const activities = await prisma.activity.findMany({
    where: {
      cycleId: soldier.cycleId,
      platoonId: soldier.squad.platoonId,
      status: "active",
    },
    select: { id: true },
  });

  // Find existing reports for this soldier
  const existingReports = await prisma.activityReport.findMany({
    where: {
      soldierId: soldierId,
      activityId: { in: activities.map((a) => a.id) },
    },
    select: { activityId: true },
  });
  const existingActivityIds = new Set(existingReports.map((r) => r.activityId));

  // Only create reports for activities that don't already have one
  const activitiesToMark = activities.filter(
    (a) => !existingActivityIds.has(a.id)
  );

  if (activitiesToMark.length === 0) {
    return NextResponse.json({ count: 0 });
  }

  await prisma.activityReport.createMany({
    data: activitiesToMark.map((a) => ({
      activityId: a.id,
      soldierId: soldierId,
      result: "na",
      updatedByUserId: user.id,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ count: activitiesToMark.length });
}
