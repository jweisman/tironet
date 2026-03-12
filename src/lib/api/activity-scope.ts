import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import type { SessionUser, CycleAssignment } from "@/types";

export interface ActivityScope {
  role: "squad_commander" | "platoon_commander" | "company_commander" | "admin";
  platoonIds: string[];
  squadId?: string; // only for squad_commander
  canCreate: boolean; // platoon_commander or admin
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

  // Admin sees everything
  if (user.isAdmin) {
    // Get all platoon ids for this cycle
    const platoons = await prisma.platoon.findMany({
      where: { company: { cycleId } },
      select: { id: true },
    });
    const platoonIds = platoons.map((p) => p.id);

    const scope: ActivityScope = {
      role: "admin",
      platoonIds,
      canCreate: true,
      canEditMetadataForPlatoon: () => true,
    };
    return { scope, error: null, user };
  }

  // Find the assignment for this cycle
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

  if (assignment.role === "squad_commander") {
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
      squadId: assignment.unitId,
      canCreate: false,
      canEditMetadataForPlatoon: () => false,
    };
    return { scope, error: null, user };
  }

  if (assignment.role === "platoon_commander") {
    // unitId is a platoonId
    const platoonId = assignment.unitId;
    const scope: ActivityScope = {
      role: "platoon_commander",
      platoonIds: [platoonId],
      canCreate: true,
      canEditMetadataForPlatoon: (pid: string) => pid === platoonId,
    };
    return { scope, error: null, user };
  }

  if (assignment.role === "company_commander") {
    // unitId is a companyId; get all platoons in that company
    const platoons = await prisma.platoon.findMany({
      where: { companyId: assignment.unitId },
      select: { id: true },
    });
    const platoonIds = platoons.map((p) => p.id);
    const scope: ActivityScope = {
      role: "company_commander",
      platoonIds,
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
