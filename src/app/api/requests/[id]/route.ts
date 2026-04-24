import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { getRequestScope } from "@/lib/api/request-scope";
import { getNextState, isValidTransition } from "@/lib/requests/workflow";
import { canActOnRequest } from "@/lib/requests/workflow";
import { sendPushToUsers } from "@/lib/push/send";
import { scheduleRemindersForRequest, cancelAllRemindersForRequest } from "@/lib/reminders/schedule";
import { parseMedicalAppointments } from "@/lib/requests/medical-appointments";
import { z } from "zod";
import { canEditRequest } from "@/lib/requests/permissions";
import type { RequestStatus, RequestType, Role, SessionUser } from "@/types";

const patchSchema = z.object({
  // Workflow action
  action: z.enum(["approve", "deny", "acknowledge"]).optional(),
  // Optional note (stored as a RequestAction)
  note: z.string().nullable().optional(),
  // Editable fields (only by assigned role)
  description: z.string().nullable().optional(),
  place: z.string().nullable().optional(),
  departureAt: z.string().nullable().optional(),
  returnAt: z.string().nullable().optional(),
  transportation: z.enum(["public_transit", "shuttle", "military_transport", "other"]).nullable().optional(),
  urgent: z.boolean().nullable().optional(),
  paramedicDate: z.string().nullable().optional(),
  medicalAppointments: z.array(z.object({
    id: z.string(),
    date: z.string(),
    place: z.string(),
    type: z.string(),
  })).nullable().optional(),
  sickDays: z.array(z.object({
    id: z.string(),
    date: z.string(),
  })).nullable().optional(),
  specialConditions: z.boolean().nullable().optional(),
  // Status/assignment override from connector (offline sync)
  status: z.enum(["open", "approved", "denied"]).optional(),
  assignedRole: z.enum(["squad_commander", "platoon_commander", "company_commander"]).nullable().optional(),
});

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const req = await prisma.request.findUnique({
    where: { id },
    include: {
      soldier: {
        select: {
          id: true,
          givenName: true,
          familyName: true,
          squad: { select: { name: true, platoon: { select: { name: true } } } },
        },
      },
      createdBy: {
        select: { givenName: true, familyName: true },
      },
      actions: {
        select: { id: true, action: true, note: true, userId: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!req) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { scope, error } = await getRequestScope(req.cycleId);
  if (error || !scope) return error!;

  if (!scope.soldierIds.includes(req.soldierId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ request: req, role: scope.role });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const req = await prisma.request.findUnique({
    where: { id },
    include: { soldier: { select: { familyName: true, givenName: true } } },
  });
  if (!req) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { scope, error, user } = await getRequestScope(req.cycleId);
  if (error || !scope) return error!;

  if (!scope.soldierIds.includes(req.soldierId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = parsed.data;
  const sessionUser = user as SessionUser;

  // Handle workflow action
  if (data.action) {
    const transition = getNextState(
      req.status as RequestStatus,
      req.assignedRole as Role,
      data.action,
      req.type as RequestType,
    );

    if (!transition) {
      return NextResponse.json({ error: "Invalid transition" }, { status: 400 });
    }

    if (!canActOnRequest(scope.role as Role, req.assignedRole as Role)) {
      return NextResponse.json({ error: "Not assigned to you" }, { status: 403 });
    }

    const [updated] = await prisma.$transaction([
      prisma.request.update({
        where: { id },
        data: {
          status: transition.newStatus,
          assignedRole: transition.newAssignedRole,
        },
      }),
      prisma.requestAction.create({
        data: {
          requestId: id,
          userId: sessionUser.id,
          action: data.action,
          note: data.note ?? null,
          userName: `${sessionUser.familyName} ${sessionUser.givenName}`,
        },
      }),
    ]);

    // Send push notification to users with the newly assigned role
    if (transition.newAssignedRole) {
      after(() =>
        notifyAssignedRole(req.cycleId, transition.newAssignedRole!, req.type, transition.newStatus, `${req.soldier.familyName} ${req.soldier.givenName}`, id, req.soldierId).catch((err) =>
          console.warn("[push] request assignment notification failed:", err),
        ),
      );
    }

    // Reconcile reminders (status may have changed to denied, or request approved)
    after(() =>
      scheduleRemindersForRequest(id).catch((err) =>
        console.warn("[reminders] scheduling failed:", err),
      ),
    );

    return NextResponse.json({ request: updated });
  }

  // Handle field edits — role-based permission check
  const hasFieldEditPermission = scope.role ? canEditRequest(scope.role as Role, req.type as RequestType) : false;
  if (!hasFieldEditPermission && !canActOnRequest(scope.role as Role, req.assignedRole as Role)) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }

  // If this is from the connector (has status/assignedRole), validate the transition
  if (data.status !== undefined || data.assignedRole !== undefined) {
    if (!isValidTransition(
      req.status as RequestStatus,
      req.assignedRole as Role | null,
      data.status as RequestStatus | undefined,
      data.assignedRole as Role | null | undefined,
      req.type as RequestType,
    )) {
      return NextResponse.json({ error: "Invalid state transition" }, { status: 400 });
    }

    const updated = await prisma.request.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.assignedRole !== undefined ? { assignedRole: data.assignedRole } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.place !== undefined ? { place: data.place } : {}),
        ...(data.departureAt !== undefined ? { departureAt: data.departureAt ? new Date(data.departureAt) : null } : {}),
        ...(data.returnAt !== undefined ? { returnAt: data.returnAt ? new Date(data.returnAt) : null } : {}),
        ...(data.transportation !== undefined ? { transportation: data.transportation } : {}),
        ...(data.urgent !== undefined ? { urgent: data.urgent } : {}),
        ...(data.paramedicDate !== undefined ? { paramedicDate: data.paramedicDate ? new Date(data.paramedicDate) : null } : {}),
        ...(data.medicalAppointments !== undefined ? { medicalAppointments: data.medicalAppointments ?? Prisma.DbNull } : {}),
        ...(data.sickDays !== undefined ? { sickDays: data.sickDays ?? Prisma.DbNull } : {}),
        ...(data.specialConditions !== undefined ? { specialConditions: data.specialConditions } : {}),
      },
    });

    // Connector path: notify users assigned to the new role (if role changed)
    if (data.assignedRole && data.assignedRole !== req.assignedRole) {
      const status = data.status ?? req.status;
      after(() =>
        notifyAssignedRole(req.cycleId, data.assignedRole!, req.type, status, `${req.soldier.familyName} ${req.soldier.givenName}`, id, req.soldierId).catch((err) =>
          console.warn("[push] request assignment notification failed:", err),
        ),
      );
    }

    // Notify on new appointments (connector path)
    if (data.medicalAppointments !== undefined && req.type === "medical") {
      const newDates = findNewAppointmentDates(req.medicalAppointments, data.medicalAppointments);
      if (newDates.length > 0) {
        after(() =>
          notifyNewAppointment(req.soldierId, `${req.soldier.familyName} ${req.soldier.givenName}`, newDates, sessionUser.id, id).catch((err) =>
            console.warn("[push] new appointment notification failed:", err),
          ),
        );
      }
    }

    // Reconcile reminders (status/assignedRole/appointments/departure may have changed)
    after(() =>
      scheduleRemindersForRequest(id).catch((err) =>
        console.warn("[reminders] scheduling failed:", err),
      ),
    );

    return NextResponse.json({ request: updated });
  }

  // Regular field edit
  const updateData: Record<string, unknown> = {};
  if (data.description !== undefined) updateData.description = data.description;
  if (data.place !== undefined) updateData.place = data.place;
  if (data.departureAt !== undefined) updateData.departureAt = data.departureAt ? new Date(data.departureAt) : null;
  if (data.returnAt !== undefined) updateData.returnAt = data.returnAt ? new Date(data.returnAt) : null;
  if (data.transportation !== undefined) updateData.transportation = data.transportation;
  if (data.urgent !== undefined) updateData.urgent = data.urgent;
  if (data.paramedicDate !== undefined) updateData.paramedicDate = data.paramedicDate ? new Date(data.paramedicDate) : null;
  if (data.medicalAppointments !== undefined) updateData.medicalAppointments = data.medicalAppointments ?? Prisma.DbNull;
  if (data.sickDays !== undefined) updateData.sickDays = data.sickDays ?? Prisma.DbNull;
  if (data.specialConditions !== undefined) updateData.specialConditions = data.specialConditions;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ request: req });
  }

  const updated = await prisma.request.update({
    where: { id },
    data: updateData,
  });

  // Notify on new appointments (regular edit path)
  if (data.medicalAppointments !== undefined && req.type === "medical") {
    const newDates = findNewAppointmentDates(req.medicalAppointments, data.medicalAppointments);
    if (newDates.length > 0) {
      after(() =>
        notifyNewAppointment(req.soldierId, `${req.soldier.familyName} ${req.soldier.givenName}`, newDates, sessionUser.id, id).catch((err) =>
          console.warn("[push] new appointment notification failed:", err),
        ),
      );
    }
  }

  // Reconcile reminders (appointments or departure may have changed)
  after(() =>
    scheduleRemindersForRequest(id).catch((err) =>
      console.warn("[reminders] scheduling failed:", err),
    ),
  );

  return NextResponse.json({ request: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const req = await prisma.request.findUnique({ where: { id } });
  if (!req) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { scope, error, user } = await getRequestScope(req.cycleId);
  if (error || !scope) return error!;

  // Role-based delete: same roles that can edit, plus the creator
  const isCreator = req.createdByUserId === user?.id;
  const hasEditPermission = scope.role ? canEditRequest(scope.role as Role, req.type as RequestType) : false;
  if (!isCreator && !hasEditPermission) {
    return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
  }
  // Can only delete open requests (assignedRole !== null)
  if (req.assignedRole === null) {
    return NextResponse.json({ error: "Can only delete open requests" }, { status: 400 });
  }

  // Cancel QStash messages before cascade-deleting the reminder rows
  const qstashMessageIds = await cancelAllRemindersForRequest(id);

  await prisma.request.delete({ where: { id } });

  // Log for debugging if any QStash messages were cancelled
  if (qstashMessageIds.length > 0) {
    console.info(`[reminders] cancelled ${qstashMessageIds.length} reminders for deleted request ${id}`);
  }

  return NextResponse.json({ success: true });
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

  // For company_commander assignments, also include deputy_company_commander
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

/**
 * Detect newly added appointments by comparing old vs new JSON arrays.
 * Returns dates of new appointments (by id).
 */
function findNewAppointmentDates(
  oldJson: unknown,
  newJson: unknown,
): string[] {
  const oldAppts = parseMedicalAppointments(oldJson as string | null);
  const newAppts = parseMedicalAppointments(newJson as string | null);
  const oldIds = new Set(oldAppts.map((a) => a.id));
  return newAppts.filter((a) => !oldIds.has(a.id) && a.date).map((a) => {
    const d = a.date.includes("T") ? new Date(a.date) : new Date(a.date + "T00:00:00");
    return d.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
  });
}

/**
 * Send notification to squad + platoon commanders when a new appointment is added.
 * Excludes the user who made the change.
 */
async function notifyNewAppointment(
  soldierId: string,
  soldierName: string,
  appointmentDates: string[],
  excludeUserId: string,
  requestId: string,
): Promise<void> {
  // Look up the soldier's squad → platoon
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: { squadId: true, squad: { select: { platoonId: true } } },
  });
  if (!soldier) return;

  // Find squad commanders for this squad + platoon commanders/sergeants for this platoon
  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      OR: [
        { unitId: soldier.squadId, role: "squad_commander" },
        { unitId: soldier.squad.platoonId, role: { in: ["platoon_commander", "platoon_sergeant"] } },
      ],
      cycle: { isActive: true },
    },
    select: { userId: true },
  });

  const userIds = [...new Set(assignments.map((a) => a.userId))].filter((id) => id !== excludeUserId);
  if (userIds.length === 0) return;

  for (const dateStr of appointmentDates) {
    await sendPushToUsers(
      userIds,
      {
        title: "תור נוסף",
        body: `תור ל-${dateStr} נוסף לבקשה רפואית של ${soldierName}`,
        url: `/requests/${requestId}`,
      },
      "newAppointmentEnabled",
    );
  }
}
