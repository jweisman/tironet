import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const patchSchema = z.object({
  assignmentId: z.string().uuid(),
  role: z.enum(["company_commander", "platoon_commander", "squad_commander"]).optional(),
  unitType: z.enum(["company", "platoon", "squad"]).optional(),
  unitId: z.string().uuid().optional(),
});

const deleteSchema = z.object({
  assignmentId: z.string().uuid(),
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

  const { assignmentId, ...data } = parsed.data;
  await prisma.userCycleAssignment.update({
    where: { id: assignmentId, userId: id },
    data,
  });

  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await req.json();
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await prisma.userCycleAssignment.delete({
    where: { id: parsed.data.assignmentId, userId: id },
  });

  return new NextResponse(null, { status: 204 });
}
