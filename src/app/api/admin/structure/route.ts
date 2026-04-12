import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("battalion"), name: z.string().min(1) }),
  z.object({ type: z.literal("company"), cycleId: z.string().uuid(), battalionId: z.string().uuid().optional(), name: z.string().min(1) }),
  z.object({ type: z.literal("platoon"), companyId: z.string().uuid(), name: z.string().min(1) }),
  z.object({ type: z.literal("squad"), platoonId: z.string().uuid(), name: z.string().min(1) }),
]);

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data = parsed.data;

  if (data.type === "battalion") {
    const maxOrder = await prisma.battalion.aggregate({ _max: { sortOrder: true } });
    const battalion = await prisma.battalion.create({
      data: { name: data.name, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1 },
    });
    return NextResponse.json(battalion, { status: 201 });
  }

  if (data.type === "company") {
    const maxOrder = await prisma.company.aggregate({
      where: { cycleId: data.cycleId },
      _max: { sortOrder: true },
    });
    const company = await prisma.company.create({
      data: {
        cycleId: data.cycleId,
        name: data.name,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
        ...(data.battalionId ? { battalionId: data.battalionId } : {}),
      },
    });
    return NextResponse.json(company, { status: 201 });
  }

  if (data.type === "platoon") {
    const maxOrder = await prisma.platoon.aggregate({
      where: { companyId: data.companyId },
      _max: { sortOrder: true },
    });
    const platoon = await prisma.platoon.create({
      data: { companyId: data.companyId, name: data.name, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1 },
    });
    return NextResponse.json(platoon, { status: 201 });
  }

  const maxOrder = await prisma.squad.aggregate({
    where: { platoonId: data.platoonId },
    _max: { sortOrder: true },
  });
  const squad = await prisma.squad.create({
    data: { platoonId: data.platoonId, name: data.name, sortOrder: (maxOrder._max.sortOrder ?? -1) + 1 },
  });
  return NextResponse.json(squad, { status: 201 });
}
