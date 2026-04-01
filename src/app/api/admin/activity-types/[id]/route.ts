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
});

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  scoreConfig: scoreConfigSchema.optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const type = await prisma.activityType.update({
    where: { id },
    data: parsed.data,
  });
  return NextResponse.json(type);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  await prisma.activityType.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
