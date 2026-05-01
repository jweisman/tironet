import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

/**
 * GET — return push subscription and notification preference data
 * for the authenticated user (used by the support page diagnostics).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;

  try {
    const [subscriptions, preferences] = await Promise.all([
      prisma.pushSubscription.findMany({
        where: { userId },
        select: {
          endpoint: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.notificationPreference.findUnique({
        where: { userId },
      }),
    ]);

    return NextResponse.json({
      subscriptions: subscriptions.map((s) => ({
        endpointDomain: new URL(s.endpoint).hostname,
        // Last 16 chars of endpoint for matching against the browser subscription
        endpointSuffix: s.endpoint.slice(-16),
        createdAt: s.createdAt.toISOString(),
      })),
      preferences: preferences
        ? {
            dailyTasksEnabled: preferences.dailyTasksEnabled,
            requestAssignmentEnabled: preferences.requestAssignmentEnabled,
            activeRequestsEnabled: preferences.activeRequestsEnabled,
            newAppointmentEnabled: preferences.newAppointmentEnabled,
            reminderLeadMinutes: preferences.reminderLeadMinutes,
          }
        : null,
    });
  } catch (e) {
    console.error("[push/diagnostics] DB query failed:", e);
    return NextResponse.json({ error: "DB unavailable" }, { status: 503 });
  }
}
