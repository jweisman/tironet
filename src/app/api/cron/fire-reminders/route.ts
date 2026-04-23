import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/send";

/**
 * GET /api/cron/fire-reminders
 *
 * Production safety net: fires any reminders that QStash failed to deliver.
 * Runs every 5 minutes via Vercel Cron.
 *
 * The `fired` boolean prevents double-sends if QStash already delivered.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  const pending = await prisma.scheduledReminder.findMany({
    where: {
      scheduledFor: { lte: now },
      fired: false,
    },
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });

  let fired = 0;

  for (const reminder of pending) {
    const request = await prisma.request.findUnique({
      where: { id: reminder.requestId },
      select: {
        id: true,
        status: true,
        soldier: { select: { familyName: true, givenName: true } },
      },
    });

    // Mark as fired first to prevent re-fires
    await prisma.scheduledReminder.update({
      where: { id: reminder.id },
      data: { fired: true },
    });

    // Skip if request denied or deleted
    if (!request || request.status === "denied") continue;

    const soldierName = `${request.soldier.familyName} ${request.soldier.givenName}`;
    const eventTime = reminder.eventAt.toLocaleTimeString("he-IL", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Jerusalem",
    });

    const typeLabel = reminder.reminderType === "medical" ? "תור רפואי" : "שעת יציאה";

    try {
      await sendPushToUser(reminder.userId, {
        title: "תזכורת",
        body: `יש ${typeLabel} ל${soldierName} בשעה ${eventTime}`,
        url: `/requests/${request.id}`,
      });
      fired++;
    } catch (err) {
      console.warn("[reminders] cron fire failed:", err);
    }
  }

  return NextResponse.json({ fired, total: pending.length });
}
