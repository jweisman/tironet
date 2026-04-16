import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

const schema = z.object({
  cycleId: z.string().uuid(),
  role: z.enum(["company_commander", "deputy_company_commander", "platoon_commander", "platoon_sergeant", "squad_commander", "instructor", "company_medic", "hardship_coordinator"]),
  unitType: z.enum(["company", "platoon", "squad"]),
  unitId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  try {
    const assignment = await prisma.userCycleAssignment.create({
      data: { userId: id, ...parsed.data },
    });
    return NextResponse.json({ id: assignment.id }, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "למשתמש כבר יש שיוך במחזור זה" }, { status: 409 });
    }
    throw err;
  }
}
