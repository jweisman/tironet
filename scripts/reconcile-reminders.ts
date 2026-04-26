/**
 * One-time script to fix reminders scheduled with incorrect timezone.
 *
 * Usage: DATABASE_URL="postgresql://..." npx tsx scripts/reconcile-reminders.ts
 *
 * Medical appointment dates were stored as timezone-naive strings (e.g.
 * "2026-04-26T15:40") which the server interpreted as UTC instead of Israel
 * time. This caused reminders to fire 2-3 hours late.
 *
 * The script re-parses appointment dates with the fixed parseAsIsraelTime(),
 * compares against the currently scheduled time, and reschedules via QStash
 * if they differ.
 *
 * Safe to run multiple times — only updates reminders whose times are wrong.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { parseMedicalAppointments } from "../src/lib/requests/medical-appointments";
import { parseAsIsraelTime } from "../src/lib/reminders/schedule";
import { publishReminder, cancelReminder } from "../src/lib/reminders/qstash";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const unfired = await prisma.scheduledReminder.findMany({
    where: { fired: false },
    include: {
      request: {
        select: {
          type: true,
          departureAt: true,
          medicalAppointments: true,
        },
      },
    },
  });

  console.log(`Found ${unfired.length} unfired reminders`);

  let fixed = 0;
  let skipped = 0;
  let errors = 0;

  for (const rem of unfired) {
    try {
      let correctEventAt: Date | null = null;

      if (rem.reminderType === "departure" && rem.request.departureAt) {
        // Departure times are stored as timestamptz — already correct
        correctEventAt = rem.request.departureAt;
      } else if (rem.reminderType === "medical" && rem.appointmentId) {
        const appts = parseMedicalAppointments(
          rem.request.medicalAppointments as string | null,
        );
        const appt = appts.find((a) => a.id === rem.appointmentId);
        if (appt?.date.includes("T")) {
          correctEventAt = parseAsIsraelTime(appt.date);
        }
      }

      if (!correctEventAt) {
        // Appointment was removed — will be cleaned up by scheduleRemindersForRequest
        skipped++;
        continue;
      }

      const correctScheduledFor = new Date(
        correctEventAt.getTime() - (rem.eventAt.getTime() - rem.scheduledFor.getTime()),
      );

      const drift = Math.abs(correctEventAt.getTime() - rem.eventAt.getTime());
      if (drift < 60_000) {
        // Less than 1 minute difference — already correct
        skipped++;
        continue;
      }

      console.log(
        `  Fixing reminder ${rem.id}:`,
        `eventAt ${rem.eventAt.toISOString()} → ${correctEventAt.toISOString()}`,
        `(drift: ${Math.round(drift / 60_000)}min)`,
      );

      // Cancel old QStash message
      await cancelReminder(rem.qstashMessageId);

      // Schedule new one
      const now = new Date();
      if (correctScheduledFor <= now) {
        console.log(`    Scheduled time already passed — skipping QStash publish`);
        await prisma.scheduledReminder.update({
          where: { id: rem.id },
          data: {
            scheduledFor: correctScheduledFor,
            eventAt: correctEventAt,
            qstashMessageId: null,
          },
        });
      } else {
        const notBefore = Math.floor(correctScheduledFor.getTime() / 1000);
        const messageId = await publishReminder(rem.id, notBefore);
        await prisma.scheduledReminder.update({
          where: { id: rem.id },
          data: {
            scheduledFor: correctScheduledFor,
            eventAt: correctEventAt,
            qstashMessageId: messageId,
          },
        });
      }

      fixed++;
    } catch (err) {
      errors++;
      console.error(`  Error fixing reminder ${rem.id}:`, err);
    }
  }

  console.log(`\nDone: ${fixed} fixed, ${skipped} already correct, ${errors} errors`);
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
