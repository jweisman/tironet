import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";

export interface SquadSummary {
  squadId: string;
  squadName: string;
  platoonId: string;
  platoonName: string;
  commanders: string[];
  // Soldiers section
  soldierCount: number;
  soldiersWithGaps: number; // soldiers with ≥1 gap in a required active activity
  // Activities section (activity-level, not pair-level)
  reportedActivities: number;  // required activities where ALL soldiers have a report
  missingReportActivities: number; // required activities where ≥1 soldier has no report
  // Top gaps
  topGapActivities: { id: string; name: string; gapCount: number }[];
}

export interface DashboardResponse {
  role: string;
  cycleId: string;
  squads: SquadSummary[];
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cycleId = searchParams.get("cycleId");

  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getActivityScope(cycleId);
  if (error || !scope) return error!;

  // Fetch all platoons in scope with their squads and active soldiers
  const platoons = await prisma.platoon.findMany({
    where: { id: { in: scope.platoonIds } },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      squads: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          soldiers: {
            where: { status: "active" },
            select: { id: true },
          },
        },
      },
    },
  });

  // For squad_commander, only show their assigned squad
  const filteredPlatoons = platoons.map((p) => ({
    ...p,
    squads:
      scope.role === "squad_commander" && scope.squadId
        ? p.squads.filter((s) => s.id === scope.squadId)
        : p.squads,
  }));

  // Fetch required active activities for all platoons in scope
  const activities = await prisma.activity.findMany({
    where: {
      platoonId: { in: scope.platoonIds },
      status: "active",
      isRequired: true,
    },
    select: { id: true, name: true, platoonId: true },
  });

  // Collect all soldier IDs and activity IDs for the reports query
  const allSoldierIds = filteredPlatoons
    .flatMap((p) => p.squads)
    .flatMap((s) => s.soldiers.map((sol) => sol.id));
  const activityIds = activities.map((a) => a.id);

  // Fetch all relevant reports in one query
  const reports =
    allSoldierIds.length > 0 && activityIds.length > 0
      ? await prisma.activityReport.findMany({
          where: {
            soldierId: { in: allSoldierIds },
            activityId: { in: activityIds },
          },
          select: { soldierId: true, activityId: true, result: true },
        })
      : [];

  // Build report lookup: activityId → Map<soldierId, result>
  const reportMap = new Map<string, Map<string, string>>();
  for (const r of reports) {
    if (!reportMap.has(r.activityId)) reportMap.set(r.activityId, new Map());
    reportMap.get(r.activityId)!.set(r.soldierId, r.result);
  }

  // Fetch squad commanders from DB assignments
  const squadIds = filteredPlatoons.flatMap((p) => p.squads.map((s) => s.id));
  const squadAssignments = await prisma.userCycleAssignment.findMany({
    where: { cycleId, role: "squad_commander", unitId: { in: squadIds } },
    select: {
      unitId: true,
      user: { select: { givenName: true, familyName: true, rank: true } },
    },
  });

  const commandersBySquad = new Map<string, string[]>();
  for (const a of squadAssignments) {
    const parts = [a.user.rank, a.user.givenName, a.user.familyName]
      .filter(Boolean)
      .join(" ");
    if (!commandersBySquad.has(a.unitId)) commandersBySquad.set(a.unitId, []);
    commandersBySquad.get(a.unitId)!.push(parts);
  }

  // Compute per-squad stats
  const squads: SquadSummary[] = filteredPlatoons.flatMap((platoon) => {
    const platoonActivities = activities.filter((a) => a.platoonId === platoon.id);

    return platoon.squads.map((squad) => {
      const soldierIds = squad.soldiers.map((s) => s.id);
      const soldiersWithGapSet = new Set<string>();
      let reportedActivities = 0;
      let missingReportActivities = 0;

      const activityGaps: { id: string; name: string; gapCount: number }[] = [];

      for (const activity of platoonActivities) {
        const actReports = reportMap.get(activity.id) ?? new Map<string, string>();
        let actMissing = 0;
        let actGap = 0; // missing + failed

        for (const soldierId of soldierIds) {
          const result = actReports.get(soldierId);
          if (!result) {
            // No report = missing
            actMissing++;
            actGap++;
            soldiersWithGapSet.add(soldierId);
          } else if (result === "failed") {
            actGap++;
            soldiersWithGapSet.add(soldierId);
          }
          // "passed" and "na" are not gaps
        }

        // Activity is "reported" if every soldier has some report (no missing)
        if (actMissing === 0) {
          reportedActivities++;
        } else {
          missingReportActivities++;
        }

        if (actGap > 0) {
          activityGaps.push({ id: activity.id, name: activity.name, gapCount: actGap });
        }
      }

      activityGaps.sort((a, b) => b.gapCount - a.gapCount);

      return {
        squadId: squad.id,
        squadName: squad.name,
        platoonId: platoon.id,
        platoonName: platoon.name,
        commanders: commandersBySquad.get(squad.id) ?? [],
        soldierCount: soldierIds.length,
        soldiersWithGaps: soldiersWithGapSet.size,
        reportedActivities,
        missingReportActivities,
        topGapActivities: activityGaps.slice(0, 3),
      };
    });
  });

  return NextResponse.json({ role: scope.role, cycleId, squads } satisfies DashboardResponse);
}
