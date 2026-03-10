/**
 * Usage: npm run make-admin -- your@email.com
 * Promotes an existing user to admin.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const email = process.argv[2];

if (!email) {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.update({
    where: { email },
    data: { isAdmin: true },
    select: { id: true, email: true, givenName: true, familyName: true, isAdmin: true },
  });
  console.log(`✓ ${user.email} (${user.givenName} ${user.familyName}) is now an admin.`);
}

main()
  .catch((e) => {
    if (e.code === "P2025") {
      console.error(`No user found with email: ${email}`);
      console.error("The user must log in at least once before being promoted.");
    } else {
      console.error(e);
    }
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
