import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { token },
    include: { cycle: { select: { name: true } } },
  });

  if (!invitation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (invitation.acceptedAt) {
    return NextResponse.json({ error: "already_used" }, { status: 410 });
  }
  if (invitation.expiresAt < new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Resolve unit name
  let unitName = "";
  if (invitation.unitType === "company") {
    const u = await prisma.company.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  } else if (invitation.unitType === "platoon") {
    const u = await prisma.platoon.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  } else {
    const u = await prisma.squad.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  }

  return NextResponse.json({
    email: invitation.email,
    role: invitation.role,
    roleLabel: ROLE_LABELS[invitation.role as Role],
    unitName,
    cycleId: invitation.cycleId,
    cycleName: invitation.cycle.name,
    expiresAt: invitation.expiresAt.toISOString(),
  });
}
