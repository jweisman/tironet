import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { sendEmail } from "@/lib/email/send";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { Role } from "@/types";

const schema = z.object({
  invitationId: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { invitationId } = parsed.data;

  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    include: { cycle: { select: { name: true } } },
  });

  if (!invitation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!invitation.email) {
    return NextResponse.json({ error: "No email on this invitation" }, { status: 400 });
  }
  if (invitation.acceptedAt) {
    return NextResponse.json({ error: "Already accepted" }, { status: 410 });
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

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const inviteUrl = `${baseUrl}/invite/${invitation.token}`;
  const roleLabel = ROLE_LABELS[invitation.role as Role];

  await sendEmail({
    to: invitation.email,
    subject: "הוזמנת להצטרף לטירונט",
    html: `
      <div dir="rtl" style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1d4ed8;">הוזמנת להצטרף לטירונט</h2>
        <p>הוזמנת לשמש כ<strong>${roleLabel}</strong> עבור <strong>${unitName}</strong> במחזור <strong>${invitation.cycle.name}</strong>.</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}" style="background: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            קבל הזמנה
          </a>
        </p>
        <p style="color: #888; font-size: 12px;">הקישור בתוקף ל-7 ימים. אם לא ביקשת הזמנה זו, ניתן להתעלם מהודעה זו.</p>
      </div>
    `,
  });

  return NextResponse.json({ success: true });
}
