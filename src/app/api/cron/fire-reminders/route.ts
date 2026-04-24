import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/send";
import { publishReminder } from "@/lib/reminders/qstash";

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

  // Schedule reminders that are within 7 days but don't have a QStash message yet
  // (created when the event was too far in the future for QStash's max delay)
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const unscheduled = await prisma.scheduledReminder.findMany({
    where: {
      fired: false,
      qstashMessageId: null,
      scheduledFor: { gt: now, lte: sevenDaysFromNow },
    },
    take: 100,
  });

  let scheduled = 0;
  for (const reminder of unscheduled) {
    const notBefore = Math.floor(reminder.scheduledFor.getTime() / 1000);
    const messageId = await publishReminder(reminder.id, notBefore);
    if (messageId) {
      await prisma.scheduledReminder.update({
        where: { id: reminder.id },
        data: { qstashMessageId: messageId },
      });
      scheduled++;
    }
  }

  // Clean up fired reminders older than 30 days
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const { count: cleaned } = await prisma.scheduledReminder.deleteMany({
    where: { fired: true, scheduledFor: { lt: thirtyDaysAgo } },
  });

  return NextResponse.json({ fired, total: pending.length, scheduled, cleaned });
}
