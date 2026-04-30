/**
 * Standalone test seed script — seeds the dev database with the same data
 * used by e2e tests, without any e2e-specific concerns (Playwright tokens,
 * test DB URL, etc.).
 *
 * Usage: npx tsx scripts/seed-test.ts [--teardown]
 *
 * Reads DATABASE_URL from .env (same as the dev server).
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import "dotenv/config";
import { seedCoreData, teardownData } from "../prisma/seed-data";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function teardown() {
  await teardownData(prisma);
  console.log("[seed-test teardown] Done");
}

async function seed() {
  await teardown();
  await seedCoreData(prisma);
  console.log("[seed-test] Done — seeded dev DB with test data");
}

const action = process.argv[2];
if (action === "--teardown") {
  teardown()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
} else {
  seed()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
