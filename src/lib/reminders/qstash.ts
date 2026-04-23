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

/**
 * Schedule a reminder via QStash. Returns the QStash messageId, or null if
 * QStash is not configured.
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

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.warn("[reminders] APP_URL not configured — cannot schedule reminder");
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
