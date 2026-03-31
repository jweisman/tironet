import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUsers } from "@/lib/push/send";

/**
 * GET /api/cron/daily-tasks
 *
 * Nightly cron job (20:00 Israel time). For each squad commander with
 * an active cycle assignment, count activities from today or yesterday
 * that have missing reports for soldiers in their squad. Send a push
 * notification if the count is > 0.
 */
export async function GET(req: NextRequest) {
  // Verify cron secret (Vercel sends Authorization header for cron jobs)
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Today and yesterday in UTC (the cron runs at 20:00 Israel time = 17:00 UTC)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Find all squad commanders in active cycles
  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      role: "squad_commander",
      cycle: { isActive: true },
    },
    select: {
      userId: true,
      unitId: true, // squad ID
      cycleId: true,
      cycle: { select: { id: true } },
    },
  });

  if (assignments.length === 0) {
    return NextResponse.json({ sent: 0, message: "No squad commanders in active cycles" });
  }

  // Collect unique squad IDs and cycle IDs
  const squadIds = [...new Set(assignments.map((a) => a.unitId))];
  const cycleIds = [...new Set(assignments.map((a) => a.cycleId))];

  // Get platoon IDs for these squads (needed to find activities)
  const squads = await prisma.squad.findMany({
    where: { id: { in: squadIds } },
    select: { id: true, platoonId: true },
  });
  const squadPlatoonMap = new Map(squads.map((s) => [s.id, s.platoonId]));
  const platoonIds = [...new Set(squads.map((s) => s.platoonId))];

  // Find required active activities from today or yesterday
  const activities = await prisma.activity.findMany({
    where: {
      platoonId: { in: platoonIds },
      cycleId: { in: cycleIds },
      status: "active",
      isRequired: true,
      date: { gte: yesterday, lt: tomorrow },
    },
    select: { id: true, platoonId: true, cycleId: true },
  });

  if (activities.length === 0) {
    return NextResponse.json({ sent: 0, message: "No activities requiring reports" });
  }

  // Get active soldiers in these squads
  const soldiers = await prisma.soldier.findMany({
    where: { squadId: { in: squadIds }, status: "active" },
    select: { id: true, squadId: true },
  });

  // Get existing reports
  const activityIds = activities.map((a) => a.id);
  const soldierIds = soldiers.map((s) => s.id);
  const reports =
    soldierIds.length > 0 && activityIds.length > 0
      ? await prisma.activityReport.findMany({
          where: { activityId: { in: activityIds }, soldierId: { in: soldierIds } },
          select: { activityId: true, soldierId: true },
        })
      : [];

  // Build report lookup: Set of "activityId:soldierId"
  const reportSet = new Set(reports.map((r) => `${r.activityId}:${r.soldierId}`));

  // Build squad → soldiers lookup
  const squadSoldiers = new Map<string, string[]>();
  for (const s of soldiers) {
    if (!squadSoldiers.has(s.squadId)) squadSoldiers.set(s.squadId, []);
    squadSoldiers.get(s.squadId)!.push(s.id);
  }

  // For each assignment, count missing reports
  const notifyMap = new Map<string, number>(); // userId → gap count

  for (const assignment of assignments) {
    const squadId = assignment.unitId;
    const platoonId = squadPlatoonMap.get(squadId);
    if (!platoonId) continue;

    const soldierIdsInSquad = squadSoldiers.get(squadId) ?? [];
    if (soldierIdsInSquad.length === 0) continue;

    // Activities for this squad's platoon and cycle
    const relevantActivities = activities.filter(
      (a) => a.platoonId === platoonId && a.cycleId === assignment.cycleId,
    );

    let gaps = 0;
    for (const activity of relevantActivities) {
      for (const soldierId of soldierIdsInSquad) {
        if (!reportSet.has(`${activity.id}:${soldierId}`)) {
          gaps++;
        }
      }
    }

    if (gaps > 0) {
      // A user may have multiple squad assignments — accumulate
      notifyMap.set(assignment.userId, (notifyMap.get(assignment.userId) ?? 0) + gaps);
    }
  }

  // Send notifications
  let sent = 0;
  const sendPromises: Promise<void>[] = [];

  for (const [userId, gapCount] of notifyMap) {
    sendPromises.push(
      sendPushToUsers(
        [userId],
        {
          title: "דיווחי פעילויות חסרים",
          body: `יש ${gapCount} דיווחים חסרים לפעילויות של היום ואתמול`,
          url: "/activities?filter=gaps",
        },
        "dailyTasksEnabled",
      ).then(() => { sent++; }),
    );
  }

  await Promise.allSettled(sendPromises);

  return NextResponse.json({ sent, total: notifyMap.size });
}
