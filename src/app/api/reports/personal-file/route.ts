import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getPersonalFileScope } from "@/lib/api/personal-file-scope";

export async function GET(request: NextRequest) {
  const cycleId = request.nextUrl.searchParams.get("cycleId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }

  const { scope, error } = await getPersonalFileScope(cycleId);
  if (error) return error;

  const soldierFilter = { squad: { platoonId: { in: scope!.platoonIds } }, cycleId };

  const soldiers = await prisma.soldier.findMany({
    where: soldierFilter,
    select: {
      id: true,
      givenName: true,
      familyName: true,
      idNumber: true,
      rank: true,
      status: true,
      profileImage: true,
      squad: {
        select: {
          id: true,
          name: true,
          platoon: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ squad: { platoon: { sortOrder: "asc" } } }, { squad: { name: "asc" } }, { familyName: "asc" }, { givenName: "asc" }],
  });

  const platoons = [...new Map(
    soldiers.map((s) => [s.squad.platoon.id, { id: s.squad.platoon.id, name: s.squad.platoon.name }])
  ).values()];

  return NextResponse.json({
    soldiers: soldiers.map((s) => ({
      id: s.id,
      givenName: s.givenName,
      familyName: s.familyName,
      idNumber: s.idNumber,
      rank: s.rank,
      status: s.status,
      profileImage: s.profileImage,
      squadName: s.squad.name,
      platoonId: s.squad.platoon.id,
      platoonName: s.squad.platoon.name,
    })),
    platoons,
    role: scope!.role,
  });
}
