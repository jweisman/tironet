import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import type { SessionUser, CycleAssignment } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";

export interface ActivityScope {
  role: "squad_commander" | "platoon_commander" | "company_commander";
  platoonIds: string[];
  platoons: { id: string; name: string }[]; // id + name for create form
  squadId?: string; // only for squad_commander
  canCreate: boolean; // platoon_commander only
  canEditMetadataForPlatoon: (platoonId: string) => boolean;
}

interface ScopeResult {
  scope: ActivityScope | null;
  error: NextResponse | null;
  user: SessionUser | null;
}

export async function getActivityScope(cycleId: string): Promise<ScopeResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    };
  }

  const user = session.user as SessionUser;

  // Find the assignment for this cycle (admins are scoped by assignment too)
  const assignment: CycleAssignment | undefined = user.cycleAssignments.find(
    (a) => a.cycleId === cycleId
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
    // unitId is a squadId; find its platoon
    const squad = await prisma.squad.findUnique({
      where: { id: assignment.unitId },
      select: { platoonId: true },
    });
    if (!squad) {
      return {
        scope: null,
        error: NextResponse.json({ error: "Squad not found" }, { status: 404 }),
        user,
      };
    }
    const scope: ActivityScope = {
      role: "squad_commander",
      platoonIds: [squad.platoonId],
      platoons: [],
      squadId: assignment.unitId,
      canCreate: false,
      canEditMetadataForPlatoon: () => false,
    };
    return { scope, error: null, user };
  }

  if (role === "platoon_commander") {
    // unitId is a platoonId
    const platoonId = assignment.unitId;
    const platoon = await prisma.platoon.findUnique({
      where: { id: platoonId },
      select: { id: true, name: true },
    });
    const scope: ActivityScope = {
      role: "platoon_commander",
      platoonIds: [platoonId],
      platoons: platoon ? [platoon] : [],
      canCreate: true,
      canEditMetadataForPlatoon: (pid: string) => pid === platoonId,
    };
    return { scope, error: null, user };
  }

  if (role === "company_commander") {
    // unitId is a companyId; get all platoons in that company
    const platoons = await prisma.platoon.findMany({
      where: { companyId: assignment.unitId },
      select: { id: true, name: true },
    });
    const scope: ActivityScope = {
      role: "company_commander",
      platoonIds: platoons.map((p) => p.id),
      platoons,
      canCreate: false,
      canEditMetadataForPlatoon: () => false,
    };
    return { scope, error: null, user };
  }

  return {
    scope: null,
    error: NextResponse.json({ error: "Unknown role" }, { status: 403 }),
    user,
  };
}
