import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const createSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("company"), cycleId: z.string().uuid(), name: z.string().min(1) }),
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

  if (data.type === "company") {
    const company = await prisma.company.create({
      data: { cycleId: data.cycleId, name: data.name },
    });
    return NextResponse.json(company, { status: 201 });
  }

  if (data.type === "platoon") {
    const platoon = await prisma.platoon.create({
      data: { companyId: data.companyId, name: data.name },
    });
    return NextResponse.json(platoon, { status: 201 });
  }

  const squad = await prisma.squad.create({
    data: { platoonId: data.platoonId, name: data.name },
  });
  return NextResponse.json(squad, { status: 201 });
}
