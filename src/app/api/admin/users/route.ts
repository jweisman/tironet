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

  // Build unit name lookup across all unit types
  const [allCompanies, allPlatoons, allSquads] = await Promise.all([
    prisma.company.findMany({ select: { id: true, name: true } }),
    prisma.platoon.findMany({ select: { id: true, name: true } }),
    prisma.squad.findMany({ select: { id: true, name: true } }),
  ]);
  const unitMap = new Map<string, string>();
  for (const u of [...allCompanies, ...allPlatoons, ...allSquads]) {
    unitMap.set(u.id, u.name);
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
