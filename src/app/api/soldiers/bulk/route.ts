import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";

const soldierSchema = z.object({
  squadId: z.string().uuid(),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  idNumber: z.string().nullable().optional(),
  rank: z.string().nullable().optional(),
  status: z.enum(["active", "transferred", "dropped", "injured"]).optional(),
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
  if (role === "squad_commander") return [unitId];
  if (role === "platoon_commander") {
    const squads = await prisma.squad.findMany({
      where: { platoonId: unitId },
      select: { id: true },
    });
    return squads.map((s) => s.id);
  }
  if (role === "company_commander") {
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
  const isAdmin = session.user.isAdmin;

  let scopeSquadIds: string[] | null = null;

  if (!isAdmin) {
    const assignment = session.user.cycleAssignments.find(
      (a) => a.cycleId === cycleId
    );
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    scopeSquadIds = await getScopeSquadIds(assignment.role, assignment.unitId, cycleId);
  }

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
    if (scopeSquadIds && !scopeSquadIds.includes(sqId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Create all soldiers in a transaction
  const created = await prisma.$transaction(
    soldiers.map((s) =>
      prisma.soldier.create({
        data: {
          cycleId,
          squadId: s.squadId,
          givenName: s.givenName.trim(),
          familyName: s.familyName.trim(),
          idNumber: s.idNumber ?? null,
          rank: s.rank ?? null,
          status: s.status ?? "active",
        },
        select: { id: true },
      })
    )
  );

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
    created: soldiers.length,
    activeActivityCount,
    soldierIds: created.map((s) => s.id),
  }, { status: 201 });
}
