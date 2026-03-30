import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const scoreLabelSchema = z.string().min(1).nullable().optional();

const createSchema = z.object({
  name: z.string().min(1),
  icon: z.string().min(1),
  score1Label: scoreLabelSchema,
  score2Label: scoreLabelSchema,
  score3Label: scoreLabelSchema,
  score4Label: scoreLabelSchema,
  score5Label: scoreLabelSchema,
  score6Label: scoreLabelSchema,
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
