import { NextResponse } from "next/server";
import * as jose from "jose";
import { auth } from "@/lib/auth/auth";

const powersyncUrl =
  process.env.NEXT_PUBLIC_POWERSYNC_URL ?? "http://localhost:8080";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jwtSecret = process.env.POWERSYNC_JWT_SECRET;
  if (!jwtSecret) {
    return NextResponse.json(
      { error: "POWERSYNC_JWT_SECRET not configured" },
      { status: 500 }
    );
  }

  const { cycle_ids = [], squad_ids = [], platoon_ids = [], company_ids = [] } = session.user;

  // Audience must match client_auth.audience in powersync.config.yaml.
  const audience = powersyncUrl;

  const secret = new TextEncoder().encode(jwtSecret);
  const token = await new jose.SignJWT({ cycle_ids, squad_ids, platoon_ids, company_ids })
    .setProtectedHeader({ alg: "HS256", kid: "tironet-dev" })
    .setSubject(session.user.id)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(secret);

  return NextResponse.json({ token, powersync_url: powersyncUrl });
}
