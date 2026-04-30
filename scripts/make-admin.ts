/**
 * Usage: npm run make-admin -- your@email.com
 * Promotes an existing user to admin.
 */
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const email: string = process.argv[2] ?? (() => {
  console.error("Usage: npm run make-admin -- <email>");
  process.exit(1);
})();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.upsert({
    where: { email },
    update: { isAdmin: true },
    create: { email, isAdmin: true, givenName: "Admin", familyName: "" },
    select: { id: true, email: true, givenName: true, familyName: true, isAdmin: true },
  });
  const name = (user.givenName || user.familyName)
    ? `(${user.givenName ?? ""} ${user.familyName ?? ""})`.trim()
    : "(new user)";
  console.log(`✓ ${user.email} ${name} is now an admin.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
