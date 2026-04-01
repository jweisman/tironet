import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { z } from "zod";
import type { SessionUser } from "@/types";

const bulkSchema = z.object({
  result: z.enum(["passed", "failed", "na"]),
  soldierIds: z.array(z.string().uuid()).min(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: activityId } = await params;

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { cycleId: true, platoonId: true },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const { scope, error, user } = await getActivityScope(activity.cycleId);
  if (error || !scope || !user) return error!;

  const body = await request.json();
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { result, soldierIds } = parsed.data;

  // Find existing reports for this activity (to only fill missing ones)
  const existingReports = await prisma.activityReport.findMany({
    where: { activityId, soldierId: { in: soldierIds } },
    select: { soldierId: true },
  });

  const existingSet = new Set(existingReports.map((r) => r.soldierId));
  const missingSoldierIds = soldierIds.filter((sid) => !existingSet.has(sid));

  if (missingSoldierIds.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  // Verify all soldiers are accessible to the user
  const soldiers = await prisma.soldier.findMany({
    where: { id: { in: missingSoldierIds } },
    select: { id: true, squadId: true, squad: { select: { platoonId: true } } },
  });

  // Filter to only soldiers the user can edit
  const editableSoldierIds = soldiers
    .filter((s) => canEditReport(scope, s.squad.platoonId, s.squadId))
    .map((s) => s.id);

  if (editableSoldierIds.length === 0) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionUser = user as SessionUser;

  // Bulk create reports
  await prisma.activityReport.createMany({
    data: editableSoldierIds.map((soldierId) => ({
      activityId,
      soldierId,
      result,
      updatedByUserId: sessionUser.id,
    })),
    skipDuplicates: true,
  });

  return NextResponse.json({ updated: editableSoldierIds.length });
}

function canEditReport(
  scope: Awaited<ReturnType<typeof getActivityScope>>["scope"],
  platoonId: string,
  squadId: string
): boolean {
  if (!scope) return false;
  if (scope.role === "platoon_commander") return scope.platoonIds.includes(platoonId);
  if (scope.role === "company_commander") return scope.platoonIds.includes(platoonId);
  if (scope.role === "squad_commander") return scope.squadId === squadId;
  return false;
}
