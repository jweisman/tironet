import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { z } from "zod";

const createSchema = z.object({
  cycleId: z.string().uuid(),
  platoonId: z.string().uuid(),
  activityTypeId: z.string().uuid(),
  name: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isRequired: z.boolean().optional().default(true),
  status: z.enum(["draft", "active"]).optional().default("active"),
  notes: z.string().optional().nullable(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cycleId = searchParams.get("cycleId");

  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error, user } = await getActivityScope(cycleId);
  if (error || !scope || !user) return error!;

  const activities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: scope.platoonIds },
    },
    include: {
      activityType: { select: { id: true, name: true, icon: true } },
      platoon: {
        select: {
          id: true,
          name: true,
          company: { select: { name: true } },
        },
      },
      reports: {
        select: { result: true, soldierId: true },
      },
      _count: false,
    },
    orderBy: { date: "desc" },
  });

  // For squad_commander: scope to their squad's soldiers only
  let scopedSoldierIds: Set<string> | null = null;
  if (scope.role === "squad_commander" && scope.squadId) {
    const squadSoldiers = await prisma.soldier.findMany({
      where: { squadId: scope.squadId, status: "active" },
      select: { id: true },
    });
    scopedSoldierIds = new Set(squadSoldiers.map((s) => s.id));
  }

  // Count active soldiers per platoon (or per squad for squad_commander)
  const platoonIdSet = new Set(activities.map((a) => a.platoonId));
  const soldierCountsByPlatoon = new Map<string, number>();
  for (const platoonId of platoonIdSet) {
    if (scopedSoldierIds !== null) {
      // Squad commander: soldier count is fixed to their squad
      soldierCountsByPlatoon.set(platoonId, scopedSoldierIds.size);
    } else {
      const count = await prisma.soldier.count({
        where: { cycleId, status: "active", squad: { platoonId } },
      });
      soldierCountsByPlatoon.set(platoonId, count);
    }
  }

  const result = activities.map((activity) => {
    const totalSoldiers = soldierCountsByPlatoon.get(activity.platoonId) ?? 0;
    const scopedReports = scopedSoldierIds
      ? activity.reports.filter((r) => scopedSoldierIds!.has(r.soldierId))
      : activity.reports;
    const passedCount = scopedReports.filter((r) => r.result === "completed").length;
    const failedCount = scopedReports.filter((r) => r.result === "skipped").length;
    const naCount = scopedReports.filter((r) => r.result === "na").length;
    const missingCount = Math.max(0, totalSoldiers - passedCount - failedCount - naCount);

    return {
      id: activity.id,
      name: activity.name,
      date: activity.date.toISOString(),
      status: activity.status,
      isRequired: activity.isRequired,
      notes: activity.notes,
      activityType: activity.activityType,
      platoon: {
        id: activity.platoon.id,
        name: activity.platoon.name,
        companyName: activity.platoon.company.name,
      },
      passedCount,
      failedCount,
      naCount,
      missingCount,
      totalSoldiers,
    };
  });

  return NextResponse.json({
    role: scope.role,
    canCreate: scope.canCreate,
    platoonIds: scope.platoonIds,
    platoons: scope.platoons,
    activities: result,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { cycleId, platoonId, activityTypeId, name, date, isRequired, status, notes } = parsed.data;

  const { scope, error, user } = await getActivityScope(cycleId);
  if (error || !scope || !user) return error!;

  // Only platoon_commander / company_commander for their own platoons, or admin can create
  if (!scope.canCreate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify the target platoon is within the user's scope
  if (!scope.platoonIds.includes(platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify platoon belongs to this cycle
  const platoon = await prisma.platoon.findFirst({
    where: { id: platoonId, company: { cycleId } },
  });
  if (!platoon) {
    return NextResponse.json({ error: "Platoon not found" }, { status: 404 });
  }

  const activity = await prisma.activity.create({
    data: {
      cycleId,
      platoonId,
      activityTypeId,
      name,
      date: new Date(date),
      isRequired,
      status,
      notes: notes ?? null,
      createdByUserId: user.id,
    },
    include: {
      activityType: { select: { id: true, name: true, icon: true } },
      platoon: {
        select: {
          id: true,
          name: true,
          company: { select: { name: true } },
        },
      },
    },
  });

  return NextResponse.json(
    {
      activity: {
        ...activity,
        date: activity.date.toISOString(),
        platoon: {
          id: activity.platoon.id,
          name: activity.platoon.name,
          companyName: activity.platoon.company.name,
        },
      },
    },
    { status: 201 }
  );
}
