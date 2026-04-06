import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getRequestScope } from "@/lib/api/request-scope";
import { getNextState } from "@/lib/requests/workflow";
import { canActOnRequest } from "@/lib/requests/workflow";
import { sendPushToUsers } from "@/lib/push/send";
import { z } from "zod";
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
  appointmentDate: z.string().nullable().optional(),
  appointmentPlace: z.string().nullable().optional(),
  appointmentType: z.string().nullable().optional(),
  sickLeaveDays: z.number().int().min(0).nullable().optional(),
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

  const req = await prisma.request.findUnique({ where: { id } });
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
      // Fire and forget — don't block the response
      notifyAssignedRole(req.cycleId, transition.newAssignedRole).catch((err) =>
        console.warn("[push] request assignment notification failed:", err),
      );
    }

    return NextResponse.json({ request: updated });
  }

  // Handle field edits — only the assigned role can edit
  if (!canActOnRequest(scope.role as Role, req.assignedRole as Role)) {
    return NextResponse.json({ error: "Only the assigned role can edit" }, { status: 403 });
  }

  // If this is from the connector (has status/assignedRole), apply directly
  if (data.status !== undefined || data.assignedRole !== undefined) {
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
        ...(data.appointmentDate !== undefined ? { appointmentDate: data.appointmentDate ? new Date(data.appointmentDate) : null } : {}),
        ...(data.appointmentPlace !== undefined ? { appointmentPlace: data.appointmentPlace } : {}),
        ...(data.appointmentType !== undefined ? { appointmentType: data.appointmentType } : {}),
        ...(data.sickLeaveDays !== undefined ? { sickLeaveDays: data.sickLeaveDays } : {}),
        ...(data.specialConditions !== undefined ? { specialConditions: data.specialConditions } : {}),
      },
    });

    // Connector path: notify users assigned to the new role (if role changed)
    if (data.assignedRole && data.assignedRole !== req.assignedRole) {
      notifyAssignedRole(req.cycleId, data.assignedRole).catch((err) =>
        console.warn("[push] request assignment notification failed:", err),
      );
    }

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
  if (data.appointmentDate !== undefined) updateData.appointmentDate = data.appointmentDate ? new Date(data.appointmentDate) : null;
  if (data.appointmentPlace !== undefined) updateData.appointmentPlace = data.appointmentPlace;
  if (data.appointmentType !== undefined) updateData.appointmentType = data.appointmentType;
  if (data.sickLeaveDays !== undefined) updateData.sickLeaveDays = data.sickLeaveDays;
  if (data.specialConditions !== undefined) updateData.specialConditions = data.specialConditions;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ request: req });
  }

  const updated = await prisma.request.update({
    where: { id },
    data: updateData,
  });

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

  const { scope, error } = await getRequestScope(req.cycleId);
  if (error || !scope) return error!;

  // Only the creator can delete, and only open requests
  if (req.status !== "open") {
    return NextResponse.json({ error: "Can only delete open requests" }, { status: 400 });
  }

  await prisma.request.delete({ where: { id } });
  return NextResponse.json({ success: true });
}

/**
 * Find all users assigned to the given role in the cycle and send them
 * a push notification about a new request requiring their action.
 */
async function notifyAssignedRole(cycleId: string, assignedRole: string): Promise<void> {
  // For company_commander assignments, also include deputy_company_commander
  const roles: Role[] = assignedRole === "company_commander"
    ? ["company_commander", "deputy_company_commander"]
    : [assignedRole as Role];

  const assignments = await prisma.userCycleAssignment.findMany({
    where: {
      cycleId,
      role: { in: roles },
    },
    select: { userId: true },
  });

  const userIds = [...new Set(assignments.map((a) => a.userId))];

  await sendPushToUsers(
    userIds,
    {
      title: "בקשה חדשה ממתינה לטיפולך",
      body: "יש בקשה שדורשת את פעולתך",
      url: "/requests?filter=action",
    },
    "requestAssignmentEnabled",
  );
}
