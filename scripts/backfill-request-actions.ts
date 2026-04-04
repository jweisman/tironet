/**
 * Backfill script: creates a "create" RequestAction for every Request
 * that has no RequestAction rows.
 *
 * For each orphaned request, the script finds the first squad_commander
 * assigned to the soldier's squad in the same cycle and uses them as
 * the action creator.
 *
 * Usage:
 *   npx tsx scripts/backfill-request-actions.ts          # dry run (default)
 *   npx tsx scripts/backfill-request-actions.ts --apply   # actually write
 */
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

const dryRun = !process.argv.includes("--apply");
if (dryRun) {
  console.log("DRY RUN — pass --apply to write to the database\n");
}

const adapter = new PrismaPg({ connectionString: DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Find requests that have zero request_actions
  const orphanedRequests = await prisma.request.findMany({
    where: {
      actions: { none: {} },
    },
    include: {
      soldier: {
        select: { squadId: true },
      },
    },
  });

  console.log(`Found ${orphanedRequests.length} requests without actions\n`);

  if (orphanedRequests.length === 0) return;

  // Collect unique squad+cycle pairs to look up squad commanders
  const squadCyclePairs = new Set<string>();
  for (const req of orphanedRequests) {
    squadCyclePairs.add(`${req.soldier.squadId}:${req.cycleId}`);
  }

  // Find squad commanders for each squad+cycle pair
  const squadCommanderMap = new Map<string, { userId: string; userName: string }>();

  for (const pair of squadCyclePairs) {
    const [squadId, cycleId] = pair.split(":");
    const assignment = await prisma.userCycleAssignment.findFirst({
      where: {
        cycleId,
        role: "squad_commander",
        unitType: "squad",
        unitId: squadId,
      },
      include: {
        user: { select: { id: true, familyName: true, givenName: true } },
      },
    });

    if (assignment) {
      squadCommanderMap.set(pair, {
        userId: assignment.user.id,
        userName: `${assignment.user.familyName} ${assignment.user.givenName}`,
      });
    }
  }

  let created = 0;
  let skipped = 0;

  for (const req of orphanedRequests) {
    const key = `${req.soldier.squadId}:${req.cycleId}`;
    const commander = squadCommanderMap.get(key);

    if (!commander) {
      console.warn(
        `  SKIP ${req.id} — no squad_commander found for squad ${req.soldier.squadId} in cycle ${req.cycleId}`
      );
      skipped++;
      continue;
    }

    console.log(
      `  ${dryRun ? "WOULD CREATE" : "CREATE"} action for request ${req.id} (${req.type}) — user: ${commander.userName}`
    );

    if (!dryRun) {
      await prisma.requestAction.create({
        data: {
          requestId: req.id,
          userId: commander.userId,
          action: "create",
          note: null,
          userName: commander.userName,
          createdAt: req.createdAt,
        },
      });
    }

    created++;
  }

  console.log(
    `\n${dryRun ? "Would create" : "Created"}: ${created} actions, Skipped: ${skipped}`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
