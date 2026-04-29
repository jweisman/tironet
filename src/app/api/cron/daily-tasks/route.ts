import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUsers } from "@/lib/push/send";
import { parseMedicalAppointments } from "@/lib/requests/medical-appointments";
import { parseSickDays } from "@/lib/requests/sick-days";
import { hebrewCount } from "@/lib/utils/hebrew-count";

/**
 * GET /api/cron/daily-tasks
 *
 * Cron job that runs twice daily:
 *   - Evening (20:00 Israel / 17:00 UTC): activity gaps + active requests for tomorrow
 *   - Morning (08:00 Israel / 05:00 UTC): active requests for today
 *
 * Use ?mode=morning for the 08:00 run. Default is evening.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = req.nextUrl.searchParams.get("mode") === "morning" ? "morning" : "evening";

  const now = new Date();
  // Use UTC-safe date strings for comparison with appointment dates / departure dates
  const todayStr = now.toISOString().split("T")[0];
  const tomorrowDate = new Date(now);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

  // Date objects for Prisma range queries (activity gaps)
  const today = new Date(todayStr + "T00:00:00Z");
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const tomorrow = new Date(tomorrowStr + "T00:00:00Z");

  const results: Record<string, unknown> = { mode };

  // -------------------------------------------------------------------------
  // Evening: activity gaps notification (squad commanders)
  // -------------------------------------------------------------------------
  if (mode === "evening") {
    results.activityGaps = await sendActivityGapNotifications(
      yesterday,
      tomorrow,
      today,
    );
  }

  // -------------------------------------------------------------------------
  // Active requests notification (squad + platoon commanders)
  // -------------------------------------------------------------------------
  const targetDate = mode === "morning" ? todayStr : tomorrowStr;
  const label = mode === "morning" ? "להיום" : "למחר";
  results.activeRequests = await sendActiveRequestNotifications(targetDate, label);

  return NextResponse.json(results);
}

// ---------------------------------------------------------------------------
// Activity gap notifications (existing logic, refactored)
// ---------------------------------------------------------------------------

async function sendActivityGapNotifications(
  yesterday: Date,
  tomorrow: Date,
  today: Date,
): Promise<{ sent: number; total: number }> {
  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      role: "squad_commander",
      cycle: { isActive: true },
    },
    select: { userId: true, unitId: true, cycleId: true },
  });

  if (assignments.length === 0) return { sent: 0, total: 0 };

  const squadIds = [...new Set(assignments.map((a) => a.unitId))];
  const cycleIds = [...new Set(assignments.map((a) => a.cycleId))];

  const squads = await prisma.squad.findMany({
    where: { id: { in: squadIds } },
    select: { id: true, platoonId: true },
  });
  const squadPlatoonMap = new Map(squads.map((s) => [s.id, s.platoonId]));
  const platoonIds = [...new Set(squads.map((s) => s.platoonId))];

  const activities = await prisma.activity.findMany({
    where: {
      platoonId: { in: platoonIds },
      cycleId: { in: cycleIds },
      isRequired: true,
      date: { gte: yesterday, lt: tomorrow },
    },
    select: { id: true, platoonId: true, cycleId: true },
  });

  if (activities.length === 0) return { sent: 0, total: 0 };

  const soldiers = await prisma.soldier.findMany({
    where: { squadId: { in: squadIds }, status: "active", cycleId: { in: cycleIds } },
    select: { id: true, squadId: true },
  });

  const activityIds = activities.map((a) => a.id);
  const soldierIds = soldiers.map((s) => s.id);
  const reports =
    soldierIds.length > 0 && activityIds.length > 0
      ? await prisma.activityReport.findMany({
          where: { activityId: { in: activityIds }, soldierId: { in: soldierIds } },
          select: { activityId: true, soldierId: true },
        })
      : [];

  const reportSet = new Set(reports.map((r) => `${r.activityId}:${r.soldierId}`));

  const squadSoldiers = new Map<string, string[]>();
  for (const s of soldiers) {
    if (!squadSoldiers.has(s.squadId)) squadSoldiers.set(s.squadId, []);
    squadSoldiers.get(s.squadId)!.push(s.id);
  }

  const notifyMap = new Map<string, number>();
  for (const assignment of assignments) {
    const platoonId = squadPlatoonMap.get(assignment.unitId);
    if (!platoonId) continue;
    const soldierIdsInSquad = squadSoldiers.get(assignment.unitId) ?? [];
    if (soldierIdsInSquad.length === 0) continue;

    const relevantActivities = activities.filter(
      (a) => a.platoonId === platoonId && a.cycleId === assignment.cycleId,
    );

    let gaps = 0;
    for (const activity of relevantActivities) {
      for (const soldierId of soldierIdsInSquad) {
        if (!reportSet.has(`${activity.id}:${soldierId}`)) gaps++;
      }
    }

    if (gaps > 0) {
      notifyMap.set(assignment.userId, (notifyMap.get(assignment.userId) ?? 0) + gaps);
    }
  }

  let sent = 0;
  const promises: Promise<void>[] = [];
  for (const [userId, gapCount] of notifyMap) {
    promises.push(
      sendPushToUsers(
        [userId],
        {
          title: "דיווחי פעילויות חסרים",
          body: `יש ${hebrewCount(gapCount, "דיווח חסר", "דיווחים חסרים")} לפעילויות של היום ואתמול`,
          url: "/activities?filter=gaps",
        },
        "dailyTasksEnabled",
      ).then(() => { sent++; }),
    );
  }
  await Promise.allSettled(promises);
  return { sent, total: notifyMap.size };
}

// ---------------------------------------------------------------------------
// Active request notifications (new)
// ---------------------------------------------------------------------------

async function sendActiveRequestNotifications(
  targetDate: string,
  label: string,
): Promise<{ sent: number; total: number }> {
  // Find squad and platoon commanders in active cycles
  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      role: { in: ["squad_commander", "platoon_commander", "platoon_sergeant"] },
      cycle: { isActive: true },
    },
    select: {
      userId: true,
      unitId: true,
      unitType: true,
      role: true,
      cycleId: true,
    },
  });

  if (assignments.length === 0) return { sent: 0, total: 0 };

  // Resolve squad IDs per user
  const squadIdsByUser = new Map<string, Set<string>>();
  const allSquadIds = new Set<string>();
  const platoonIdsToExpand = new Set<string>();

  for (const a of assignments) {
    if (a.unitType === "squad") {
      allSquadIds.add(a.unitId);
      if (!squadIdsByUser.has(a.userId)) squadIdsByUser.set(a.userId, new Set());
      squadIdsByUser.get(a.userId)!.add(a.unitId);
    } else if (a.unitType === "platoon") {
      platoonIdsToExpand.add(a.unitId);
    }
  }

  // Expand platoon → squads
  let platoonSquadMap = new Map<string, string[]>();
  if (platoonIdsToExpand.size > 0) {
    const pSquads = await prisma.squad.findMany({
      where: { platoonId: { in: [...platoonIdsToExpand] } },
      select: { id: true, platoonId: true },
    });
    for (const s of pSquads) {
      allSquadIds.add(s.id);
      if (!platoonSquadMap.has(s.platoonId)) platoonSquadMap.set(s.platoonId, []);
      platoonSquadMap.get(s.platoonId)!.push(s.id);
    }
    for (const a of assignments) {
      if (a.unitType === "platoon") {
        if (!squadIdsByUser.has(a.userId)) squadIdsByUser.set(a.userId, new Set());
        for (const sqId of platoonSquadMap.get(a.unitId) ?? []) {
          squadIdsByUser.get(a.userId)!.add(sqId);
        }
      }
    }
  }

  if (allSquadIds.size === 0) return { sent: 0, total: 0 };

  // Find approved requests for soldiers in these squads
  const requests = await prisma.request.findMany({
    where: {
      status: "approved",
      type: { in: ["leave", "medical"] },
      soldier: {
        squadId: { in: [...allSquadIds] },
        status: "active",
      },
    },
    select: {
      id: true,
      type: true,
      departureAt: true,
      returnAt: true,
      medicalAppointments: true,
      sickDays: true,
      soldier: { select: { squadId: true } },
    },
  });

  // Filter to requests active on the target date
  const activeOnDate = requests.filter((r) => {
    if (r.type === "leave") {
      const dep = r.departureAt?.toISOString().split("T")[0];
      const ret = r.returnAt?.toISOString().split("T")[0];
      // Leave overlaps target date
      return dep != null && ret != null && dep <= targetDate && ret >= targetDate;
    }
    if (r.type === "medical") {
      const appts = parseMedicalAppointments(r.medicalAppointments as string | null);
      const days = parseSickDays(r.sickDays as string | null);
      return appts.some((a) => a.date.split("T")[0] === targetDate) || days.some((d) => d.date.split("T")[0] === targetDate);
    }
    return false;
  });

  if (activeOnDate.length === 0) return { sent: 0, total: 0 };

  // Build squadId → set of active request IDs
  const requestsBySquad = new Map<string, Set<string>>();
  for (const r of activeOnDate) {
    const sqId = r.soldier.squadId;
    if (!requestsBySquad.has(sqId)) requestsBySquad.set(sqId, new Set());
    requestsBySquad.get(sqId)!.add(r.id);
  }

  // For each user, count requests in their scope
  const notifyUsers: string[] = [];
  for (const [userId, userSquadIds] of squadIdsByUser) {
    let count = 0;
    for (const sqId of userSquadIds) {
      count += requestsBySquad.get(sqId)?.size ?? 0;
    }
    if (count > 0) notifyUsers.push(userId);
  }

  if (notifyUsers.length === 0) return { sent: 0, total: 0 };

  let sent = 0;
  const promises: Promise<void>[] = [];
  for (const userId of notifyUsers) {
    promises.push(
      sendPushToUsers(
        [userId],
        {
          title: "בקשות פעילות",
          body: `יש לך בקשות פעילות ${label}`,
          url: "/requests?filter=active",
        },
        "activeRequestsEnabled",
      ).then(() => { sent++; }),
    );
  }
  await Promise.allSettled(promises);
  return { sent, total: notifyUsers.length };
}
