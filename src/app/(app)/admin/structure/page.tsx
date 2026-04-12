import { prisma } from "@/lib/db/prisma";
import StructureTree from "@/components/admin/StructureTree";

export default async function StructurePage() {
  const cycles = await prisma.cycle.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    select: { id: true, name: true, isActive: true },
  });

  const battalions = await prisma.battalion.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true },
  });

  const companies = await prisma.company.findMany({
    include: {
      platoons: {
        include: { squads: { orderBy: [{ sortOrder: "asc" }, { name: "asc" }] } },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  // Group by cycleId for the client component
  const structure: Record<string, typeof companies> = {};
  for (const company of companies) {
    if (!structure[company.cycleId]) structure[company.cycleId] = [];
    structure[company.cycleId].push(company);
  }

  return <StructureTree cycles={cycles} battalions={battalions} initialStructure={structure} />;
}
