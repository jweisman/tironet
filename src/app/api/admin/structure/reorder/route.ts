import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const schema = z.object({
  type: z.enum(["company", "platoon", "squad"]),
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

  const { type, ids } = parsed.data;

  // Assign sortOrder by position in the ids array
  const updates = ids.map((id, index) =>
    type === "company"
      ? prisma.company.update({ where: { id }, data: { sortOrder: index } })
      : type === "platoon"
        ? prisma.platoon.update({ where: { id }, data: { sortOrder: index } })
        : prisma.squad.update({ where: { id }, data: { sortOrder: index } })
  );

  await prisma.$transaction(updates);
  return new NextResponse(null, { status: 204 });
}
