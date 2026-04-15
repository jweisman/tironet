import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { toE164 } from "@/lib/phone";
import { createRateLimiter } from "@/lib/api/rate-limit";
import type { CycleAssignment, Role } from "@/types";
import { effectiveRole, canInviteRole } from "@/lib/auth/permissions";

const rateLimiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

async function isAuthorizedToInvite(
  assignments: CycleAssignment[],
  cycleId: string,
  targetRole: Role,
  unitType: string,
  unitId: string
): Promise<boolean> {
  const eligible = assignments.filter(
    (a) => a.cycleId === cycleId && canInviteRole(a.role as Role, targetRole)
  );
  if (eligible.length === 0) return false;

  for (const a of eligible) {
    const eRole = effectiveRole(a.role as Role);
    if (eRole === "company_commander") {
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
    } else if (eRole === "platoon_commander") {
      if (unitType === "squad") {
        const s = await prisma.squad.findUnique({ where: { id: unitId }, select: { platoonId: true } });
        if (s?.platoonId === a.unitId) return true;
      } else if (unitType === "platoon") {
        // Platoon commander inviting platoon_sergeant for their own platoon
        if (unitId === a.unitId) return true;
      }
    }
  }
  return false;
}

const schema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().optional(),
    cycleId: z.string().uuid(),
    role: z.enum(["company_commander", "deputy_company_commander", "platoon_commander", "platoon_sergeant", "squad_commander", "instructor", "company_medic", "hardship_coordinator"]),
    unitType: z.enum(["company", "platoon", "squad"]),
    unitId: z.string().uuid(),
    givenName: z.string().min(1).optional(),
    familyName: z.string().min(1).optional(),
    rank: z.string().nullable().optional(),
    profileImage: z.string().nullable().optional(),
  })
  .refine((d) => d.email || d.phone, {
    message: "Either email or phone is required",
  });

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const limited = rateLimiter.check(ip);
  if (limited) return limited;

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "יש לספק אימייל או מספר טלפון" }, { status: 400 });
  }

  const {
    email,
    phone: rawPhone,
    cycleId,
    role,
    unitType,
    unitId,
    givenName,
    familyName,
    rank,
    profileImage,
  } = parsed.data;

  // Normalize phone to E.164
  let phone: string | null = null;
  if (rawPhone) {
    phone = toE164(rawPhone);
    if (!phone) {
      return NextResponse.json({ error: "מספר טלפון לא תקין" }, { status: 400 });
    }
  }

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

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      email: email ?? null,
      phone: phone ?? null,
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

  const baseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const inviteUrl = `${baseUrl}/invite/${token}`;

  return NextResponse.json({ id: invitation.id, inviteUrl }, { status: 201 });
}
