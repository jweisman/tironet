import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { randomBytes } from "crypto";

async function getAuthorizedInvitation(id: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), invitation: null };
  }

  const invitation = await prisma.invitation.findUnique({ where: { id } });
  if (!invitation) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }), invitation: null };
  }

  const isAdmin = session.user.isAdmin;
  const isInviter = invitation.invitedByUserId === session.user.id;
  if (!isAdmin && !isInviter) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }), invitation: null };
  }

  return { error: null, invitation };
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error } = await getAuthorizedInvitation(id);
  if (error) return error;

  await prisma.invitation.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}

/** Refresh the invitation token and return the new invite URL. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error } = await getAuthorizedInvitation(id);
  if (error) return error;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.invitation.update({ where: { id }, data: { token, expiresAt } });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3001";
  const inviteUrl = `${baseUrl}/invite/${token}`;

  return NextResponse.json({ inviteUrl, token });
}
