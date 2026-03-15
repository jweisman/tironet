import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { sendWhatsAppOtp } from "@/lib/twilio";

const schema = z.object({
  phone: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
  }

  const { phone } = parsed.data;

  // Verify the phone belongs to a registered user OR a valid pending invitation
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true },
  });
  if (!user) {
    const invitation = await prisma.invitation.findFirst({
      where: { phone, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    if (!invitation) {
      // Return same response to avoid user enumeration
      return NextResponse.json({ success: true });
    }
  }

  try {
    await sendWhatsAppOtp(phone);
  } catch (err) {
    console.error("Twilio send error:", err);
    return NextResponse.json({ error: "שגיאה בשליחת הקוד" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
