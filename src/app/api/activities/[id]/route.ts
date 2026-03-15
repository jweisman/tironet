import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  activityTypeId: z.string().uuid().optional(),
  isRequired: z.boolean().optional(),
  status: z.enum(["draft", "active"]).optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get the activity first to find its cycleId
  const activity = await prisma.activity.findUnique({
    where: { id },
    include: {
      activityType: { select: { id: true, name: true, icon: true } },
      platoon: {
        select: {
          id: true,
          name: true,
          company: { select: { name: true } },
          squads: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              name: true,
              soldiers: {
                where: { status: "active" },
                orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
                select: {
                  id: true,
                  givenName: true,
                  familyName: true,
                  rank: true,
                  profileImage: true,
                  status: true,
                },
              },
            },
          },
        },
      },
      reports: {
        select: {
          id: true,
          soldierId: true,
          result: true,
          grade: true,
          note: true,
        },
      },
    },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const { scope, error } = await getActivityScope(activity.cycleId);
  if (error || !scope) return error!;

  // Access control: check if user can see this activity
  const canSeePlatoon = scope.platoonIds.includes(activity.platoonId);
  if (!canSeePlatoon) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Squad commander can only see active activities
  if (scope.role === "squad_commander" && activity.status === "draft") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const canEditMetadata = scope.canEditMetadataForPlatoon(activity.platoonId);
  const canEditReports =
    scope.role === "platoon_commander" ||
    scope.role === "company_commander" ||
    scope.role === "admin" ||
    scope.role === "squad_commander";

  // Build reports map
  const reportsMap = new Map(activity.reports.map((r) => [r.soldierId, r]));

  // Filter squads based on role
  const squads = activity.platoon.squads
    .filter((squad) => {
      if (scope.role === "squad_commander") {
        return squad.id === scope.squadId;
      }
      return true;
    })
    .map((squad) => {
      const canEdit =
        scope.role === "admin" ||
        scope.role === "platoon_commander" ||
        scope.role === "company_commander" ||
        (scope.role === "squad_commander" && squad.id === scope.squadId);

      return {
        id: squad.id,
        name: squad.name,
        canEdit,
        soldiers: squad.soldiers.map((soldier) => {
          const report = reportsMap.get(soldier.id);
          return {
            id: soldier.id,
            givenName: soldier.givenName,
            familyName: soldier.familyName,
            rank: soldier.rank,
            profileImage: soldier.profileImage,
            status: soldier.status,
            report: report
              ? {
                  id: report.id,
                  result: report.result,
                  grade: report.grade ? Number(report.grade) : null,
                  note: report.note,
                }
              : { id: null, result: null, grade: null, note: null },
          };
        }),
      };
    });

  return NextResponse.json({
    id: activity.id,
    name: activity.name,
    date: activity.date.toISOString(),
    status: activity.status,
    isRequired: activity.isRequired,
    activityType: activity.activityType,
    platoon: {
      id: activity.platoon.id,
      name: activity.platoon.name,
      companyName: activity.platoon.company.name,
    },
    role: scope.role,
    canEditMetadata,
    canEditReports,
    squads,
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const activity = await prisma.activity.findUnique({
    where: { id },
    select: { cycleId: true, platoonId: true },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const { scope, error } = await getActivityScope(activity.cycleId);
  if (error || !scope) return error!;

  if (!scope.canEditMetadataForPlatoon(activity.platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Reports are deleted automatically via cascade
  await prisma.activity.delete({ where: { id } });

  return new NextResponse(null, { status: 204 });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const activity = await prisma.activity.findUnique({
    where: { id },
    select: { cycleId: true, platoonId: true },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const { scope, error } = await getActivityScope(activity.cycleId);
  if (error || !scope) return error!;

  // Only platoon_commander for their platoon or admin
  if (!scope.canEditMetadataForPlatoon(activity.platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
  if (parsed.data.date !== undefined) updateData.date = new Date(parsed.data.date);
  if (parsed.data.activityTypeId !== undefined) updateData.activityTypeId = parsed.data.activityTypeId;
  if (parsed.data.isRequired !== undefined) updateData.isRequired = parsed.data.isRequired;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;

  const updated = await prisma.activity.update({
    where: { id },
    data: updateData,
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

  return NextResponse.json({
    activity: {
      ...updated,
      date: updated.date.toISOString(),
      platoon: {
        id: updated.platoon.id,
        name: updated.platoon.name,
        companyName: updated.platoon.company.name,
      },
    },
  });
}
