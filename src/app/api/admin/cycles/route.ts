import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const createSchema = z.object({
  name: z.string().min(1),
});

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const cycles = await prisma.cycle.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(cycles);
}

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const cycle = await prisma.cycle.create({
    data: { name: parsed.data.name },
  });
  return NextResponse.json(cycle, { status: 201 });
}
