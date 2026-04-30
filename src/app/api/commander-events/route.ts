import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";

const COMMANDER_EVENT_TYPES = ["leave", "medical"] as const;

const CreateSchema = z.object({
  cycleId: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.enum(COMMANDER_EVENT_TYPES),
  description: z.string().max(1000).optional(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Resolve the platoonId for a target user's assignment in the given cycle.
 * Returns null if the user doesn't have a squad/platoon-level assignment.
 */
async function resolveTargetPlatoonId(
  userId: string,
  cycleId: string,
): Promise<string | null> {
  const assignment = await prisma.userCycleAssignment.findUnique({
    where: { uq_user_cycle: { userId, cycleId } },
    select: { role: true, unitType: true, unitId: true },
  });
  if (!assignment) return null;

  if (assignment.unitType === "platoon") return assignment.unitId;
  if (assignment.unitType === "squad") {
    const squad = await prisma.squad.findUnique({
      where: { id: assignment.unitId },
      select: { platoonId: true },
    });
    return squad?.platoonId ?? null;
  }
  // Company-level roles — skip for now
  return null;
}

/**
 * Check if the caller has permission to manage events for the target user.
 * Returns the caller's visible platoon IDs for scope validation.
 */
async function getCallerScope(
  callerAssignments: { role: string; unitId: string; unitType: string; cycleId: string }[],
  cycleId: string,
): Promise<{ platoonIds: string[] } | null> {
  const cycleAssignments = callerAssignments.filter((a) => a.cycleId === cycleId);
  if (cycleAssignments.length === 0) return null;

  const platoonIds: string[] = [];

  for (const a of cycleAssignments) {
    const eRole = effectiveRole(a.role as Role);
    if (eRole === "platoon_commander") {
      platoonIds.push(a.unitId);
    } else if (eRole === "company_commander") {
      const company = await prisma.company.findUnique({
        where: { id: a.unitId },
        select: { platoons: { select: { id: true } } },
      });
      if (company) {
        platoonIds.push(...company.platoons.map((p) => p.id));
      }
    }
  }

  return platoonIds.length > 0 ? { platoonIds } : null;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { cycleId, userId, type, description, startDate } = parsed.data;
  const endDate = parsed.data.endDate ?? startDate;

  if (endDate < startDate) {
    return NextResponse.json({ error: "endDate must be >= startDate" }, { status: 400 });
  }

  // Check caller scope
  const scope = await getCallerScope(session.user.cycleAssignments, cycleId);
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve target user's platoon
  const platoonId = await resolveTargetPlatoonId(userId, cycleId);
  if (!platoonId) {
    return NextResponse.json(
      { error: "Target user has no platoon-level assignment in this cycle" },
      { status: 400 },
    );
  }

  // Verify the target platoon is within the caller's scope
  if (!scope.platoonIds.includes(platoonId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Resolve target user's name for denormalization
  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { familyName: true, givenName: true },
  });
  if (!targetUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const event = await prisma.commanderEvent.create({
    data: {
      cycleId,
      userId,
      userName: `${targetUser.familyName} ${targetUser.givenName}`,
      platoonId,
      type,
      description: description ?? null,
      startDate: new Date(startDate + "T00:00:00.000Z"),
      endDate: new Date(endDate + "T00:00:00.000Z"),
    },
  });

  return NextResponse.json(event, { status: 201 });
}
