import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { ROLE_LABELS, effectiveRole, canInviteRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cycleAssignments } = session.user;

  // Only company/platoon commanders can manage subordinates
  const managerAssignments = cycleAssignments.filter((a) => effectiveRole(a.role as Role) !== "squad_commander");
  if (managerAssignments.length === 0) {
    return NextResponse.json({
      users: [],
      invitations: [],
      structureByCycle: {},
      cycles: [],
    });
  }

  // Collect sub-unit IDs and build structureByCycle
  const subUnitIds: string[] = [];
  const structureByCycle: Record<
    string,
    { id: string; name: string; platoons: { id: string; name: string; squads: { id: string; name: string }[] }[] }[]
  > = {};
  const cycleMap: Record<string, string> = {};

  for (const a of managerAssignments) {
    cycleMap[a.cycleId] = a.cycleName;

    const eRole = effectiveRole(a.role as Role);
    if (eRole === "platoon_commander") {
      const platoon = await prisma.platoon.findUnique({
        where: { id: a.unitId },
        select: {
          id: true,
          name: true,
          company: { select: { id: true, name: true } },
          squads: { select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
        },
      });
      if (!platoon) continue;

      subUnitIds.push(platoon.id); // Include platoon itself (for platoon-level assignments like platoon_sergeant)
      platoon.squads.forEach((s) => subUnitIds.push(s.id));

      if (!structureByCycle[a.cycleId]) structureByCycle[a.cycleId] = [];
      // Merge into existing company entry if present
      let company = structureByCycle[a.cycleId].find((c) => c.id === platoon.company.id);
      if (!company) {
        company = { id: platoon.company.id, name: platoon.company.name, platoons: [] };
        structureByCycle[a.cycleId].push(company);
      }
      company.platoons.push({ id: platoon.id, name: platoon.name, squads: platoon.squads });
    } else if (eRole === "company_commander") {
      const company = await prisma.company.findUnique({
        where: { id: a.unitId },
        select: {
          id: true,
          name: true,
          platoons: {
            select: {
              id: true,
              name: true,
              squads: { select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] },
            },
            orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          },
        },
      });
      if (!company) continue;

      company.platoons.forEach((p) => p.squads.forEach((s) => subUnitIds.push(s.id)));
      // Also collect platoon IDs for platoon_commander invitations
      company.platoons.forEach((p) => subUnitIds.push(p.id));

      if (!structureByCycle[a.cycleId]) structureByCycle[a.cycleId] = [];
      structureByCycle[a.cycleId].push(company);
    }
  }

  const uniqueSubUnitIds = [...new Set(subUnitIds)];

  // Users assigned to those sub-units
  const assignments = await prisma.userCycleAssignment.findMany({
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
  for (const companies of Object.values(structureByCycle)) {
    for (const co of companies) {
      unitMap.set(co.id, co.name);
      for (const pl of co.platoons) {
        unitMap.set(pl.id, `${co.name} / ${pl.name}`);
        for (const sq of pl.squads) {
          unitMap.set(sq.id, `${co.name} / ${pl.name} / ${sq.name}`);
        }
      }
    }
  }

  // Platoon IDs the viewer commands as platoon_commander (not company_commander).
  // Used to exclude peer platoon_commander assignments from the list.
  const viewerPlatoonIds = new Set(
    managerAssignments
      .filter((a) => effectiveRole(a.role as Role) === "platoon_commander")
      .map((a) => a.unitId)
  );

  // Group assignments by user
  const userMap = new Map<
    string,
    {
      id: string;
      givenName: string;
      familyName: string;
      rank: string | null;
      email: string | null;
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
  for (const a of assignments) {
    // For platoon-level assignments on the viewer's own platoon(s), only show roles the viewer can invite
    if (viewerPlatoonIds.has(a.unitId) && (a.role === "platoon_commander" || a.role === "platoon_sergeant")) {
      const viewerAssignment = managerAssignments.find((m) => m.unitId === a.unitId);
      if (!viewerAssignment || !canInviteRole(viewerAssignment.role as Role, a.role as Role)) continue;
    }
    if (!userMap.has(a.user.id)) {
      userMap.set(a.user.id, { ...a.user, cycleAssignments: [] });
    }
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

  // Pending invitations for those sub-units
  const invitations = await prisma.invitation.findMany({
    where: {
      unitId: { in: uniqueSubUnitIds },
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
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
    invitedByUserId: inv.invitedByUserId,
  }));

  const cycles = Object.entries(cycleMap).map(([id, name]) => ({ id, name }));

  return NextResponse.json({
    users: Array.from(userMap.values()),
    invitations: annotatedInvitations,
    structureByCycle,
    cycles,
  });
}
