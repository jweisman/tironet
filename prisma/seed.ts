import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const ACTIVITY_TYPES = [
  { name: "אימונים", icon: "dumbbell", sortOrder: 1, 
    displayConfiguration: {
      results: { passed: { label: "ביצע" }, failed: { label: "לא ביצע" }, na: { label: "לא רלוונטי" } },
    },
  },
  {
    name: "כש״ג", icon: "shield", sortOrder: 2,
    scoreConfig: {
      score1: { label: "ציון סופי", format: "number" },
      score2: { label: "מתח", format: "number" },
      score3: { label: "בנץ׳", format: "number" },
      score4: { label: "טראפ בר", format: "number" },
      score5: { label: "ריצה", format: "time" },
      score6: { label: "ספרינט", format: "time" },
    },
  },
  { name: "ירי", icon: "crosshair", sortOrder: 3,
    scoreConfig: {
      score1: { label: "ציון", format: "number" }
    }
  },
  { name: "שיעורים", icon: "book-open", sortOrder: 4,
    displayConfiguration: {
      results: { passed: { label: "נוכח" }, failed: { label: "לא נוכח" }, na: { label: "לא רלוונטי" } },
    },
  },
  { name: "בוחנים", icon: "clipboard-check", sortOrder: 5,
    scoreConfig: {
      score1: { label: "ציון", format: "number" }
    }
  },
  { name: "הסמכות", icon: "award", sortOrder: 6,
    scoreConfig: {
      score1: { label: "ציון", format: "number" }
    }
  },
  { name: "שיחות מפקד", icon: "message-circle", sortOrder: 7,
    displayConfiguration: {
      results: { passed: { label: "נוכח" }, failed: { label: "לא נוכח" }, na: { label: "לא רלוונטי" } },
    },
  },
  { name: "בחמ״ס", icon: "timer", sortOrder: 8,
    scoreConfig: {
      score1: { label: "זמן", format: "time" }
    },
    displayConfiguration: {
      note: { type: "list", options: ["קיר", "חבל", "זמן", "אחר"] },
    },
  },
  { name: "מסע", icon: "route", sortOrder: 9,
    displayConfiguration: {
      results: { passed: { label: "ביצע" }, failed: { label: "לא ביצע" }, na: { label: "לא רלוונטי" } },
    },
  },    
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
      // Update scoreConfig / displayConfiguration if defined
      const updates: Record<string, unknown> = {};
      if ("scoreConfig" in at) updates.scoreConfig = at.scoreConfig;
      if ("displayConfiguration" in at) updates.displayConfiguration = at.displayConfiguration;
      if (Object.keys(updates).length > 0) {
        await prisma.activityType.update({
          where: { id: existing.id },
          data: updates,
        });
        console.log(`Updated config for: ${at.name}`);
      } else {
        console.log(`Skipped existing activity type: ${at.name}`);
      }
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

    const battalion = await prisma.battalion.upsert({
      where: { id: "00000000-0000-0000-0000-000000000010" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000010",
        name: "גדוד ראשי",
      },
    });
    console.log(`Battalion: ${battalion.name}`);

    const company = await prisma.company.upsert({
      where: { id: "00000000-0000-0000-0000-000000000002" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000002",
        cycleId: cycle.id,
        battalionId: battalion.id,
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
