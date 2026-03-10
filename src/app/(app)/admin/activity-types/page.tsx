import { prisma } from "@/lib/db/prisma";
import ActivityTypeList from "@/components/admin/ActivityTypeList";

export default async function ActivityTypesPage() {
  const types = await prisma.activityType.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return <ActivityTypeList initialTypes={types} />;
}
