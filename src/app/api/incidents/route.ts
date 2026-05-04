import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { effectiveRole } from "@/lib/auth/permissions";
import { sendPushToUsers } from "@/lib/push/send";
import { INCIDENT_TYPE_LABELS, type IncidentType } from "@/lib/incidents/constants";
import type { Role } from "@/types";

const postSchema = z.object({
  id: z.string().uuid().optional(),
  soldierId: z.string().uuid(),
  type: z.enum(["commendation", "discipline", "safety"]),
  subtype: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().min(1),
  response: z.string().nullable().optional(),
  createdByName: z.string().min(1),
  createdByUserId: z.string().uuid(),
});

async function isSoldierInScope(
  rawRole: string,
  unitId: string,
  squadId: string,
): Promise<boolean> {
  const role = effectiveRole(rawRole as Role);
  if (role === "squad_commander") return unitId === squadId;
  if (role === "platoon_commander") {
    const squad = await prisma.squad.findUnique({
      where: { id: squadId },
      select: { platoonId: true },
    });
    return squad?.platoonId === unitId;
  }
  if (role === "company_commander") {
    const squad = await prisma.squad.findUnique({
      where: { id: squadId },
      select: { platoon: { select: { companyId: true } } },
    });
    return squad?.platoon.companyId === unitId;
  }
  return false;
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { id: clientId, soldierId, type, subtype, date, description, response, createdByName, createdByUserId } = parsed.data;

  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: { cycleId: true, squadId: true },
  });
  if (!soldier) {
    return NextResponse.json({ error: "Soldier not found" }, { status: 404 });
  }

  const assignment = session.user.cycleAssignments.find(
    (a) => a.cycleId === soldier.cycleId,
  );
  if (!assignment) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const inScope = await isSoldierInScope(assignment.role, assignment.unitId, soldier.squadId);
  if (!inScope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const incident = await prisma.incident.create({
    data: {
      ...(clientId ? { id: clientId } : {}),
      soldierId,
      type,
      subtype,
      date: new Date(date + "T00:00:00.000Z"),
      description,
      response: response ?? null,
      createdByName,
      createdByUserId,
    },
  });

  if (type === "discipline" || type === "safety") {
    after(() =>
      notifySevereIncident(soldierId, type, createdByUserId).catch((err) =>
        console.warn("[push] severe-incident notification failed:", err),
      ),
    );
  }

  return NextResponse.json(incident, { status: 201 });
}

/**
 * Notify the soldier's chain of command (squad/platoon/company) that a severe
 * incident was added. Excludes the user who created it. Only fires for
 * discipline and safety incidents.
 */
async function notifySevereIncident(
  soldierId: string,
  type: IncidentType,
  excludeUserId: string,
): Promise<void> {
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: {
      familyName: true,
      givenName: true,
      squadId: true,
      squad: { select: { platoonId: true, platoon: { select: { companyId: true } } } },
    },
  });
  if (!soldier) return;

  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      OR: [
        { unitId: soldier.squadId, role: "squad_commander" },
        { unitId: soldier.squad.platoonId, role: { in: ["platoon_commander", "platoon_sergeant"] } },
        { unitId: soldier.squad.platoon.companyId, role: { in: ["company_commander", "deputy_company_commander"] } },
      ],
      cycle: { isActive: true },
    },
    select: { userId: true },
  });

  const userIds = [...new Set(assignments.map((a) => a.userId))].filter((id) => id !== excludeUserId);
  if (userIds.length === 0) return;

  const typeLabel = INCIDENT_TYPE_LABELS[type];
  const soldierName = `${soldier.familyName} ${soldier.givenName}`;
  await sendPushToUsers(
    userIds,
    {
      title: `אירוע ${typeLabel}`,
      body: `אירוע ${typeLabel} נוסף ל${soldierName}`,
      url: `/soldiers/${soldierId}`,
    },
    "severeIncidentEnabled",
  );
}
