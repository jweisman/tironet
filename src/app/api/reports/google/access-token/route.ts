import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { refreshAccessToken } from "@/lib/reports/google-oauth";
import type { SessionUser } from "@/types";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = session.user as SessionUser;

  const exportToken = await prisma.googleExportToken.findUnique({
    where: { userId: user.id },
  });

  if (!exportToken) {
    return NextResponse.json({ needsAuth: true });
  }

  let accessToken = exportToken.accessToken;
  let expiresIn = Math.floor((exportToken.expiresAt.getTime() - Date.now()) / 1000);

  // Refresh if expired or expiring within 60s
  if (expiresIn < 60) {
    try {
      const refreshed = await refreshAccessToken(exportToken.refreshToken);
      accessToken = refreshed.accessToken;
      expiresIn = refreshed.expiresIn;
      await prisma.googleExportToken.update({
        where: { userId: user.id },
        data: {
          accessToken: refreshed.accessToken,
          expiresAt: new Date(Date.now() + refreshed.expiresIn * 1000),
        },
      });
    } catch {
      await prisma.googleExportToken.delete({
        where: { userId: user.id },
      });
      return NextResponse.json({ needsAuth: true });
    }
  }

  return NextResponse.json({ accessToken, expiresIn });
}
