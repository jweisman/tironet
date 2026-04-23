import { prisma } from "@/lib/db/prisma";
import { parseMedicalAppointments } from "@/lib/requests/medical-appointments";
import { publishReminder, cancelReminder } from "./qstash";

interface TimeEvent {
  /** For medical: the appointment JSON id. For departure: null. */
  appointmentId: string | null;
  reminderType: "medical" | "departure";
  /** The event time as a Date */
  eventAt: Date;
}

/**
 * Find squad + platoon commanders for a soldier (active cycles only).
 * Returns array of { userId, reminderLeadMinutes }.
 */
async function getCommandersWithPreferences(
  soldierId: string,
): Promise<{ userId: string; reminderLeadMinutes: number }[]> {
  const soldier = await prisma.soldier.findUnique({
    where: { id: soldierId },
    select: { squadId: true, squad: { select: { platoonId: true } } },
  });
  if (!soldier) return [];

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

  const userIds = [...new Set(assignments.map((a) => a.userId))];
  if (userIds.length === 0) return [];

  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, reminderLeadMinutes: true },
  });

  const prefMap = new Map(prefs.map((p) => [p.userId, p.reminderLeadMinutes]));

  return userIds
    .filter((id) => {
      const lead = prefMap.get(id);
      return lead != null && lead > 0;
    })
    .map((id) => ({ userId: id, reminderLeadMinutes: prefMap.get(id)! }));
}

/**
 * Extract time-bearing events from a request.
 * Medical appointments must have a time component (contain 'T' in the date string).
 * Leave departures use the departureAt field.
 */
function extractTimeEvents(request: {
  type: string;
  departureAt: Date | null;
  medicalAppointments: unknown;
}): TimeEvent[] {
  const events: TimeEvent[] = [];

  if (request.type === "leave" && request.departureAt) {
    events.push({
      appointmentId: null,
      reminderType: "departure",
      eventAt: request.departureAt,
    });
  }

  if (request.type === "medical") {
    const appointments = parseMedicalAppointments(
      request.medicalAppointments as string | null,
    );
    for (const appt of appointments) {
      if (!appt.date.includes("T")) continue; // skip date-only
      events.push({
        appointmentId: appt.id,
        reminderType: "medical",
        eventAt: new Date(appt.date),
      });
    }
  }

  return events;
}

/**
 * Reconcile scheduled reminders for a request.
 * Idempotent — reads current state and creates/updates/deletes as needed.
 */
export async function scheduleRemindersForRequest(
  requestId: string,
): Promise<void> {
  const request = await prisma.request.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      type: true,
      status: true,
      departureAt: true,
      medicalAppointments: true,
      soldierId: true,
    },
  });

  if (!request) return;

  // Denied requests should have no reminders
  if (request.status === "denied") {
    await cancelAllRemindersForRequest(requestId);
    return;
  }

  const events = extractTimeEvents(request);
  const now = new Date();

  // Get commanders with reminder preferences
  const commanders = await getCommandersWithPreferences(request.soldierId);

  // Load existing reminders for this request
  const existing = await prisma.scheduledReminder.findMany({
    where: { requestId },
  });

  // Build a set of desired reminders (keyed by unique constraint fields)
  const desiredKeys = new Set<string>();

  for (const commander of commanders) {
    for (const event of events) {
      const scheduledFor = new Date(
        event.eventAt.getTime() - commander.reminderLeadMinutes * 60 * 1000,
      );

      // Skip if the reminder time is in the past
      if (scheduledFor <= now) continue;

      const key = `${requestId}|${commander.userId}|${event.appointmentId ?? ""}|${event.reminderType}`;
      desiredKeys.add(key);

      // Find existing reminder for this combination
      const existingReminder = existing.find(
        (r) =>
          r.userId === commander.userId &&
          r.appointmentId === event.appointmentId &&
          r.reminderType === event.reminderType,
      );

      if (existingReminder) {
        // If already fired, skip
        if (existingReminder.fired) continue;

        // If scheduledFor changed, cancel old and reschedule
        if (existingReminder.scheduledFor.getTime() !== scheduledFor.getTime()) {
          await cancelReminder(existingReminder.qstashMessageId);
          const notBefore = Math.floor(scheduledFor.getTime() / 1000);
          const messageId = await publishReminder(existingReminder.id, notBefore);
          await prisma.scheduledReminder.update({
            where: { id: existingReminder.id },
            data: {
              scheduledFor,
              eventAt: event.eventAt,
              qstashMessageId: messageId,
            },
          });
        }
      } else {
        // Create new reminder
        const reminder = await prisma.scheduledReminder.create({
          data: {
            requestId,
            userId: commander.userId,
            appointmentId: event.appointmentId,
            reminderType: event.reminderType,
            scheduledFor,
            eventAt: event.eventAt,
          },
        });

        const notBefore = Math.floor(scheduledFor.getTime() / 1000);
        const messageId = await publishReminder(reminder.id, notBefore);
        if (messageId) {
          await prisma.scheduledReminder.update({
            where: { id: reminder.id },
            data: { qstashMessageId: messageId },
          });
        }
      }
    }
  }

  // Delete reminders for events that no longer exist or commanders that no longer qualify
  for (const rem of existing) {
    if (rem.fired) continue;
    const key = `${requestId}|${rem.userId}|${rem.appointmentId ?? ""}|${rem.reminderType}`;
    if (!desiredKeys.has(key)) {
      await cancelReminder(rem.qstashMessageId);
      await prisma.scheduledReminder.delete({ where: { id: rem.id } });
    }
  }
}

