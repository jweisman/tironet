import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { UsersTable } from "@/components/admin/UsersTable";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export default async function UsersPage() {
  const session = await auth();
  const [users, cycles, companies, invitations] = await Promise.all([
    prisma.user.findMany({
      select: {
        id: true,
        givenName: true,
        familyName: true,
        email: true,
        phone: true,
        rank: true,
        isAdmin: true,
        cycleAssignments: {
          select: {
            id: true,
            role: true,
            unitType: true,
            unitId: true,
            cycleId: true,
            cycle: { select: { name: true, isActive: true } },
          },
        },
      },
      orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
    }),
    prisma.cycle.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.company.findMany({
      include: {
        platoons: {
          include: { squads: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        },
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      include: { cycle: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Build full-path unit name lookup: "פלוגה א / כיתה א" etc.
  const unitMap = new Map<string, string>();
  for (const co of companies) {
    unitMap.set(co.id, co.name);
    for (const pl of co.platoons) {
      unitMap.set(pl.id, `${co.name} / ${pl.name}`);
      for (const sq of pl.squads) {
        unitMap.set(sq.id, `${co.name} / ${pl.name} / ${sq.name}`);
      }
    }
  }

  const annotatedUsers = users.map((u) => ({
    ...u,
    cycleAssignments: u.cycleAssignments.map((a) => ({
      ...a,
      unitName: unitMap.get(a.unitId) ?? "",
    })),
  }));

  const annotatedInvitations = invitations.map((inv) => ({
    id: inv.id,
    givenName: inv.givenName,
    familyName: inv.familyName,
    email: inv.email,
    phone: inv.phone,
    role: inv.role,
    roleLabel: ROLE_LABELS[inv.role as Role],
    unitName: unitMap.get(inv.unitId) ?? "",
    cycleName: inv.cycle.name,
    expiresAt: inv.expiresAt.toISOString(),
    inviteUrl: `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/invite/${inv.token}`,
    invitedByUserId: inv.invitedByUserId,
  }));

  const structureByCycle: Record<string, typeof companies> = {};
  for (const company of companies) {
    if (!structureByCycle[company.cycleId]) structureByCycle[company.cycleId] = [];
    structureByCycle[company.cycleId].push(company);
  }

  return (
    <UsersTable
      initialUsers={annotatedUsers}
      initialInvitations={annotatedInvitations}
      cycles={cycles}
      structureByCycle={structureByCycle}
      currentUserId={session?.user?.id ?? ""}
    />
  );
}
