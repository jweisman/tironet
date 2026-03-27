import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth/auth";
import { signState, buildAuthUrl } from "@/lib/reports/google-oauth";
import type { SessionUser } from "@/types";

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as SessionUser;
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const state = signState({ userId: user.id, cycleId });
  const redirectUri = `${request.nextUrl.origin}/api/reports/google/callback`;
  const authUrl = buildAuthUrl(redirectUri, state);

  return NextResponse.redirect(authUrl);
}