/**
 * Cancel all unfired reminders for a request.
 * Returns the QStash message IDs that were cancelled (for use before cascade delete).
 */
export async function cancelAllRemindersForRequest(
  requestId: string,
): Promise<string[]> {
  const reminders = await prisma.scheduledReminder.findMany({
    where: { requestId, fired: false },
    select: { id: true, qstashMessageId: true },
  });

  const messageIds: string[] = [];
  for (const rem of reminders) {
    if (rem.qstashMessageId) messageIds.push(rem.qstashMessageId);
    await cancelReminder(rem.qstashMessageId);
  }

  await prisma.scheduledReminder.deleteMany({
    where: { requestId, fired: false },
  });

  return messageIds;
}

/**
 * Reschedule all reminders for a user after their preference changes.
 */
export async function rescheduleRemindersForUser(
  userId: string,
): Promise<void> {
  // Cancel all unfired reminders for this user
  const existing = await prisma.scheduledReminder.findMany({
    where: { userId, fired: false },
    select: { id: true, qstashMessageId: true },
  });

  for (const rem of existing) {
    await cancelReminder(rem.qstashMessageId);
  }

  await prisma.scheduledReminder.deleteMany({
    where: { userId, fired: false },
  });

  // Load new preference
  const pref = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: { reminderLeadMinutes: true },
  });

  if (!pref?.reminderLeadMinutes || pref.reminderLeadMinutes <= 0) return;

  // Find the user's assignments to determine which soldiers they oversee
  const assignments = await prisma.userCycleAssignment.findMany({
    where: { userId, cycle: { isActive: true } },
    select: { unitId: true, unitType: true, role: true },
  });

  // Collect soldier IDs in the user's scope
  const squadIds = new Set<string>();
  const platoonIds = new Set<string>();

  for (const a of assignments) {
    if (a.role === "squad_commander" && a.unitType === "squad") {
      squadIds.add(a.unitId);
    } else if (
      (a.role === "platoon_commander" || a.role === "platoon_sergeant") &&
      a.unitType === "platoon"
    ) {
      platoonIds.add(a.unitId);
    }
  }

  // Expand platoons to squads
  if (platoonIds.size > 0) {
    const squads = await prisma.squad.findMany({
      where: { platoonId: { in: [...platoonIds] } },
      select: { id: true },
    });
    for (const s of squads) squadIds.add(s.id);
  }

  if (squadIds.size === 0) return;

  // Find all open/approved requests with future time-bearing events
  const requests = await prisma.request.findMany({
    where: {
      status: { in: ["open", "approved"] },
      type: { in: ["leave", "medical"] },
      soldier: { squadId: { in: [...squadIds] }, status: "active" },
    },
    select: {
      id: true,
      type: true,
      departureAt: true,
      medicalAppointments: true,
    },
  });

  const now = new Date();
  const leadMs = pref.reminderLeadMinutes * 60 * 1000;

  for (const req of requests) {
    const events = extractTimeEvents(req);
    for (const event of events) {
      const scheduledFor = new Date(event.eventAt.getTime() - leadMs);
      if (scheduledFor <= now) continue;

      try {
        const reminder = await prisma.scheduledReminder.create({
          data: {
            requestId: req.id,
            userId,
            appointmentId: event.appointmentId,
            reminderType: event.reminderType,
            scheduledFor,
            eventAt: event.eventAt,
          },
        });

        const notBefore = Math.floor(scheduledFor.getTime() / 1000);
        const messageId = await publishReminder(reminder.id, notBefore);
        if (messageId) {
          await prisma.scheduledReminder.update({
            where: { id: reminder.id },
            data: { qstashMessageId: messageId },
          });
        }
      } catch (err) {
        console.warn(`[reminders] failed to schedule reminder for request ${req.id}:`, err);
      }
    }
  }
}
