import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { auth } from "@/lib/auth/auth";
import { toE164 } from "@/lib/phone";
import { validateProfileImage } from "@/lib/api/validate-image";

const schema = z.object({
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  rank: z.string().nullable().optional(),
  isAdmin: z.boolean().optional(),
  profileImage: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
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

  const imageError = validateProfileImage(parsed.data.profileImage);
  if (imageError) {
    return NextResponse.json({ error: imageError }, { status: 422 });
  }

  const { phone: rawPhone, email: rawEmail, ...rest } = parsed.data;

  // Normalize phone to E.164 if provided
  const update: Record<string, unknown> = { ...rest };
  if (rawPhone !== undefined) {
    if (rawPhone === null || rawPhone === "") {
      update.phone = null;
    } else {
      const e164 = toE164(rawPhone);
      if (!e164) {
        return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
      }
      update.phone = e164;
    }
  }

  // Normalize email if provided
  if (rawEmail !== undefined) {
    if (rawEmail === null || rawEmail === "") {
      update.email = null;
    } else {
      update.email = rawEmail.toLowerCase().trim();
    }
  }

  try {
    await prisma.user.update({ where: { id }, data: update });
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const target = (err as { meta?: { target?: string[] } }).meta?.target;
      if (target?.includes("email")) {
        return NextResponse.json({ error: "כתובת האימייל כבר קיימת במערכת" }, { status: 409 });
      }
      return NextResponse.json({ error: "מספר הטלפון כבר קיים במערכת" }, { status: 409 });
    }
    throw err;
  }

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
