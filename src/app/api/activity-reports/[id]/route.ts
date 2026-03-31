import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { z } from "zod";
import type { SessionUser } from "@/types";

const gradeSchema = z.number().min(0).nullable().optional();

const patchSchema = z.object({
  result: z.enum(["passed", "failed", "na"]).optional(),
  grade1: gradeSchema,
  grade2: gradeSchema,
  grade3: gradeSchema,
  grade4: gradeSchema,
  grade5: gradeSchema,
  grade6: gradeSchema,
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
  for (const k of ["grade1", "grade2", "grade3", "grade4", "grade5", "grade6"] as const) {
    if (k in parsed.data) updateData[k] = parsed.data[k] ?? null;
  }
  if ("note" in parsed.data) updateData.note = parsed.data.note ?? null;

  const updated = await prisma.activityReport.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({
    report: {
      ...updated,
      grade1: updated.grade1 ? Number(updated.grade1) : null,
      grade2: updated.grade2 ? Number(updated.grade2) : null,
      grade3: updated.grade3 ? Number(updated.grade3) : null,
      grade4: updated.grade4 ? Number(updated.grade4) : null,
      grade5: updated.grade5 ? Number(updated.grade5) : null,
      grade6: updated.grade6 ? Number(updated.grade6) : null,
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
