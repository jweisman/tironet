/**
 * E2E seed script — run via `npx tsx e2e/helpers/seed.ts` (or `--teardown`).
 * Core entity data comes from the shared seed-data module.
 * This file handles e2e-specific concerns: test DB connection, migrations,
 * invitations with random tokens, and writing the token file for Playwright.
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { IDS, EMAILS, seedCoreData, teardownData } from "../../prisma/seed-data";

const __dirname2 = dirname(fileURLToPath(import.meta.url));

const TEST_DB_URL =
  "postgresql://tironet:tironet@127.0.0.1:5434/tironet_test";

const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
const prisma = new PrismaClient({ adapter });

async function teardown() {
  await teardownData(prisma);
  console.log("[e2e teardown] Done");
}

async function seed() {
  const { execSync } = await import("child_process");
  execSync(`DATABASE_URL="${TEST_DB_URL}" npx prisma migrate deploy`, {
    stdio: "pipe",
  });

  // Ensure WAL publication exists for PowerSync replication
  await prisma.$executeRawUnsafe(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'powersync') THEN
         CREATE PUBLICATION powersync FOR ALL TABLES;
       END IF;
     END $$;`
  );

  await teardown();

  // Seed all core entities (users, structure, soldiers, activities, reports, requests)
  await seedCoreData(prisma);

  // E2e-specific: invitations with random tokens for testing the invite flow
  const INVITATION_TOKEN = "e2e-invite-token-" + randomBytes(8).toString("hex");
  const EXPIRED_INVITATION_TOKEN = "e2e-expired-token-" + randomBytes(8).toString("hex");

  await prisma.invitation.createMany({
    data: [
      {
        id: IDS.invitation, email: EMAILS.invitee, invitedByUserId: IDS.adminUser,
        cycleId: IDS.cycle, role: "squad_commander", unitType: "squad", unitId: IDS.squadB,
        token: INVITATION_TOKEN, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      {
        id: IDS.expiredInvitation, email: "expired-e2e@test.com", invitedByUserId: IDS.adminUser,
        cycleId: IDS.cycle, role: "squad_commander", unitType: "squad", unitId: IDS.squadB,
        token: EXPIRED_INVITATION_TOKEN, expiresAt: new Date(Date.now() - 1000),
      },
    ],
  });

  // Write tokens to a JSON file so Playwright tests can read them without importing Prisma
  const tokenFile = resolve(__dirname2, "../../.e2e-tokens.json");
  writeFileSync(tokenFile, JSON.stringify({ INVITATION_TOKEN, EXPIRED_INVITATION_TOKEN }));

  console.log("[e2e seed] Done");
}

// CLI entrypoint
const action = process.argv[2];
if (action === "--teardown") {
  teardown().then(() => prisma.$disconnect());
} else {
  seed().then(() => prisma.$disconnect());
}
