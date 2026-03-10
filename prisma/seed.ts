import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const ACTIVITY_TYPES = [
  { name: "אימונים", icon: "dumbbell", sortOrder: 1 },
  { name: "כש״ג", icon: "shield", sortOrder: 2 },
  { name: "ירי", icon: "crosshair", sortOrder: 3 },
  { name: "שיעורים", icon: "book-open", sortOrder: 4 },
  { name: "בוחנים", icon: "clipboard-check", sortOrder: 5 },
  { name: "הסמכות", icon: "award", sortOrder: 6 },
  { name: "שיחות מפקד", icon: "message-circle", sortOrder: 7 },
];

async function main() {
  // Seed the 7 initial activity types (idempotent by name)
  for (const at of ACTIVITY_TYPES) {
    const existing = await prisma.activityType.findFirst({
      where: { name: at.name },
    });
    if (!existing) {
      await prisma.activityType.create({ data: at });
      console.log(`Created activity type: ${at.name}`);
    } else {
      console.log(`Skipped existing activity type: ${at.name}`);
    }
  }

  // Development-only: seed a sample cycle, company, platoon, and squad
  if (process.env.NODE_ENV === "development") {
    const cycle = await prisma.cycle.upsert({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "אוג 2025",
        isActive: true,
      },
    });
    console.log(`Cycle: ${cycle.name}`);

    const company = await prisma.company.upsert({
      where: { id: "00000000-0000-0000-0000-000000000002" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000002",
        cycleId: cycle.id,
        name: "פלוגה בולדוג",
      },
    });
    console.log(`Company: ${company.name}`);

    const platoon = await prisma.platoon.upsert({
      where: { id: "00000000-0000-0000-0000-000000000003" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000003",
        companyId: company.id,
        name: "מחלקה 1",
      },
    });
    console.log(`Platoon: ${platoon.name}`);

    await prisma.squad.upsert({
      where: { id: "00000000-0000-0000-0000-000000000004" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000004",
        platoonId: platoon.id,
        name: "כיתה 2",
      },
    });
    console.log("Squad: כיתה 2");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
