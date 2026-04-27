import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const invitations = await prisma.invitation.findMany({
    where: { acceptedAt: null, expiresAt: { gt: new Date() } },
    include: { cycle: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Resolve unit names
  const [companies, platoons, squads] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true } }),
    prisma.platoon.findMany({ select: { id: true, name: true } }),
    prisma.squad.findMany({ select: { id: true, name: true } }),
  ]);
  const unitMap = new Map<string, string>();
  for (const u of [...companies, ...platoons, ...squads]) unitMap.set(u.id, u.name);

  return NextResponse.json(
    invitations.map((inv) => ({
      id: inv.id,
      givenName: inv.givenName,
      familyName: inv.familyName,
      email: inv.email,
      phone: inv.phone,
      role: inv.role,
      roleLabel: ROLE_LABELS[inv.role as Role],
      unitName: unitMap.get(inv.unitId) ?? "",
      cycleName: inv.cycle.name,
      cycleId: inv.cycleId,
      unitId: inv.unitId,
      unitType: inv.unitType,
      expiresAt: inv.expiresAt.toISOString(),
      inviteUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/invite/${inv.token}`,
      invitedByUserId: inv.invitedByUserId,
    }))
  );
}
