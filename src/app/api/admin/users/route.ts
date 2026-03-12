import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { requireAdmin } from "@/lib/api/admin-guard";

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const users = await prisma.user.findMany({
    select: {
      id: true,
      givenName: true,
      familyName: true,
      email: true,
      phone: true,
      rank: true,
      isAdmin: true,
      profileImage: true,
      cycleAssignments: {
        select: {
          id: true,
          role: true,
          unitType: true,
          unitId: true,
          cycleId: true,
          cycle: { select: { name: true, isActive: true } },
        },
      },
    },
    orderBy: [{ familyName: "asc" }, { givenName: "asc" }],
  });

  // Build full-path unit name lookup: "פלוגה א / כיתה א" etc.
  const allCompanies = await prisma.company.findMany({
    select: {
      id: true,
      name: true,
      platoons: {
        select: {
          id: true,
          name: true,
          squads: { select: { id: true, name: true } },
        },
      },
    },
  });
  const unitMap = new Map<string, string>();
  for (const co of allCompanies) {
    unitMap.set(co.id, co.name);
    for (const pl of co.platoons) {
      unitMap.set(pl.id, `${co.name} / ${pl.name}`);
      for (const sq of pl.squads) {
        unitMap.set(sq.id, `${co.name} / ${pl.name} / ${sq.name}`);
      }
    }
  }

  return NextResponse.json(
    users.map((u) => ({
      ...u,
      cycleAssignments: u.cycleAssignments.map((a) => ({
        ...a,
        unitName: unitMap.get(a.unitId) ?? "",
      })),
    }))
  );
}
