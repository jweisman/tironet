import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { effectiveRole } from "@/lib/auth/permissions";
import type { Role } from "@/types";
import { toE164 } from "@/lib/phone";

const schema = z.object({
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  rank: z.string().nullable().optional(),
  profileImage: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
});

async function authorize(userId: string): Promise<{ error: NextResponse } | { error: null }> {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  if (session.user.isAdmin) {
    return { error: null };
  }

  // Must be a platoon_commander or company_commander (or their deputies)
  const commanderAssignments = session.user.cycleAssignments.filter(
    (a) => { const r = effectiveRole(a.role as Role); return r === "platoon_commander" || r === "company_commander"; }
  );
  if (commanderAssignments.length === 0) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  // Collect sub-unit IDs the requester commands
  const subUnitIds: string[] = [];
  for (const a of commanderAssignments) {
    const eRole = effectiveRole(a.role as Role);
    if (eRole === "platoon_commander") {
      const platoon = await prisma.platoon.findUnique({
        where: { id: a.unitId },
        select: { squads: { select: { id: true } } },
      });
      if (platoon) {
        subUnitIds.push(a.unitId); // Include platoon itself (for platoon-level assignments like platoon_sergeant)
        platoon.squads.forEach((s) => subUnitIds.push(s.id));
      }
    } else if (eRole === "company_commander") {
      const company = await prisma.company.findUnique({
        where: { id: a.unitId },
        select: {
          platoons: {
            select: {
              id: true,
              squads: { select: { id: true } },
            },
          },
        },
      });
      if (company) {
        company.platoons.forEach((p) => {
          subUnitIds.push(p.id);
          p.squads.forEach((s) => subUnitIds.push(s.id));
        });
      }
    }
  }

  const uniqueSubUnitIds = [...new Set(subUnitIds)];

  // Check that the target user has an assignment in one of those sub-units
  const assignment = await prisma.userCycleAssignment.findFirst({
    where: { userId, unitId: { in: uniqueSubUnitIds } },
  });
  if (!assignment) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { error: null };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { error } = await authorize(id);
  if (error) return error;

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
  const { id } = await params;
  const { error } = await authorize(id);
  if (error) return error;

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { phone: rawPhone, email: rawEmail, ...rest } = parsed.data;

  const update: Record<string, unknown> = { ...rest };

  // Normalize phone to E.164 if provided
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
