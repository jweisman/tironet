/**
 * Send a test push notification to a user.
 *
 * Usage:
 *   npx tsx scripts/test-push.ts --email <user-email>
 *   npx tsx scripts/test-push.ts --all
 *
 * Requires the local DB to be running and the user to have an active push subscription.
 */
import "dotenv/config";
import webpush from "web-push";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@localhost";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

async function main() {
  const args = process.argv.slice(2);
  const emailIdx = args.indexOf("--email");
  const sendAll = args.includes("--all");

  let subscriptions;

  if (emailIdx !== -1 && args[emailIdx + 1]) {
    const email = args[emailIdx + 1];
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`User not found: ${email}`);
      process.exit(1);
    }
    subscriptions = await prisma.pushSubscription.findMany({
      where: { userId: user.id },
    });
    console.log(`Found ${subscriptions.length} subscription(s) for ${email}`);
  } else if (sendAll) {
    subscriptions = await prisma.pushSubscription.findMany();
    console.log(`Found ${subscriptions.length} total subscription(s)`);
  } else {
    console.log("Usage:");
    console.log("  npx tsx scripts/test-push.ts --email user@example.com");
    console.log("  npx tsx scripts/test-push.ts --all");
    process.exit(1);
  }

  if (subscriptions.length === 0) {
    console.log("No push subscriptions found. Enable notifications in the profile page first.");
    process.exit(0);
  }

  const payload = JSON.stringify({
    title: "בדיקת התראות 🔔",
    body: "אם אתה רואה את ההודעה הזו, ההתראות עובדות!",
    url: "/profile",
  });

  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
      );
      console.log(`✓ Sent to ${sub.endpoint.slice(0, 60)}...`);
    } catch (err: unknown) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      console.error(`✗ Failed (${statusCode}): ${sub.endpoint.slice(0, 60)}...`);
    }
  }

  await prisma.$disconnect();
}

main();
