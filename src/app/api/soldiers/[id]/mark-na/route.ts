import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      updatedByUserId: session.user.id,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ count: activitiesToMark.length });
}
