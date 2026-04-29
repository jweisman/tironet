import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";
import { z } from "zod";
import type { SessionUser } from "@/types";

const gradeSchema = z.number().min(0).nullable().optional();

const upsertSchema = z.object({
  // Optional client-generated UUID — used when the record was created offline
  // so the server preserves the same ID the local PowerSync DB already has.
  id: z.string().uuid().optional(),
  activityId: z.string().uuid(),
  soldierId: z.string().uuid(),
  result: z.enum(["completed", "skipped", "na"]),
  failed: z.boolean().optional(),
  grade1: gradeSchema,
  grade2: gradeSchema,
  grade3: gradeSchema,
  grade4: gradeSchema,
  grade5: gradeSchema,
  grade6: gradeSchema,
  note: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = upsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { id: clientId, activityId, soldierId, result, failed, grade1, grade2, grade3, grade4, grade5, grade6, note } = parsed.data;

  // Find the activity to get cycleId
  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    select: { cycleId: true, platoonId: true },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const { scope, error, user } = await getActivityScope(activity.cycleId);
  if (error || !scope || !user) return error!;

  // Verify the soldier is in an accessible squad
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: { squadId: true, squad: { select: { platoonId: true } } },
  });

  if (!soldier) {
    return NextResponse.json({ error: "Soldier not found" }, { status: 404 });
  }

  // Check access
  const canEdit = canEditReport(scope, soldier.squad.platoonId, soldier.squadId);
  if (!canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionUser = user as SessionUser;

  const grades = {
    grade1: grade1 ?? null,
    grade2: grade2 ?? null,
    grade3: grade3 ?? null,
    grade4: grade4 ?? null,
    grade5: grade5 ?? null,
    grade6: grade6 ?? null,
  };

  // For the update clause, use `undefined` (Prisma: "don't touch") instead of
  // `null` for fields that aren't set in the incoming data. This prevents a
  // concurrent PUT from wiping grades that another commander already saved.
  // Explicit clears go through the PATCH endpoint which is field-specific.
  const mergeGrades = {
    grade1: grade1 ?? undefined,
    grade2: grade2 ?? undefined,
    grade3: grade3 ?? undefined,
    grade4: grade4 ?? undefined,
    grade5: grade5 ?? undefined,
    grade6: grade6 ?? undefined,
  };

  const report = await prisma.activityReport.upsert({
    where: {
      activityId_soldierId: { activityId, soldierId },
    },
    create: {
      ...(clientId ? { id: clientId } : {}),
      activityId,
      soldierId,
      result,
      failed: failed ?? false,
      ...grades,
      note: note ?? null,
      updatedByUserId: sessionUser.id,
    },
    update: {
      result,
      failed: failed ?? undefined,
      ...mergeGrades,
      note: note ?? undefined,
      updatedByUserId: sessionUser.id,
    },
  });

  return NextResponse.json({
    report: {
      ...report,
      grade1: report.grade1 ? Number(report.grade1) : null,
      grade2: report.grade2 ? Number(report.grade2) : null,
      grade3: report.grade3 ? Number(report.grade3) : null,
      grade4: report.grade4 ? Number(report.grade4) : null,
      grade5: report.grade5 ? Number(report.grade5) : null,
      grade6: report.grade6 ? Number(report.grade6) : null,
    },
  });
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
