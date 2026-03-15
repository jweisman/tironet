import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { ROLE_LABELS, rolesInvitableBy } from "@/lib/auth/permissions";
import { CommanderUsersPanel } from "@/components/CommanderUsersPanel";
import type { Role } from "@/types";

export default async function UsersPage() {
  const session = await auth();
  if (!session?.user) return null;

  const { cycleAssignments } = session.user;
  const managerAssignments = cycleAssignments.filter((a) => a.role !== "squad_commander");

  if (managerAssignments.length === 0) {
    return (
      <div className="max-w-3xl mx-auto">
        <h1 className="text-xl font-bold mb-6">מפקדים</h1>
        <p className="text-sm text-muted-foreground">אינך מוגדר כמפקד מחלקה או פלוגה.</p>
      </div>
    );
  }

  // Compute the union of invitable roles across all assignments
  const invitableRolesSet = new Set<Role>();
  for (const a of managerAssignments) {
    for (const r of rolesInvitableBy(a.role as Role, false)) {
      invitableRolesSet.add(r);
    }
  }
  const invitableRoles = Array.from(invitableRolesSet);

  // Build structureByCycle and collect sub-unit IDs
  type SquadItem = { id: string; name: string };
  type PlatoonItem = { id: string; name: string; squads: SquadItem[] };
  type CompanyItem = { id: string; name: string; platoons: PlatoonItem[] };
  const structureByCycle: Record<string, CompanyItem[]> = {};
  const subUnitIds: string[] = [];
  const cycleMap: Record<string, string> = {};

  for (const a of managerAssignments) {
    if (a.role === "platoon_commander") {
      const platoon = await prisma.platoon.findUnique({
        where: { id: a.unitId },
        select: {
          id: true,
          name: true,
          company: { select: { id: true, name: true } },
          squads: {
            select: { id: true, name: true },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
      });
      if (!platoon) continue;

      // Only add to cycleMap after confirming the platoon exists
      cycleMap[a.cycleId] = a.cycleName;
      platoon.squads.forEach((s) => subUnitIds.push(s.id));

      if (!structureByCycle[a.cycleId]) structureByCycle[a.cycleId] = [];
      let company = structureByCycle[a.cycleId].find((c) => c.id === platoon.company.id);
      if (!company) {
        company = { id: platoon.company.id, name: platoon.company.name, platoons: [] };
        structureByCycle[a.cycleId].push(company);
      }
      company.platoons.push({ id: platoon.id, name: platoon.name, squads: platoon.squads });
    } else if (a.role === "company_commander") {
      const company = await prisma.company.findUnique({
        where: { id: a.unitId },
        select: {
          id: true,
          name: true,
          platoons: {
            select: {
              id: true,
              name: true,
              squads: {
                select: { id: true, name: true },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              },
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
      });
      if (!company) continue;

      // Only add to cycleMap after confirming the company exists
      cycleMap[a.cycleId] = a.cycleName;
      company.platoons.forEach((p) => {
        subUnitIds.push(p.id);
        p.squads.forEach((s) => subUnitIds.push(s.id));
      });

      if (!structureByCycle[a.cycleId]) structureByCycle[a.cycleId] = [];
      structureByCycle[a.cycleId].push(company);
    }
  }

  const uniqueSubUnitIds = [...new Set(subUnitIds)];

  // Users assigned to sub-units
  const dbAssignments = await prisma.userCycleAssignment.findMany({
    where: { unitId: { in: uniqueSubUnitIds } },
    select: {
      id: true,
      role: true,
      unitType: true,
      unitId: true,
      cycleId: true,
      user: {
        select: { id: true, givenName: true, familyName: true, rank: true, email: true, phone: true, isAdmin: true },
      },
      cycle: { select: { name: true, isActive: true } },
    },
  });

  // Build full-path unit name map from structureByCycle: "פלוגה א / כיתה א" etc.
  const unitMap = new Map<string, string>();
  for (const cos of Object.values(structureByCycle)) {
    for (const co of cos) {
      unitMap.set(co.id, co.name);
      for (const pl of co.platoons) {
        unitMap.set(pl.id, `${co.name} / ${pl.name}`);
        for (const sq of pl.squads) {
          unitMap.set(sq.id, `${co.name} / ${pl.name} / ${sq.name}`);
        }
      }
    }
  }

  // Group by user
  const userMap = new Map<
    string,
    {
      id: string;
      givenName: string;
      familyName: string;
      rank: string | null;
      email: string;
      phone: string | null;
      isAdmin: boolean;
      cycleAssignments: {
        id: string;
        role: string;
        unitType: string;
        unitId: string;
        unitName: string;
        cycleId: string;
        cycle: { name: string; isActive: boolean };
      }[];
    }
  >();
  for (const a of dbAssignments) {
    if (!userMap.has(a.user.id)) userMap.set(a.user.id, { ...a.user, cycleAssignments: [] });
    userMap.get(a.user.id)!.cycleAssignments.push({
      id: a.id,
      role: a.role,
      unitType: a.unitType,
      unitId: a.unitId,
      unitName: unitMap.get(a.unitId) ?? "",
      cycleId: a.cycleId,
      cycle: a.cycle,
    });
  }

  // Pending invitations for sub-units
  const invitations = await prisma.invitation.findMany({
    where: { unitId: { in: uniqueSubUnitIds }, acceptedAt: null, expiresAt: { gt: new Date() } },
    include: { cycle: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

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
    token: inv.token,
  }));

  const cycles = Object.entries(cycleMap).map(([id, name]) => ({ id, name }));

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-6">מפקדים</h1>
      <CommanderUsersPanel
        initialUsers={Array.from(userMap.values())}
        initialInvitations={annotatedInvitations}
        cycles={cycles}
        structureByCycle={structureByCycle}
        invitableRoles={invitableRoles}
      />
    </div>
  );
}
