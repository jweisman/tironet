import webpush from "web-push";
import { prisma } from "@/lib/db/prisma";

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

/**
 * Send a push notification to all subscriptions for a given user.
 * Automatically removes stale/expired subscriptions (410 Gone, 404).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<void> {
  if (!ensureVapidConfigured()) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId },
  });

  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);

  const results = await Promise.allSettled(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
        );
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        // 403, 404, or 410 = subscription is no longer valid — delete it.
        // Apple's push service returns 403 for expired/revoked subscriptions.
        if (statusCode === 403 || statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        }
        throw err;
      }
    }),
  );

  // Log failures (non-stale) for debugging but don't throw — notification
  // delivery is best-effort.
  for (const r of results) {
    if (r.status === "rejected") {
      const statusCode = (r.reason as { statusCode?: number }).statusCode;
      if (statusCode !== 403 && statusCode !== 404 && statusCode !== 410) {
        console.warn("[push] delivery failed:", r.reason);
      }
    }
  }
}

/**
 * Send push notifications to multiple users, respecting their notification
 * preferences.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  preferenceField: "dailyTasksEnabled" | "requestAssignmentEnabled" | "activeRequestsEnabled",
): Promise<void> {
  if (userIds.length === 0) return;

  // Load preferences for all target users in one query.
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, dailyTasksEnabled: true, requestAssignmentEnabled: true, activeRequestsEnabled: true },
  });

  const prefMap = new Map(prefs.map((p) => [p.userId, p[preferenceField]]));

  // Users without a preference row default to enabled (opt-out model).
  const eligibleUserIds = userIds.filter((id) => prefMap.get(id) !== false);

  await Promise.allSettled(
    eligibleUserIds.map((id) => sendPushToUser(id, payload)),
  );
}
