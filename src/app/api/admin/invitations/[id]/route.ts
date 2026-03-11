import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";
import { sendEmail } from "@/lib/email/send";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";
import { randomBytes } from "crypto";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  await prisma.invitation.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { id },
    include: { cycle: { select: { name: true } } },
  });
  if (!invitation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Resolve unit name
  let unitName = "";
  if (invitation.unitType === "company") {
    const u = await prisma.company.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  } else if (invitation.unitType === "platoon") {
    const u = await prisma.platoon.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  } else {
    const u = await prisma.squad.findUnique({ where: { id: invitation.unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  }

  // Extend expiry and refresh token
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await prisma.invitation.update({ where: { id }, data: { token, expiresAt } });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3001";
  const inviteUrl = `${baseUrl}/invite/${token}`;
  const roleLabel = ROLE_LABELS[invitation.role as Role];

  await sendEmail({
    to: invitation.email,
    subject: "הזמנה לטירונט (שליחה חוזרת)",
    html: `
      <div dir="rtl" style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1d4ed8;">הוזמנת להצטרף לטירונט</h2>
        <p>הוזמנת לשמש כ<strong>${roleLabel}</strong> עבור <strong>${unitName}</strong> במחזור <strong>${invitation.cycle.name}</strong>.</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}" style="background: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            קבל הזמנה
          </a>
        </p>
        <p style="color: #888; font-size: 12px;">הקישור בתוקף ל-7 ימים.</p>
      </div>
    `,
  });

  return NextResponse.json({ success: true });
}
