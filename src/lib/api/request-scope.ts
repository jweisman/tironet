import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import type { SessionUser, CycleAssignment, Role } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";

export interface RequestScope {
  role: Role;
  /** Soldier IDs the user can see/create requests for */
  soldierIds: string[];
  /** Squad IDs the user commands (for scope checks) */
  squadIds: string[];
  /** Platoon IDs the user can access */
  platoonIds: string[];
  canCreate: boolean; // squad_commander and platoon_commander can create
}

interface ScopeResult {
  scope: RequestScope | null;
  error: NextResponse | null;
  user: SessionUser | null;
}

export async function getRequestScope(cycleId: string): Promise<ScopeResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    };
  }

  const user = session.user as SessionUser;

  // Admins are scoped by their cycle assignment, not by isAdmin flag
  const assignment: CycleAssignment | undefined = user.cycleAssignments.find(
    (a) => a.cycleId === cycleId,
  );

  if (!assignment) {
    return {
      scope: null,
      error: NextResponse.json({ error: "No assignment for this cycle" }, { status: 403 }),
      user,
    };
  }

  const role = effectiveRole(assignment.role);

  if (role === "squad_commander") {
    const squad = await prisma.squad.findUnique({
      where: { id: assignment.unitId },
      select: { id: true, platoonId: true },
    });
    if (!squad) {
      return {
        scope: null,
        error: NextResponse.json({ error: "Squad not found" }, { status: 404 }),
        user,
      };
    }
    const soldiers = await prisma.soldier.findMany({
      where: { squadId: squad.id, cycleId },
      select: { id: true },
    });
    return {
      scope: {
        role: "squad_commander",
        soldierIds: soldiers.map((s) => s.id),
        squadIds: [squad.id],
        platoonIds: [squad.platoonId],
        canCreate: true,
      },
      error: null,
      user,
    };
  }

  if (role === "platoon_commander") {
    const squads = await prisma.squad.findMany({
      where: { platoonId: assignment.unitId },
      select: { id: true },
    });
    const squadIds = squads.map((s) => s.id);
    const soldiers = await prisma.soldier.findMany({
      where: { squadId: { in: squadIds }, cycleId },
      select: { id: true },
    });
    return {
      scope: {
        role: assignment.role,
        soldierIds: soldiers.map((s) => s.id),
        squadIds,
        platoonIds: [assignment.unitId],
        canCreate: true,
      },
      error: null,
      user,
    };
  }

  if (role === "company_commander") {
    const platoons = await prisma.platoon.findMany({
      where: { companyId: assignment.unitId },
      select: { id: true },
    });
    const platoonIds = platoons.map((p) => p.id);
    const squads = await prisma.squad.findMany({
      where: { platoonId: { in: platoonIds } },
      select: { id: true },
    });
    const squadIds = squads.map((s) => s.id);
    const soldiers = await prisma.soldier.findMany({
      where: { squadId: { in: squadIds }, cycleId },
      select: { id: true },
    });
    return {
      scope: {
        role: "company_commander",
        soldierIds: soldiers.map((s) => s.id),
        squadIds,
        platoonIds,
        canCreate: false,
      },
      error: null,
      user,
    };
  }

  return {
    scope: null,
    error: NextResponse.json({ error: "Unknown role" }, { status: 403 }),
    user,
  };
}
