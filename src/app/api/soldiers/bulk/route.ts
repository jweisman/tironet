import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { effectiveRole } from "@/lib/auth/permissions";
import { toE164 } from "@/lib/phone";
import type { Role } from "@/types";

const soldierSchema = z.object({
  squadId: z.string().uuid(),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  idNumber: z.string().nullable().optional(),
  civilianId: z.string().nullable().optional(),
  rank: z.string().nullable().optional(),
  status: z.enum(["active", "transferred", "dropped", "injured"]).optional(),
  phone: z.string().nullable().optional(),
  emergencyPhone: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  apt: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
});

const bulkSchema = z.object({
  cycleId: z.string().uuid(),
  soldiers: z.array(soldierSchema).min(1).max(500),
});

async function getScopeSquadIds(
  role: string,
  unitId: string,
  cycleId: string
): Promise<string[]> {
  const eRole = effectiveRole(role as Role);
  if (eRole === "squad_commander") return [unitId];
  if (eRole === "platoon_commander") {
    const squads = await prisma.squad.findMany({
      where: { platoonId: unitId },
      select: { id: true },
    });
    return squads.map((s) => s.id);
  }
  if (eRole === "company_commander") {
    const platoons = await prisma.platoon.findMany({
      where: { companyId: unitId },
      select: { id: true },
    });
    const platoonIds = platoons.map((p) => p.id);
    const squads = await prisma.squad.findMany({
      where: { platoonId: { in: platoonIds } },
      select: { id: true },
    });
    return squads.map((s) => s.id);
  }
  // admin
  const companies = await prisma.company.findMany({
    where: { cycleId },
    select: { id: true },
  });
  const companyIds = companies.map((c) => c.id);
  const platoons = await prisma.platoon.findMany({
    where: { companyId: { in: companyIds } },
    select: { id: true },
  });
  const platoonIds = platoons.map((p) => p.id);
  const squads = await prisma.squad.findMany({
    where: { platoonId: { in: platoonIds } },
    select: { id: true },
  });
  return squads.map((s) => s.id);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }

  const { cycleId, soldiers } = parsed.data;

  const assignment = session.user.cycleAssignments.find(
    (a) => a.cycleId === cycleId
  );
  if (!assignment) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const scopeSquadIds = await getScopeSquadIds(assignment.role, assignment.unitId, cycleId);

  // Validate all squadIds are in scope and belong to the cycle
  const uniqueSquadIds = [...new Set(soldiers.map((s) => s.squadId))];
  const squads = await prisma.squad.findMany({
    where: { id: { in: uniqueSquadIds } },
    select: {
      id: true,
      platoonId: true,
      platoon: { select: { company: { select: { cycleId: true } } } },
    },
  });

  const validSquadMap = new Map(squads.map((s) => [s.id, s]));
  for (const sqId of uniqueSquadIds) {
    const sq = validSquadMap.get(sqId);
    if (!sq || sq.platoon.company.cycleId !== cycleId) {
      return NextResponse.json({ error: "Squad not found in cycle" }, { status: 400 });
    }
    if (!scopeSquadIds.includes(sqId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Look up existing soldiers by idNumber within cycle + scope for upsert
  const nonNullIdNumbers = soldiers
    .map((s) => s.idNumber)
    .filter((id): id is string => !!id);

  const existingMap = new Map<string, { id: string; squadId: string }>();
  if (nonNullIdNumbers.length > 0) {
    const allScopeSquadIds = scopeSquadIds;
    const existing = await prisma.soldier.findMany({
      where: {
        cycleId,
        idNumber: { in: nonNullIdNumbers },
        squadId: { in: allScopeSquadIds },
      },
      select: { id: true, idNumber: true, squadId: true },
    });
    for (const s of existing) {
      if (s.idNumber) existingMap.set(s.idNumber, { id: s.id, squadId: s.squadId });
    }
  }

  // Split into creates and updates
  const toCreate: typeof soldiers = [];
  const toUpdate: { id: string; data: typeof soldiers[number] }[] = [];
  for (const s of soldiers) {
    const match = s.idNumber ? existingMap.get(s.idNumber) : undefined;
    if (match) {
      toUpdate.push({ id: match.id, data: s });
    } else {
      toCreate.push(s);
    }
  }

  // Execute creates and updates in a transaction
  const ops = [
    ...toCreate.map((s) =>
      prisma.soldier.create({
        data: {
          cycleId,
          squadId: s.squadId,
          givenName: s.givenName.trim(),
          familyName: s.familyName.trim(),
          idNumber: s.idNumber ?? null,
          civilianId: s.civilianId ?? null,
          rank: s.rank ?? null,
          status: s.status ?? "active",
          phone: s.phone ? (toE164(s.phone) ?? null) : null,
          emergencyPhone: s.emergencyPhone ? (toE164(s.emergencyPhone) ?? null) : null,
          street: s.street ?? null,
          apt: s.apt ?? null,
          city: s.city ?? null,
        },
        select: { id: true },
      })
    ),
    ...toUpdate.map(({ id, data: s }) =>
      prisma.soldier.update({
        where: { id },
        data: {
          givenName: s.givenName.trim(),
          familyName: s.familyName.trim(),
          ...(s.civilianId !== undefined ? { civilianId: s.civilianId ?? null } : {}),
          rank: s.rank ?? null,
          status: s.status ?? "active",
          phone: s.phone ? (toE164(s.phone) ?? null) : null,
          emergencyPhone: s.emergencyPhone ? (toE164(s.emergencyPhone) ?? null) : null,
          ...(s.street !== undefined ? { street: s.street ?? null } : {}),
          ...(s.apt !== undefined ? { apt: s.apt ?? null } : {}),
          ...(s.city !== undefined ? { city: s.city ?? null } : {}),
        },
        select: { id: true },
      })
    ),
  ];

  const results = await prisma.$transaction(ops);
  const createdIds = results.slice(0, toCreate.length).map((s) => s.id);

  // Count active activities for the unique platoons involved (for late-joiner hint)
  const platoonIds = [...new Set(squads.map((s) => s.platoonId))];
  const activeActivityCount = await prisma.activity.count({
    where: {
      cycleId,
      platoonId: { in: platoonIds },
      status: "active",
    },
  });

  return NextResponse.json({
    created: toCreate.length,
    updated: toUpdate.length,
    activeActivityCount,
    soldierIds: createdIds,
  }, { status: 201 });
}
