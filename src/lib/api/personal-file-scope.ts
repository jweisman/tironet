import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import type { SessionUser, CycleAssignment } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";

export interface PersonalFileScope {
  role: "platoon_commander" | "company_commander";
  platoonIds: string[];
}

interface ScopeResult {
  scope: PersonalFileScope | null;
  error: NextResponse | null;
  user: SessionUser | null;
}

export async function getPersonalFileScope(cycleId: string): Promise<ScopeResult> {
  const session = await auth();
  if (!session?.user) {
    return {
      scope: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      user: null,
    };
  }

  const user = session.user as SessionUser;

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

  if (role === "platoon_commander") {
    return {
      scope: { role: "platoon_commander", platoonIds: [assignment.unitId] },
      error: null,
      user,
    };
  }

  if (role === "company_commander") {
    const platoons = await prisma.platoon.findMany({
      where: { companyId: assignment.unitId },
      select: { id: true },
    });
    return {
      scope: { role: "company_commander", platoonIds: platoons.map((p) => p.id) },
      error: null,
      user,
    };
  }

  return {
    scope: null,
    error: NextResponse.json({ error: "Personal file not available for this role" }, { status: 403 }),
    user,
  };
}
