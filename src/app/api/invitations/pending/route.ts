import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

/**
 * GET /api/invitations/pending
 *
 * Returns pending (unaccepted, unexpired) invitations matching the current
 * user's email or phone. Used by the home page to prompt users who logged in
 * but haven't accepted their invitation yet.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ invitations: [] });
  }

  const conditions: object[] = [];
  if (session.user.email) {
    conditions.push({ email: { equals: session.user.email, mode: "insensitive" as const } });
  }
  if (session.user.phone) {
    conditions.push({ phone: session.user.phone });
  }

  if (conditions.length === 0) {
    return NextResponse.json({ invitations: [] });
  }

  const invitations = await prisma.invitation.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { gt: new Date() },
      OR: conditions,
    },
    select: {
      token: true,
      role: true,
      cycle: { select: { name: true } },
    },
    take: 5,
  });

  return NextResponse.json({
    invitations: invitations.map((inv) => ({
      token: inv.token,
      role: inv.role,
      cycleName: inv.cycle.name,
    })),
  });
}
