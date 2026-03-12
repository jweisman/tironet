import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invitation = await prisma.invitation.findUnique({ where: { token } });

  if (!invitation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (invitation.acceptedAt) {
    return NextResponse.json({ error: "already_used" }, { status: 410 });
  }
  if (invitation.expiresAt < new Date()) {
    return NextResponse.json({ error: "expired" }, { status: 410 });
  }

  // Verify the session user matches the invitation contact
  if (invitation.email) {
    if (invitation.email.toLowerCase() !== (session.user.email ?? "").toLowerCase()) {
      return NextResponse.json({ error: "email_mismatch" }, { status: 403 });
    }
  } else if (invitation.phone) {
    // Phone-only invitation: verify the logged-in user owns this phone
    const userWithPhone = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true },
    });
    if (userWithPhone?.phone !== invitation.phone) {
      return NextResponse.json({ error: "phone_mismatch" }, { status: 403 });
    }
  }

  // Build profile update from invitation fields (only overwrite non-empty values)
  const profileUpdate: Record<string, unknown> = {};
  if (invitation.givenName) profileUpdate.givenName = invitation.givenName;
  if (invitation.familyName) profileUpdate.familyName = invitation.familyName;
  if (invitation.rank !== undefined) profileUpdate.rank = invitation.rank;
  if (invitation.profileImage !== undefined) profileUpdate.profileImage = invitation.profileImage;
  if (invitation.phone) profileUpdate.phone = invitation.phone;

  await prisma.$transaction([
    prisma.userCycleAssignment.create({
      data: {
        userId: session.user.id,
        cycleId: invitation.cycleId,
        role: invitation.role,
        unitType: invitation.unitType,
        unitId: invitation.unitId,
      },
    }),
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { acceptedAt: new Date() },
    }),
    ...(Object.keys(profileUpdate).length > 0
      ? [prisma.user.update({ where: { id: session.user.id }, data: profileUpdate })]
      : []),
  ]);

  return NextResponse.json({ success: true });
}
