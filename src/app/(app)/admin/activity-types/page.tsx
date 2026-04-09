import { prisma } from "@/lib/db/prisma";
import ActivityTypeList from "@/components/admin/ActivityTypeList";
import type { ScoreConfig } from "@/types/score-config";
import type { DisplayConfiguration } from "@/types/display-config";

export default async function ActivityTypesPage() {
  const types = await prisma.activityType.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return (
    <ActivityTypeList
      initialTypes={types.map((t) => ({
        id: t.id,
        name: t.name,
        icon: t.icon,
        isActive: t.isActive,
        sortOrder: t.sortOrder,
        scoreConfig: (t.scoreConfig as ScoreConfig) ?? null,
        displayConfiguration: (t.displayConfiguration as DisplayConfiguration) ?? null,
      }))}
    />
  );
}
