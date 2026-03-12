import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { verifyWhatsAppOtp } from "@/lib/twilio";

const schema = z.object({
  phone: z.string().min(1),
  code: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "קלט לא תקין" }, { status: 400 });
  }

  const { phone, code } = parsed.data;

  // Lookup user
  const user = await prisma.user.findUnique({
    where: { phone },
    select: { id: true, email: true },
  });
  if (!user) {
    return NextResponse.json({ error: "קוד שגוי" }, { status: 401 });
  }

  let approved = false;
  try {
    approved = await verifyWhatsAppOtp(phone, code);
  } catch (err) {
    console.error("Twilio verify error:", err);
    return NextResponse.json({ error: "שגיאה באימות הקוד" }, { status: 500 });
  }

  if (!approved) {
    return NextResponse.json({ error: "קוד שגוי" }, { status: 401 });
  }

  // Return the user email so the NextAuth credentials provider can sign them in
  return NextResponse.json({ email: user.email });
}
