import { auth } from "@/lib/auth/auth";
import { prisma } from "@/lib/db/prisma";
import { NextResponse } from "next/server";
import type { SessionUser, CycleAssignment } from "@/types";
import { effectiveRole } from "@/lib/auth/permissions";

export interface CalendarScope {
  role: "squad_commander" | "platoon_commander" | "company_commander" | "instructor" | "company_medic";
  platoonIds: string[];
  companyId?: string;
  /** Only for squad commanders — filters request events to their squad's soldiers */
  squadId?: string;
}

interface ScopeResult {
  scope: CalendarScope | null;
  error: NextResponse | null;
  user: SessionUser | null;
}

export async function getCalendarScope(cycleId: string): Promise<ScopeResult> {
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

  // Hardship coordinators have no date-based data relevant to the calendar
  if (role === "hardship_coordinator") {
    return {
      scope: null,
      error: NextResponse.json({ error: "Calendar not available for this role" }, { status: 403 }),
      user,
    };
  }

  if (role === "squad_commander") {
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
    return {
      scope: {
        role: "squad_commander",
        platoonIds: [squad.platoonId],
        squadId: assignment.unitId,
      },
      error: null,
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
