/**
 * E2E seed script — run via `npx tsx e2e/helpers/seed.ts` (or `--teardown`).
 * Separated from Playwright to avoid ESM/Prisma import issues.
 */
import { PrismaClient } from "../../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { randomBytes } from "crypto";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname2 = dirname(fileURLToPath(import.meta.url));

const TEST_DB_URL =
  "postgresql://tironet:tironet@127.0.0.1:5434/tironet_test";

const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
const prisma = new PrismaClient({ adapter });

const IDS = {
  adminUser: "e2e00000-0000-4000-8000-000000000001",
  platoonCmdUser: "e2e00000-0000-4000-8000-000000000002",
  squadCmdUser: "e2e00000-0000-4000-8000-000000000003",
  cycle: "e2e00000-0000-4000-8000-000000000010",
  battalion: "e2e00000-0000-4000-8000-000000000015",
  company: "e2e00000-0000-4000-8000-000000000020",
  platoon1: "e2e00000-0000-4000-8000-000000000030",
  platoon2: "e2e00000-0000-4000-8000-000000000031",
  squadA: "e2e00000-0000-4000-8000-000000000040",
  squadB: "e2e00000-0000-4000-8000-000000000041",
  squadC: "e2e00000-0000-4000-8000-000000000042",
  activityTypeShooting: "e2e00000-0000-4000-8000-000000000050",
  activityTypeNav: "e2e00000-0000-4000-8000-000000000051",
  activityTypeLessons: "e2e00000-0000-4000-8000-000000000052",
  activity1: "e2e00000-0000-4000-8000-000000000060",
  activity2: "e2e00000-0000-4000-8000-000000000061",
  activityDraft: "e2e00000-0000-4000-8000-000000000062",
  activityP2: "e2e00000-0000-4000-8000-000000000063",
  soldier1: "e2e00000-0000-4000-8000-000000000070",
  soldier2: "e2e00000-0000-4000-8000-000000000071",
  soldier3: "e2e00000-0000-4000-8000-000000000072",
  soldier4: "e2e00000-0000-4000-8000-000000000073",
  soldier5: "e2e00000-0000-4000-8000-000000000074",
  soldier6: "e2e00000-0000-4000-8000-000000000075",
  soldier7: "e2e00000-0000-4000-8000-000000000076",
  requestLeave: "e2e00000-0000-4000-8000-000000000090",
  requestMedical: "e2e00000-0000-4000-8000-000000000091",
  invitation: "e2e00000-0000-4000-8000-000000000080",
  expiredInvitation: "e2e00000-0000-4000-8000-000000000081",
};

const EMAILS = {
  admin: "admin-e2e@test.com",
  platoonCmd: "platoon-e2e@test.com",
  squadCmd: "squad-e2e@test.com",
  invitee: "new-e2e@test.com",
};

