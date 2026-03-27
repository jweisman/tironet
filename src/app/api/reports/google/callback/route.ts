import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { verifyState, exchangeCode } from "@/lib/reports/google-oauth";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    // User denied consent or other error
    return NextResponse.redirect(
      new URL("/reports?error=google_denied", request.nextUrl.origin)
    );
  }

  if (!code || !state) {
    return NextResponse.redirect(
      new URL("/reports?error=invalid_callback", request.nextUrl.origin)
    );
  }

  const payload = verifyState(state);
  if (!payload) {
    return NextResponse.redirect(
      new URL("/reports?error=invalid_state", request.nextUrl.origin)
    );
  }

  try {
    const redirectUri = `${request.nextUrl.origin}/api/reports/google/callback`;
    const tokens = await exchangeCode(code, redirectUri);

    // Store or update the export token
    await prisma.googleExportToken.upsert({
      where: { userId: payload.userId },
      create: {
        userId: payload.userId,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        scope: tokens.scope,
      },
      update: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
        scope: tokens.scope,
      },
    });

    // Redirect back to reports page with success flag
    return NextResponse.redirect(
      new URL("/reports?google_auth=success", request.nextUrl.origin)
    );
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(
      new URL("/reports?error=token_exchange", request.nextUrl.origin)
    );
  }
}
