import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { auth } from "@/lib/auth/auth";

const schema = z.object({
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  rank: z.string().nullable().optional(),
  isAdmin: z.boolean().optional(),
  profileImage: z.string().nullable().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const user = await prisma.user.findUnique({
    where: { id },
    select: { profileImage: true },
  });
  return NextResponse.json({ profileImage: user?.profileImage ?? null });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  await prisma.user.update({ where: { id }, data: parsed.data });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  // Prevent self-deletion
  const session = await auth();
  if (session?.user?.id === id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  }

  try {
    // Delete pending invitations sent by this user first (no cascade defined)
    await prisma.invitation.deleteMany({ where: { invitedByUserId: id } });
    // Delete the user (accounts + cycleAssignments cascade)
    await prisma.user.delete({ where: { id } });
  } catch {
    return NextResponse.json(
      { error: "Cannot delete user — they have activity records in the system." },
      { status: 422 }
    );
  }

  return new NextResponse(null, { status: 204 });
}
