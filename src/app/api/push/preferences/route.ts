import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { rescheduleRemindersForUser } from "@/lib/reminders/schedule";

const patchSchema = z.object({
  dailyTasksEnabled: z.boolean().optional(),
  requestAssignmentEnabled: z.boolean().optional(),
  activeRequestsEnabled: z.boolean().optional(),
  newAppointmentEnabled: z.boolean().optional(),
  severeIncidentEnabled: z.boolean().optional(),
  reminderLeadMinutes: z.union([
    z.literal(null),
    z.literal(0),
    z.literal(15),
    z.literal(30),
    z.literal(60),
    z.literal(120),
    z.literal(180),
  ]).optional(),
});

/**
 * GET — return the user's notification preferences.
 * Returns defaults (both enabled) if no row exists yet.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pref = await prisma.notificationPreference.findUnique({
    where: { userId: session.user.id },
  });

  return NextResponse.json({
    dailyTasksEnabled: pref?.dailyTasksEnabled ?? true,
    requestAssignmentEnabled: pref?.requestAssignmentEnabled ?? true,
    activeRequestsEnabled: pref?.activeRequestsEnabled ?? true,
    newAppointmentEnabled: pref?.newAppointmentEnabled ?? true,
    severeIncidentEnabled: pref?.severeIncidentEnabled ?? true,
    reminderLeadMinutes: pref?.reminderLeadMinutes ?? null,
  });
}

/**
 * PATCH — update the user's notification preferences (upsert).
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Normalize reminderLeadMinutes: 0 and null both mean disabled
  const data = { ...parsed.data };
  if (data.reminderLeadMinutes === 0) data.reminderLeadMinutes = null;

  const pref = await prisma.notificationPreference.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      ...data,
    },
    update: data,
  });

  // Reschedule reminders if the lead time changed
  if (parsed.data.reminderLeadMinutes !== undefined) {
    after(() =>
      rescheduleRemindersForUser(session.user!.id).catch((err) =>
        console.warn("[reminders] reschedule failed:", err),
      ),
    );
  }

  return NextResponse.json({
    dailyTasksEnabled: pref.dailyTasksEnabled,
    requestAssignmentEnabled: pref.requestAssignmentEnabled,
    activeRequestsEnabled: pref.activeRequestsEnabled,
    newAppointmentEnabled: pref.newAppointmentEnabled,
    severeIncidentEnabled: pref.severeIncidentEnabled,
    reminderLeadMinutes: pref.reminderLeadMinutes ?? null,
  });
}
