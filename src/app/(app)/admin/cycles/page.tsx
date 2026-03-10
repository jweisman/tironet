import { prisma } from "@/lib/db/prisma";
import CycleList from "@/components/admin/CycleList";

export default async function CyclesPage() {
  const cycles = await prisma.cycle.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, isActive: true },
  });
  return <CycleList initialCycles={cycles} />;
}
