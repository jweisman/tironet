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

/**
 * Send push notifications to multiple users, respecting their notification
 * preferences.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  preferenceField: "dailyTasksEnabled" | "requestAssignmentEnabled" | "activeRequestsEnabled" | "newAppointmentEnabled",
): Promise<void> {
  if (userIds.length === 0) {
    console.log(`[push] sendPushToUsers called with empty userIds for ${preferenceField}`);
    return;
  }

  // Load preferences for all target users in one query.
  const prefs = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, dailyTasksEnabled: true, requestAssignmentEnabled: true, activeRequestsEnabled: true, newAppointmentEnabled: true },
  });

  const prefMap = new Map(prefs.map((p) => [p.userId, p[preferenceField]]));

  // Users without a preference row default to enabled (opt-out model).
  const eligibleUserIds = userIds.filter((id) => prefMap.get(id) !== false);
  const skippedByPref = userIds.length - eligibleUserIds.length;
  if (skippedByPref > 0) {
    console.log(`[push] ${skippedByPref}/${userIds.length} users opted out of ${preferenceField}`);
  }

  console.log(`[push] sending "${payload.title}" to ${eligibleUserIds.length} users (${preferenceField})`);

  await Promise.allSettled(
    eligibleUserIds.map((id) => sendPushToUser(id, payload)),
  );
}