async function teardown() {
  await prisma.requestAction.deleteMany();
  await prisma.request.deleteMany();
  await prisma.activityReport.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.activityType.deleteMany();
  await prisma.soldier.deleteMany();
  await prisma.invitation.deleteMany();
  await prisma.userCycleAssignment.deleteMany();
  await prisma.squad.deleteMany();
  await prisma.platoon.deleteMany();
  await prisma.company.deleteMany();
  await prisma.battalion.deleteMany();
  await prisma.cycle.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.verificationToken.deleteMany();
  await prisma.user.deleteMany();
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

  await prisma.user.createMany({
    data: [
      { id: IDS.adminUser, givenName: "Admin", familyName: "Test", email: EMAILS.admin, isAdmin: true },
      { id: IDS.platoonCmdUser, givenName: "Platoon", familyName: "Commander", email: EMAILS.platoonCmd, isAdmin: false },
      { id: IDS.squadCmdUser, givenName: "Squad", familyName: "Commander", email: EMAILS.squadCmd, isAdmin: false },
    ],
  });

  await prisma.cycle.create({
    data: { id: IDS.cycle, name: "Test Cycle 2026", isActive: true, sortOrder: 0 },
  });

  await prisma.battalion.create({
    data: { id: IDS.battalion, name: "Test Battalion", sortOrder: 0 },
  });

  await prisma.company.create({
    data: { id: IDS.company, cycleId: IDS.cycle, battalionId: IDS.battalion, name: "Company Alpha", sortOrder: 0 },
  });

  await prisma.platoon.createMany({
    data: [
      { id: IDS.platoon1, companyId: IDS.company, name: "Platoon 1", sortOrder: 0 },
      { id: IDS.platoon2, companyId: IDS.company, name: "Platoon 2", sortOrder: 1 },
    ],
  });

  await prisma.squad.createMany({
    data: [
      { id: IDS.squadA, platoonId: IDS.platoon1, name: "Squad A", sortOrder: 0 },
      { id: IDS.squadB, platoonId: IDS.platoon1, name: "Squad B", sortOrder: 1 },
      { id: IDS.squadC, platoonId: IDS.platoon2, name: "Squad C", sortOrder: 0 },
    ],
  });

  await prisma.userCycleAssignment.createMany({
    data: [
      { userId: IDS.platoonCmdUser, cycleId: IDS.cycle, role: "platoon_commander", unitType: "platoon", unitId: IDS.platoon1 },
      { userId: IDS.squadCmdUser, cycleId: IDS.cycle, role: "squad_commander", unitType: "squad", unitId: IDS.squadA },
    ],
  });

  await prisma.activityType.createMany({
    data: [
      { id: IDS.activityTypeShooting, name: "Shooting", icon: "Target" },
      { id: IDS.activityTypeNav, name: "Navigation", icon: "Compass" },
      {
        id: IDS.activityTypeLessons, name: "Lessons", icon: "BookOpen",
        displayConfiguration: {
          results: { completed: { label: "נוכח" }, skipped: { label: "לא נוכח" }, na: { label: "לא רלוונטי" } },
        },
      },
    ],
  });

  await prisma.soldier.createMany({
    data: [
      { id: IDS.soldier1, cycleId: IDS.cycle, squadId: IDS.squadA, givenName: "Avi", familyName: "Cohen", status: "active" },
      { id: IDS.soldier2, cycleId: IDS.cycle, squadId: IDS.squadA, givenName: "Barak", familyName: "Levi", status: "active" },
      { id: IDS.soldier3, cycleId: IDS.cycle, squadId: IDS.squadA, givenName: "Chen", familyName: "Dayan", status: "transferred" },
      { id: IDS.soldier4, cycleId: IDS.cycle, squadId: IDS.squadB, givenName: "Dan", familyName: "Eilat", status: "active" },
      { id: IDS.soldier5, cycleId: IDS.cycle, squadId: IDS.squadB, givenName: "Elad", familyName: "Fisher", status: "active" },
      { id: IDS.soldier6, cycleId: IDS.cycle, squadId: IDS.squadC, givenName: "Gil", familyName: "Hadar", status: "active" },
      { id: IDS.soldier7, cycleId: IDS.cycle, squadId: IDS.squadC, givenName: "Hila", familyName: "Ivri", status: "active" },
    ],
  });

  const today = new Date();
  await prisma.activity.createMany({
    data: [
      { id: IDS.activity1, platoonId: IDS.platoon1, cycleId: IDS.cycle, activityTypeId: IDS.activityTypeShooting, name: "Shooting Drill 1", date: today, isRequired: true, status: "active", createdByUserId: IDS.platoonCmdUser },
      { id: IDS.activity2, platoonId: IDS.platoon1, cycleId: IDS.cycle, activityTypeId: IDS.activityTypeNav, name: "Navigation Exercise", date: new Date(today.getTime() - 86400000), isRequired: true, status: "active", createdByUserId: IDS.platoonCmdUser },
      { id: IDS.activityDraft, platoonId: IDS.platoon1, cycleId: IDS.cycle, activityTypeId: IDS.activityTypeShooting, name: "Future Activity", date: new Date(today.getTime() + 86400000), isRequired: false, status: "active", createdByUserId: IDS.platoonCmdUser },
      { id: IDS.activityP2, platoonId: IDS.platoon2, cycleId: IDS.cycle, activityTypeId: IDS.activityTypeShooting, name: "Platoon 2 Shooting", date: today, isRequired: true, status: "active", createdByUserId: IDS.adminUser },
    ],
  });

  await prisma.activityReport.createMany({
    data: [
      { activityId: IDS.activity1, soldierId: IDS.soldier1, result: "completed", failed: false, updatedByUserId: IDS.platoonCmdUser },
      { activityId: IDS.activity1, soldierId: IDS.soldier2, result: "skipped", failed: false, updatedByUserId: IDS.platoonCmdUser },
      { activityId: IDS.activity2, soldierId: IDS.soldier1, result: "completed", failed: false, updatedByUserId: IDS.platoonCmdUser },
    ],
  });

  // Seed approved requests — active today (for home page active requests callout)
  const yesterday = new Date(today.getTime() - 86400000);
  const tomorrow = new Date(today.getTime() + 86400000);
  await prisma.request.createMany({
    data: [
      {
        id: IDS.requestLeave, cycleId: IDS.cycle, soldierId: IDS.soldier1,
        type: "leave", status: "approved", assignedRole: null,
        departureAt: yesterday, returnAt: tomorrow,
        createdByUserId: IDS.squadCmdUser,
      },
      {
        id: IDS.requestMedical, cycleId: IDS.cycle, soldierId: IDS.soldier4,
        type: "medical", status: "approved", assignedRole: null,
        medicalAppointments: [
          { id: "appt-e2e-1", date: today.toISOString().split("T")[0], place: "Base Clinic", type: "General" },
        ],
        createdByUserId: IDS.platoonCmdUser,
      },
    ],
  });

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
