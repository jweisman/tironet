import { prisma } from "@/lib/db/prisma";
import StructureTree from "@/components/admin/StructureTree";

export default async function StructurePage() {
  const cycles = await prisma.cycle.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
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

  return <StructureTree cycles={cycles} initialStructure={structure} />;
}
