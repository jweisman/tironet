import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { z } from "zod";
import type { SessionUser } from "@/types";

const patchSchema = z.object({
  result: z.enum(["passed", "failed", "na"]).optional(),
  grade: z.number().min(0).max(100).nullable().optional(),
  note: z.string().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Find the report and its activity
  const report = await prisma.activityReport.findUnique({
    where: { id },
    include: {
      activity: { select: { cycleId: true, platoonId: true } },
      soldier: { select: { squadId: true, squad: { select: { platoonId: true } } } },
    },
  });

  if (!report) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const { scope, error, user } = await getActivityScope(report.activity.cycleId);
  if (error || !scope || !user) return error!;

  // Check access
  const canEdit = canEditReport(scope, report.soldier.squad.platoonId, report.soldier.squadId);
  if (!canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {
    updatedByUserId: (user as SessionUser).id,
  };

  if (parsed.data.result !== undefined) updateData.result = parsed.data.result;
  if ("grade" in parsed.data) updateData.grade = parsed.data.grade ?? null;
  if ("note" in parsed.data) updateData.note = parsed.data.note ?? null;

  const updated = await prisma.activityReport.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({
    report: {
      ...updated,
      grade: updated.grade ? Number(updated.grade) : null,
    },
  });
}

function canEditReport(
  scope: Awaited<ReturnType<typeof getActivityScope>>["scope"],
  platoonId: string,
  squadId: string
): boolean {
  if (!scope) return false;
  if (scope.role === "admin") return true;
  if (scope.role === "platoon_commander") return scope.platoonIds.includes(platoonId);
  if (scope.role === "company_commander") return scope.platoonIds.includes(platoonId);
  if (scope.role === "squad_commander") return scope.squadId === squadId;
  return false;
}
