import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { getActivityScope } from "@/lib/api/activity-scope";

const activitySchema = z.object({
  activityTypeId: z.string().uuid(),
  name: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isRequired: z.boolean().optional().default(true),
  status: z.enum(["draft", "active"]).optional().default("active"),
  notes: z.string().nullable().optional(),
});

const bulkSchema = z.object({
  cycleId: z.string().uuid(),
  platoonId: z.string().uuid(),
  activities: z.array(activitySchema).min(1).max(500),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { cycleId, platoonId, activities } = parsed.data;

  const { scope, error, user } = await getActivityScope(cycleId);
  if (error || !scope || !user) return error!;

  if (!scope.canCreate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Platoon commander can only create for their own platoon
  if (scope.role === "platoon_commander" && !scope.platoonIds.includes(platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify platoon belongs to this cycle
  const platoon = await prisma.platoon.findFirst({
    where: { id: platoonId, company: { cycleId } },
  });
  if (!platoon) {
    return NextResponse.json({ error: "Platoon not found" }, { status: 404 });
  }

  // Verify all activity type IDs exist and are active
  const uniqueTypeIds = [...new Set(activities.map((a) => a.activityTypeId))];
  const types = await prisma.activityType.findMany({
    where: { id: { in: uniqueTypeIds }, isActive: true },
    select: { id: true },
  });
  const validTypeIds = new Set(types.map((t) => t.id));
  for (const typeId of uniqueTypeIds) {
    if (!validTypeIds.has(typeId)) {
      return NextResponse.json(
        { error: `Activity type not found: ${typeId}` },
        { status: 400 }
      );
    }
  }

  // Check for existing duplicates (same name + date + type + platoon)
  // to skip them
  const existing = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId,
      OR: activities.map((a) => ({
        activityTypeId: a.activityTypeId,
        name: a.name,
        date: new Date(a.date),
      })),
    },
    select: { activityTypeId: true, name: true, date: true },
  });

  const existingSet = new Set(
    existing.map(
      (e) =>
        `${e.activityTypeId}|${e.name}|${e.date.toISOString().split("T")[0]}`
    )
  );

  const toCreate = activities.filter(
    (a) => !existingSet.has(`${a.activityTypeId}|${a.name}|${a.date}`)
  );

  const skipped = activities.length - toCreate.length;

  if (toCreate.length > 0) {
    await prisma.$transaction(
      toCreate.map((a) =>
        prisma.activity.create({
          data: {
            cycleId,
            platoonId,
            activityTypeId: a.activityTypeId,
            name: a.name.trim(),
            date: new Date(a.date),
            isRequired: a.isRequired,
            status: a.status,
            notes: a.notes ?? null,
            createdByUserId: user.id,
          },
        })
      )
    );
  }

  return NextResponse.json(
    { created: toCreate.length, skipped },
    { status: 201 }
  );
}
