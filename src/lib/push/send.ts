import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";
import { sendSms } from "@/lib/twilio";

// Configure VAPID credentials lazily so the module can be imported even when
// env vars are missing (e.g. in CI/e2e where push is not needed).
let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys not configured — push notifications disabled");
    return false;
  }
  const subject = process.env.VAPID_SUBJECT ?? "mailto:admin@tironet.app";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** URL to navigate to when the notification is clicked */
  url: string;
}

export interface PushSendResult {
  subscriptionsFound: number;
  sent: number;
  staleRemoved: number;
  failed: number;
  details: Array<{
    endpointSuffix: string;
    status: "sent" | "stale_removed" | "failed";
    statusCode?: number;
    error?: string;
  }>;
}

/**
 * Send a push notification to all subscriptions for a given user.
 * Automatically removes stale/expired subscriptions (410 Gone, 404).
 * Returns detailed results for diagnostics.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushSendResult> {
  const emptyResult: PushSendResult = { subscriptionsFound: 0, sent: 0, staleRemoved: 0, failed: 0, details: [] };

  if (!ensureVapidConfigured()) return emptyResult;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) {
    console.log(`[push] no subscriptions for user ${userId}`);
    return emptyResult;
  }

  const body = JSON.stringify(payload);
  const result: PushSendResult = { subscriptionsFound: subscriptions.length, sent: 0, staleRemoved: 0, failed: 0, details: [] };

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      const suffix = sub.endpoint.slice(-16);
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
        result.sent++;
        result.details.push({ endpointSuffix: suffix, status: "sent" });
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 403, 404, or 410 = subscription is no longer valid — delete it.
        // Apple's push service returns 403 for expired/revoked subscriptions.
        if (statusCode === 403 || statusCode === 404 || statusCode === 410) {
          console.log(`[push] removing stale subscription (${statusCode}) for user ${userId}: …${suffix}`);
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          result.staleRemoved++;
          result.details.push({ endpointSuffix: suffix, status: "stale_removed", statusCode });
        } else {
          result.failed++;
          result.details.push({ endpointSuffix: suffix, status: "failed", statusCode, error: String(err) });
        }
        throw err;
      }
    }),
  );

  // Log summary for debugging
  console.log(`[push] user ${userId}: ${result.sent} sent, ${result.staleRemoved} stale, ${result.failed} failed (of ${subscriptions.length})`);

  // Log non-stale failures
  for (const r of results) {
    if (r.status === "rejected") {
      const statusCode = (r.reason as { statusCode?: number }).statusCode;
      if (statusCode !== 403 && statusCode !== 404 && statusCode !== 410) {
        console.warn("[push] delivery failed:", r.reason);
      }
    }
  }

  return result;
}

function getAbsoluteUrl(relativeUrl: string): string {
  // Prefer NEXT_PUBLIC_APP_URL — that's the URL the recipient's browser will
  // use. APP_URL exists for Docker-internal calls (e.g. QStash → Next.js) and
  // points at host.docker.internal in dev, which is unreachable from a phone.
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? "").replace(/\/$/, "");
  if (!base) return relativeUrl;
  return relativeUrl.startsWith("http") ? relativeUrl : base + relativeUrl;
}

/**
 * Soft cap on outgoing SMS length (~4-5 Hebrew segments at 70 chars each).
 * Safety belt against a future code path that builds an unbounded body —
 * Twilio would otherwise charge per segment up to its own ~1600-char limit.
 */
const MAX_SMS_LENGTH = 320;

/**
 * Format a notification payload as an SMS body. The title is dropped — SMS has
 * no separate heading like push, so the title would just be noise. The body is
 * truncated if necessary, preserving the URL so the recipient can always open
 * the full content in the app.
 */
export function formatSmsBody(payload: PushPayload): string {
  const suffix = `\n${getAbsoluteUrl(payload.url)}`;
  const maxBody = Math.max(0, MAX_SMS_LENGTH - suffix.length);
  const body =
    payload.body.length > maxBody
      ? payload.body.slice(0, Math.max(0, maxBody - 1)) + "…"
      : payload.body;
  return body + suffix;
}

/**
 * Send a notification as SMS to a user's phone number.
 */
export async function sendSmsToUser(
  userId: string,
  phone: string,
  payload: PushPayload,
): Promise<void> {
  try {
    await sendSms(phone, formatSmsBody(payload));
    console.log(`[sms] sent "${payload.title}" to user ${userId}`);
  } catch (err) {
    console.warn(`[sms] failed to send to user ${userId}:`, err);
  }
}

type PreferenceField =
  | "dailyTasksEnabled"
  | "requestAssignmentEnabled"
  | "activeRequestsEnabled"
  | "newAppointmentEnabled"
  | "severeIncidentEnabled";

/**
 * Send notifications to multiple users, respecting per-user channel choice
 * (off / in_app / sms) and the per-notification preference toggle.
 *
 * Users without a preference row default to channel=in_app and enabled=true
 * (opt-out model). SMS recipients without a phone number are skipped.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  preferenceField: PreferenceField,
): Promise<void> {
  if (userIds.length === 0) {
    console.log(`[notify] sendPushToUsers called with empty userIds for ${preferenceField}`);
    return;
  }

  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      phone: true,
      notificationPreference: {
        select: {
          channel: true,
          dailyTasksEnabled: true,
          requestAssignmentEnabled: true,
          activeRequestsEnabled: true,
          newAppointmentEnabled: true,
          severeIncidentEnabled: true,
        },
      },
    },
  });

  const tasks: Promise<unknown>[] = [];
  let pushCount = 0;
  let smsCount = 0;
  let skippedOff = 0;
  let skippedPref = 0;
  let skippedNoPhone = 0;

  for (const user of users) {
    const pref = user.notificationPreference;
    // Opt-in model: a user with no preference row hasn't picked a channel yet,
    // so we don't send anything. The per-notification toggles still default to
    // true once the user does set up a row.
    const channel = pref?.channel ?? "off";
    const enabled = pref?.[preferenceField] ?? true;

    if (channel === "off") {
      skippedOff++;
      continue;
    }
    if (!enabled) {
      skippedPref++;
      continue;
    }

    if (channel === "sms") {
      if (!user.phone) {
        skippedNoPhone++;
        continue;
      }
      smsCount++;
      tasks.push(sendSmsToUser(user.id, user.phone, payload));
    } else {
      pushCount++;
      tasks.push(sendPushToUser(user.id, payload));
    }
  }

  console.log(
    `[notify] "${payload.title}" (${preferenceField}): ${pushCount} push, ${smsCount} sms, ` +
    `skipped ${skippedOff} off, ${skippedPref} opt-out, ${skippedNoPhone} no-phone (of ${userIds.length})`,
  );

  await Promise.allSettled(tasks);
}
