import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { sendSms } from "@/lib/twilio";
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
  if (invitation.invitedByUserId !== session.user.id && !session.user.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!invitation.phone) {
    return NextResponse.json({ error: "No phone on this invitation" }, { status: 400 });
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

  await sendSms(
    invitation.phone,
    `הוזמנת לטירונט כ${roleLabel} עבור ${unitName} במחזור ${invitation.cycle.name}.\nלקבלת ההזמנה: ${inviteUrl}`,
  );

  return NextResponse.json({ success: true });
}
