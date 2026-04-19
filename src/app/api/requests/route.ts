import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getRequestScope } from "@/lib/api/request-scope";
import { sendPushToUsers } from "@/lib/push/send";
import { z } from "zod";
import type { SessionUser, Role } from "@/types";

const createSchema = z.object({
  id: z.string().uuid().optional(),
  cycleId: z.string().uuid(),
  soldierId: z.string().uuid(),
  type: z.enum(["leave", "medical", "hardship"]),
  description: z.string().nullable().optional(),
  // Leave fields
  place: z.string().nullable().optional(),
  departureAt: z.string().nullable().optional(),
  returnAt: z.string().nullable().optional(),
  transportation: z.enum(["public_transit", "shuttle", "military_transport", "other"]).nullable().optional(),
  // Medical fields
  urgent: z.boolean().nullable().optional(),
  paramedicDate: z.string().nullable().optional(),
  medicalAppointments: z.array(z.object({
    id: z.string(),
    date: z.string(),
    place: z.string(),
    type: z.string(),
  })).nullable().optional(),
  sickLeaveDays: z.number().int().min(0).nullable().optional(),
  // Hardship fields
  specialConditions: z.boolean().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const { scope, error, user } = await getRequestScope(data.cycleId);
  if (error || !scope || !user) return error!;

  if (!scope.canCreate) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify soldier is in the user's scope
  if (!scope.soldierIds.includes(data.soldierId)) {
    return NextResponse.json({ error: "Soldier not in scope" }, { status: 403 });
  }

  // Medics can only create medical requests
  if (scope.role === "company_medic" && data.type !== "medical") {
    return NextResponse.json({ error: "Medics can only create medical requests" }, { status: 403 });
  }

  // Hardship coordinators can only create hardship requests
  if (scope.role === "hardship_coordinator" && data.type !== "hardship") {
    return NextResponse.json({ error: "Hardship coordinators can only create hardship requests" }, { status: 403 });
  }

  // Determine initial assignment based on creator's role
  let assignedRole: Role;
  if (scope.role === "squad_commander") {
    assignedRole = "platoon_commander";
  } else if (scope.role === "platoon_sergeant") {
    // Platoon sergeant creates → goes to platoon commander (not company)
    assignedRole = "platoon_commander";
  } else if (scope.role === "company_medic") {
    // Medic creates medical request → goes through regular approval chain
    assignedRole = "platoon_commander";
  } else if (scope.role === "hardship_coordinator") {
    // Coordinator creates hardship request → goes through regular approval chain
    assignedRole = "platoon_commander";
  } else if (scope.role === "platoon_commander") {
    // Platoon commander creates → goes directly to company commander
    assignedRole = "company_commander";
  } else {
    return NextResponse.json({ error: "Cannot determine assignment" }, { status: 400 });
  }

  const sessionUser = user as SessionUser;

  const req = await prisma.request.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      cycleId: data.cycleId,
      soldierId: data.soldierId,
      type: data.type,
      status: "open",
      assignedRole,
      createdByUserId: sessionUser.id,
      description: data.description ?? null,
      place: data.place ?? null,
      departureAt: data.departureAt ? new Date(data.departureAt) : null,
      returnAt: data.returnAt ? new Date(data.returnAt) : null,
      transportation: data.transportation ?? null,
      urgent: data.urgent ?? null,
      paramedicDate: data.paramedicDate ? new Date(data.paramedicDate) : null,
      medicalAppointments: data.medicalAppointments ?? Prisma.DbNull,
      sickLeaveDays: data.sickLeaveDays ?? null,
      specialConditions: data.specialConditions ?? null,
    },
    include: { soldier: { select: { familyName: true, givenName: true } } },
  });

  // Notify users with the assigned role about the new request
  const soldierName = `${req.soldier.familyName} ${req.soldier.givenName}`;
  after(() =>
    notifyAssignedRole(data.cycleId, assignedRole, data.type, "open", soldierName, req.id, data.soldierId).catch((err) =>
      console.warn("[push] request creation notification failed:", err),
    ),
  );

  return NextResponse.json({ request: req }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const cycleId = searchParams.get("cycleId");

  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getRequestScope(cycleId);
  if (error || !scope) return error!;

  const requests = await prisma.request.findMany({
    where: {
      cycleId,
      soldierId: { in: scope.soldierIds },
    },
    include: {
      soldier: {
        select: {
          id: true,
          givenName: true,
          familyName: true,
          squad: { select: { name: true, platoon: { select: { name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ requests, role: scope.role });
}

/**
 * Find all users assigned to the given role in the cycle and send them
 * a push notification about a request requiring their action.
 * The message varies by request status: opened, approved, or denied.
 */
const TYPE_LABELS: Record<string, string> = { leave: "יציאה", medical: "רפואה", hardship: 'ת"ש' };
const STATUS_TITLES: Record<string, string> = { open: "בקשה חדשה", approved: "בקשה אושרה", denied: "בקשה נדחתה" };
const STATUS_LABELS: Record<string, string> = { open: "חדשה", approved: "שאושרה", denied: "שנדחתה" };

async function notifyAssignedRole(cycleId: string, assignedRole: string, requestType: string, requestStatus: string, soldierName: string, requestId: string, soldierId: string): Promise<void> {
  // Look up soldier's unit hierarchy to scope notifications
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: { squadId: true, squad: { select: { platoonId: true, platoon: { select: { companyId: true } } } } },
  });
  if (!soldier) return;

  const roles: Role[] = assignedRole === "company_commander"
    ? ["company_commander", "deputy_company_commander"]
    : [assignedRole as Role];

  // Build unit filter based on assigned role
  const unitFilter =
    assignedRole === "squad_commander"
      ? { unitId: soldier.squadId }
      : assignedRole === "platoon_commander"
        ? { unitId: soldier.squad.platoonId }
        : { unitId: soldier.squad.platoon.companyId };

  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      cycleId,
      role: { in: roles },
      ...unitFilter,
    },
    select: { userId: true },
  });

  const userIds = [...new Set(assignments.map((a) => a.userId))];
  const typeLabel = TYPE_LABELS[requestType] ?? requestType;
  const title = STATUS_TITLES[requestStatus] ?? "בקשה חדשה";
  const statusLabel = STATUS_LABELS[requestStatus] ?? "חדשה";

  await sendPushToUsers(
    userIds,
    {
      title,
      body: `בקשה ${typeLabel} ${statusLabel} עבור ${soldierName} דורשת את פעולתך`,
      url: `/requests/${requestId}`,
    },
    "requestAssignmentEnabled",
  );
}
