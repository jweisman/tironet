const MAILHOG_API = "http://localhost:8026/api";

interface MailhogMessage {
  ID: string;
  Content: {
    Headers: Record<string, string[]>;
    Body: string;
  };
}

interface MailhogSearchResult {
  total: number;
  items: MailhogMessage[];
}

/**
 * Fetch the most recent email sent to `toAddress` from Mailhog.
 * Retries up to `maxRetries` times with 1s delay (email delivery is async).
 */
export async function getLatestEmail(
  toAddress: string,
  maxRetries = 10
): Promise<MailhogMessage> {
  for (let i = 0; i < maxRetries; i++) {
    const res = await fetch(
      `${MAILHOG_API}/v2/search?kind=to&query=${encodeURIComponent(toAddress)}`
    );
    const data: MailhogSearchResult = await res.json();
    if (data.items.length > 0) {
      // Return the most recent (last item)
      return data.items[data.items.length - 1];
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No email found for ${toAddress} after ${maxRetries} retries`);
}

/**
 * Extract the magic link verification URL from a NextAuth email body.
 * NextAuth emails contain an anchor tag with the verification callback URL.
 */
export function extractVerificationUrl(message: MailhogMessage): string {
  // Decode quoted-printable first (=3D → =, soft line breaks removed)
  const body = decodeQuotedPrintable(message.Content.Body);
  // NextAuth magic link emails include an <a> tag with href containing /api/auth/callback/
  const match = body.match(/href="([^"]*\/api\/auth\/callback\/[^"]*)"/);
  if (!match) {
    // Fallback: look for any URL with /api/auth/callback in plain text part
    const urlMatch = body.match(/(https?:\/\/[^\s"<]+\/api\/auth\/callback\/[^\s"<]+)/);
    if (!urlMatch) {
      throw new Error("Could not find verification URL in email body");
    }
    return urlMatch[1];
  }
  return match[1];
}

/** Decode quoted-printable encoding (=XX hex codes and soft line breaks). */
function decodeQuotedPrintable(str: string): string {
  return str
    .replace(/=\r?\n/g, "") // remove soft line breaks
    .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/** Delete all messages in Mailhog (clean slate for tests). */
export async function clearMailhog(): Promise<void> {
  await fetch(`${MAILHOG_API}/v1/messages`, { method: "DELETE" });
}
