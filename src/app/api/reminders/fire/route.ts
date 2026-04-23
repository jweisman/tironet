import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { sendPushToUser } from "@/lib/push/send";

/**
 * POST /api/reminders/fire
 *
 * Called by QStash when a scheduled reminder fires.
 * Also called by the cron poller (GET /api/cron/fire-reminders).
 */
export async function POST(req: NextRequest) {
  // Verify request comes from QStash or our cron poller
  const authHeader = req.headers.get("authorization");
  const isInternalCall = authHeader === `Bearer ${process.env.CRON_SECRET}`;

  // For QStash cloud, we could use Receiver to verify the signature.
  // For local dev, the QStash dev server doesn't sign requests.
  // For now, accept both QStash-signed and CRON_SECRET-authenticated requests.
  if (!isInternalCall) {
    // In production, verify QStash signature
    const signingKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
    if (signingKey) {
      const { Receiver } = await import("@upstash/qstash");
      const receiver = new Receiver({
        currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
        nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
      });
      const body = await req.text();
      const signature = req.headers.get("upstash-signature") ?? "";
      try {
        await receiver.verify({ signature, body });
      } catch {
        return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
      }
      // Parse the body manually since we already consumed it
      return handleFire(JSON.parse(body));
    }
    // No signing key configured (local dev) — allow through
  }

  const body = await req.json();
  return handleFire(body);
}

async function handleFire(
  body: Record<string, unknown>,
): Promise<NextResponse> {
  const reminderId = body.reminderId as string | undefined;
  if (!reminderId) {
    return NextResponse.json({ error: "Missing reminderId" }, { status: 400 });
  }

  const reminder = await prisma.scheduledReminder.findUnique({
    where: { id: reminderId },
  });

  // Idempotent: already fired or not found
  if (!reminder || reminder.fired) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  // Load request + soldier for the notification message
  const request = await prisma.request.findUnique({
    where: { id: reminder.requestId },
    select: {
      id: true,
      status: true,
      soldier: { select: { familyName: true, givenName: true } },
    },
  });

  // Mark as fired first to prevent re-fires on retry
  await prisma.scheduledReminder.update({
    where: { id: reminderId },
    data: { fired: true },
  });

  // Don't send if request was denied or deleted
  if (!request || request.status === "denied") {
    return NextResponse.json({ ok: true, skipped: true, reason: "denied_or_deleted" });
  }

  const soldierName = `${request.soldier.familyName} ${request.soldier.givenName}`;
  const eventTime = reminder.eventAt.toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jerusalem",
  });

  const typeLabel = reminder.reminderType === "medical" ? "תור רפואי" : "שעת יציאה";

  await sendPushToUser(reminder.userId, {
    title: "תזכורת",
    body: `יש ${typeLabel} ל${soldierName} בשעה ${eventTime}`,
    url: `/requests/${request.id}`,
  });

  return NextResponse.json({ ok: true, fired: true });
}

/**
 * Fire a single reminder by ID. Used by the cron poller.
 */
export async function fireReminder(reminderId: string): Promise<boolean> {
  const res = await handleFire({ reminderId });
  const data = await res.json();
  return data.fired === true;
}
