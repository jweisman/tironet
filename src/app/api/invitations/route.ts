import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { sendEmail } from "@/lib/email/send";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { CycleAssignment, Role } from "@/types";

const ROLE_RANK: Record<Role, number> = {
  company_commander: 3,
  platoon_commander: 2,
  squad_commander: 1,
};

async function isAuthorizedToInvite(
  assignments: CycleAssignment[],
  cycleId: string,
  targetRole: Role,
  unitType: string,
  unitId: string
): Promise<boolean> {
  const eligible = assignments.filter(
    (a) => a.cycleId === cycleId && ROLE_RANK[a.role] > ROLE_RANK[targetRole]
  );
  if (eligible.length === 0) return false;

  for (const a of eligible) {
    if (a.role === "company_commander") {
      if (unitType === "platoon") {
        const p = await prisma.platoon.findUnique({ where: { id: unitId }, select: { companyId: true } });
        if (p?.companyId === a.unitId) return true;
      } else if (unitType === "squad") {
        const s = await prisma.squad.findUnique({
          where: { id: unitId },
          select: { platoon: { select: { companyId: true } } },
        });
        if (s?.platoon.companyId === a.unitId) return true;
      }
    } else if (a.role === "platoon_commander") {
      if (unitType === "squad") {
        const s = await prisma.squad.findUnique({ where: { id: unitId }, select: { platoonId: true } });
        if (s?.platoonId === a.unitId) return true;
      }
    }
  }
  return false;
}

const schema = z.object({
  email: z.string().email(),
  cycleId: z.string().uuid(),
  role: z.enum(["company_commander", "platoon_commander", "squad_commander"]),
  unitType: z.enum(["company", "platoon", "squad"]),
  unitId: z.string().uuid(),
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  rank: z.string().nullable().optional(),
  profileImage: z.string().nullable().optional(),
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

  const { email, cycleId, role, unitType, unitId, givenName, familyName, rank, profileImage } = parsed.data;

  if (!session.user.isAdmin) {
    const allowed = await isAuthorizedToInvite(
      session.user.cycleAssignments,
      cycleId,
      role,
      unitType,
      unitId
    );
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { name: true },
  });
  if (!cycle) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  // Resolve unit name for the email
  let unitName = "";
  if (unitType === "company") {
    const u = await prisma.company.findUnique({ where: { id: unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  } else if (unitType === "platoon") {
    const u = await prisma.platoon.findUnique({ where: { id: unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  } else {
    const u = await prisma.squad.findUnique({ where: { id: unitId }, select: { name: true } });
    unitName = u?.name ?? "";
  }

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      email,
      invitedByUserId: session.user.id,
      cycleId,
      role,
      unitType,
      unitId,
      token,
      expiresAt,
      givenName: givenName ?? null,
      familyName: familyName ?? null,
      rank: rank ?? null,
      profileImage: profileImage ?? null,
    },
  });

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3001";
  const inviteUrl = `${baseUrl}/invite/${token}`;
  const roleLabel = ROLE_LABELS[role as Role];

  await sendEmail({
    to: email,
    subject: "הוזמנת להצטרף לטירונט",
    html: `
      <div dir="rtl" style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1d4ed8;">הוזמנת להצטרף לטירונט</h2>
        <p>הוזמנת לשמש כ<strong>${roleLabel}</strong> עבור <strong>${unitName}</strong> במחזור <strong>${cycle.name}</strong>.</p>
        <p style="margin: 24px 0;">
          <a href="${inviteUrl}" style="background: #1d4ed8; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
            קבל הזמנה
          </a>
        </p>
        <p style="color: #888; font-size: 12px;">הקישור בתוקף ל-7 ימים. אם לא ביקשת הזמנה זו, ניתן להתעלם מהודעה זו.</p>
      </div>
    `,
  });

  return NextResponse.json({ id: invitation.id }, { status: 201 });
}
