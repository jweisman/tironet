import { createHmac } from "crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const EXPORT_SCOPE = "https://www.googleapis.com/auth/drive.file";

function getHmacSecret(): string {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET or NEXTAUTH_SECRET must be set");
  return secret;
}

function getClientId(): string {
  const id = process.env.AUTH_GOOGLE_ID;
  if (!id) throw new Error("AUTH_GOOGLE_ID must be set");
  return id;
}

function getClientSecret(): string {
  const secret = process.env.AUTH_GOOGLE_SECRET;
  if (!secret) throw new Error("AUTH_GOOGLE_SECRET must be set");
  return secret;
}

/** Sign a state payload for CSRF protection */
export function signState(payload: { userId: string; cycleId: string }): string {
  const data = JSON.stringify(payload);
  const sig = createHmac("sha256", getHmacSecret()).update(data).digest("hex");
  const encoded = Buffer.from(data).toString("base64url");
  return `${encoded}.${sig}`;
}

/** Verify and decode a signed state */
export function verifyState(state: string): { userId: string; cycleId: string } | null {
  const [encoded, sig] = state.split(".");
  if (!encoded || !sig) return null;
  const data = Buffer.from(encoded, "base64url").toString();
  const expectedSig = createHmac("sha256", getHmacSecret()).update(data).digest("hex");
  if (sig !== expectedSig) return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** Build the Google OAuth authorization URL */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: EXPORT_SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/** Exchange an authorization code for tokens */
export async function exchangeCode(
  code: string,
  redirectUri: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    scope: data.scope,
  };
}

/** Refresh an access token using a refresh token */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresIn: number;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in,
  };
}
