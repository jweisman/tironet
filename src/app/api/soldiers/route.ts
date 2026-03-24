import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { auth } from "@/lib/auth/auth";
import { validateProfileImage } from "@/lib/api/validate-image";

const postSchema = z.object({
  cycleId: z.string().uuid(),
  squadId: z.string().uuid(),
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  idNumber: z.string().nullable().optional(),
  rank: z.string().nullable().optional(),
  status: z.enum(["active", "transferred", "dropped", "injured"]).optional(),
  profileImage: z.string().nullable().optional(),
});

async function getScopeSquadIds(
  role: string,
  unitId: string,
  cycleId: string
): Promise<string[]> {
  if (role === "squad_commander") {
    return [unitId];
  }
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
  // admin: all squads in cycle
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

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const cycleId = searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId required" }, { status: 400 });
  }

  const isAdmin = session.user.isAdmin;
  let role = "admin";
  let unitId = "";

  if (!isAdmin) {
    const assignment = session.user.cycleAssignments.find(
      (a) => a.cycleId === cycleId
    );
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    role = assignment.role;
    unitId = assignment.unitId;
  }

  const scopeSquadIds = await getScopeSquadIds(role, unitId, cycleId);

  const squads = await prisma.squad.findMany({
    where: { id: { in: scopeSquadIds } },
    include: {
      platoon: { select: { id: true, name: true } },
      soldiers: {
        where: { cycleId },
        select: {
          id: true,
          givenName: true,
          familyName: true,
          rank: true,
          status: true,
          profileImage: true,
          squad: { select: { platoonId: true } },
        },
        orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
      },
    },
    orderBy: [{ platoon: { sortOrder: "asc" } }, { sortOrder: "asc" }, { name: "asc" }],
  });

  // Compute gap counts per soldier
  // Gap = active activity for soldier's platoon where no report or report.result === 'failed'
  // Gather all unique platoon IDs
  const platoonIds = [...new Set(squads.map((s) => s.platoonId))];

  // Fetch all active activities per platoon in this cycle
  const activities = await prisma.activity.findMany({
    where: {
      cycleId,
      platoonId: { in: platoonIds },
      status: "active",
      isRequired: true,
    },
    select: {
      id: true,
      platoonId: true,
      reports: {
        select: { soldierId: true, result: true },
      },
    },
  });

  // Build map: platoonId → Set of activity IDs
  // For each soldier: count activities where no report or result === 'failed'
  type ReportMap = Map<string, "passed" | "failed" | "na">;
  const activityByPlatoon = new Map<string, { id: string; reports: ReportMap }[]>();
  for (const act of activities) {
    if (!activityByPlatoon.has(act.platoonId)) {
      activityByPlatoon.set(act.platoonId, []);
    }
    const reportMap: ReportMap = new Map();
    for (const r of act.reports) {
      reportMap.set(r.soldierId, r.result as "passed" | "failed" | "na");
    }
    activityByPlatoon.get(act.platoonId)!.push({ id: act.id, reports: reportMap });
  }

  function computeGapCount(soldierId: string, platoonId: string): number {
    const acts = activityByPlatoon.get(platoonId) ?? [];
    let count = 0;
    for (const act of acts) {
      const result = act.reports.get(soldierId);
      if (!result || result === "failed") count++;
    }
    return count;
  }

  const result = {
    role,
    squads: squads.map((squad) => ({
      id: squad.id,
      name: squad.name,
      platoonId: squad.platoonId,
      platoonName: squad.platoon.name,
      soldiers: squad.soldiers.map((soldier) => ({
        id: soldier.id,
        givenName: soldier.givenName,
        familyName: soldier.familyName,
        rank: soldier.rank,
        status: soldier.status,
        profileImage: soldier.profileImage,
        gapCount: computeGapCount(soldier.id, squad.platoonId),
      })),
    })),
  };

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { cycleId, squadId, givenName, familyName, idNumber, rank, status, profileImage } =
    parsed.data;

  const imageError = validateProfileImage(profileImage);
  if (imageError) {
    return NextResponse.json({ error: imageError }, { status: 422 });
  }

  const isAdmin = session.user.isAdmin;

  if (!isAdmin) {
    const assignment = session.user.cycleAssignments.find(
      (a) => a.cycleId === cycleId
    );
    if (!assignment) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Validate squad is in scope
    const scopeSquadIds = await getScopeSquadIds(
      assignment.role,
      assignment.unitId,
      cycleId
    );
    if (!scopeSquadIds.includes(squadId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Verify squad exists and belongs to this cycle
  const squad = await prisma.squad.findUnique({
    where: { id: squadId },
    select: {
      id: true,
      platoonId: true,
      platoon: { select: { companyId: true, company: { select: { cycleId: true } } } },
    },
  });
  if (!squad || squad.platoon.company.cycleId !== cycleId) {
    return NextResponse.json({ error: "Squad not found in cycle" }, { status: 404 });
  }

  const soldier = await prisma.soldier.create({
    data: {
      cycleId,
      squadId,
      givenName: givenName.trim(),
      familyName: familyName.trim(),
      idNumber: idNumber ?? null,
      rank: rank ?? null,
      status: status ?? "active",
      profileImage: profileImage ?? null,
    },
  });

  // Count active activities for soldier's platoon in this cycle
  const activeActivityCount = await prisma.activity.count({
    where: {
      cycleId,
      platoonId: squad.platoonId,
      status: "active",
    },
  });

  return NextResponse.json({ soldier, activeActivityCount }, { status: 201 });
}
