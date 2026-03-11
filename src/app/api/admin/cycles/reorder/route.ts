import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const schema = z.object({
  ids: z.array(z.string().uuid()).min(1),
});

export async function PATCH(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updates = parsed.data.ids.map((id, index) =>
    prisma.cycle.update({ where: { id }, data: { sortOrder: index } })
  );

  await prisma.$transaction(updates);
  return new NextResponse(null, { status: 204 });
}
