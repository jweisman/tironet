import { Client } from "@upstash/qstash";

let client: Client | null = null;

function getClient(): Client | null {
  if (client) return client;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    console.warn("[reminders] QSTASH_TOKEN not configured — reminders disabled");
    return null;
  }
  client = new Client({
    token,
    ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}),
  });
  return client;
}

/** QStash maximum delay is 7 days (604800 seconds) */
const MAX_DELAY_SECONDS = 7 * 24 * 60 * 60;

/**
 * Schedule a reminder via QStash. Returns the QStash messageId, or null if
 * QStash is not configured or the reminder is too far in the future.
 *
 * QStash has a max delay of 7 days. Reminders beyond that are stored in the DB
 * with no messageId and scheduled by the cron poller once they're within range.
 *
 * @param reminderId  The ScheduledReminder row id (sent in the callback body)
 * @param notBefore   Unix timestamp in seconds when the message should fire
 */
export async function publishReminder(
  reminderId: string,
  notBefore: number,
): Promise<string | null> {
  const c = getClient();
  if (!c) return null;

  const appUrl = process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    console.warn("[reminders] APP_URL / NEXT_PUBLIC_APP_URL not configured — cannot schedule reminder");
    return null;
  }

  // Skip QStash if the reminder is more than 7 days out — the cron poller
  // will schedule it once it's within range.
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (notBefore - nowSeconds > MAX_DELAY_SECONDS) {
    return null;
  }

  const res = await c.publishJSON({
    url: `${appUrl}/api/reminders/fire`,
    body: { reminderId },
    notBefore,
  });

  return res.messageId;
}

/**
 * Cancel a previously scheduled QStash message.
 * No-op if QStash is not configured or messageId is null.
 */
export async function cancelReminder(
  messageId: string | null,
): Promise<void> {
  if (!messageId) return;
  const c = getClient();
  if (!c) return;

  try {
    await c.messages.cancel(messageId);
  } catch (err: unknown) {
    // 404 = message already delivered or expired — not an error
    const status = (err as { status?: number }).status;
    if (status !== 404) {
      console.warn("[reminders] failed to cancel QStash message:", err);
    }
  }
}
