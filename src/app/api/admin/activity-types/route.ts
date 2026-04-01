import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const scoreSlotSchema = z.object({
  label: z.string().min(1),
  format: z.enum(["number", "time"]),
}).nullable();

const scoreConfigSchema = z.object({
  score1: scoreSlotSchema,
  score2: scoreSlotSchema,
  score3: scoreSlotSchema,
  score4: scoreSlotSchema,
  score5: scoreSlotSchema,
  score6: scoreSlotSchema,
}).optional();

const createSchema = z.object({
  name: z.string().min(1),
  icon: z.string().min(1),
  scoreConfig: scoreConfigSchema,
});

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const types = await prisma.activityType.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(types);
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const maxSort = await prisma.activityType.aggregate({ _max: { sortOrder: true } });
  const sortOrder = (maxSort._max.sortOrder ?? 0) + 1;

  const type = await prisma.activityType.create({
    data: { ...parsed.data, sortOrder },
  });
  return NextResponse.json(type, { status: 201 });
}
