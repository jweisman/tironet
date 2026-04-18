import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { validateProfileImage } from "@/lib/api/validate-image";

const patchSchema = z.object({
  type: z.enum(["battalion", "company", "platoon", "squad"]),
  name: z.string().min(1),
  battalionId: z.string().uuid().nullable().optional(),
  logo: z.string().nullable().optional(),
});

const deleteSchema = z.object({
  type: z.enum(["battalion", "company", "platoon", "squad"]),
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

  const { type, name, battalionId, logo } = parsed.data;

  if (type === "battalion") {
    const battalion = await prisma.battalion.update({ where: { id }, data: { name } });
    return NextResponse.json(battalion);
  }
  if (type === "company") {
    const data: Record<string, unknown> = { name };
    if (battalionId !== undefined) data.battalionId = battalionId;
    if (logo !== undefined) {
      if (logo !== null) {
        const imageError = validateProfileImage(logo);
        if (imageError) {
          return NextResponse.json({ error: imageError }, { status: 400 });
        }
      }
      data.logo = logo;
    }
    const company = await prisma.company.update({ where: { id }, data });
    return NextResponse.json(company);
  }
  if (type === "platoon") {
    const platoon = await prisma.platoon.update({ where: { id }, data: { name } });
    return NextResponse.json(platoon);
  }
  const squad = await prisma.squad.update({ where: { id }, data: { name } });
  return NextResponse.json(squad);
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

  const { type } = parsed.data;

  if (type === "battalion") {
    await prisma.battalion.delete({ where: { id } });
  } else if (type === "company") {
    await prisma.company.delete({ where: { id } });
  } else if (type === "platoon") {
    await prisma.platoon.delete({ where: { id } });
  } else {
    await prisma.squad.delete({ where: { id } });
  }

  return new NextResponse(null, { status: 204 });
}
