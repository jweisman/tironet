import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import type { SessionUser, CycleAssignment } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";

export interface ReportScope {
  role: "platoon_commander" | "company_commander" | "instructor" | "company_medic";
  platoonIds: string[];
  companyId?: string;
}

interface ScopeResult {
  scope: ReportScope | null;
  error: NextResponse | null;
  user: SessionUser | null;
}

export async function getReportScope(cycleId: string): Promise<ScopeResult> {
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

  // Squad commanders cannot access reports
  if (role === "squad_commander") {
    return {
      scope: null,
      error: NextResponse.json({ error: "Reports not available for squad commanders" }, { status: 403 }),
      user,
    };
  }

  if (role === "platoon_commander") {
    return {
      scope: {
        role: "platoon_commander",
        platoonIds: [assignment.unitId],
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
    return {
      scope: {
        role: "company_commander",
        platoonIds: platoons.map((p) => p.id),
        companyId: assignment.unitId,
      },
      error: null,
      user,
    };
  }

  if (assignment.role === "instructor" || assignment.role === "company_medic") {
    // Company-level roles with limited report access
    const platoons = await prisma.platoon.findMany({
      where: { companyId: assignment.unitId },
      select: { id: true },
    });
    return {
      scope: {
        role: assignment.role,
        platoonIds: platoons.map((p) => p.id),
        companyId: assignment.unitId,
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
