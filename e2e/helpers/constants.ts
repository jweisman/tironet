import { readFileSync } from "fs";
import { resolve } from "path";

// Re-export shared seed data so existing e2e imports keep working
export { IDS, EMAILS } from "../../prisma/seed-data";

/**
 * Read invitation tokens written by the seed script.
 * The seed script writes them to `.e2e-tokens.json` at the project root.
 */
export function getTokens(): {
  INVITATION_TOKEN: string;
  EXPIRED_INVITATION_TOKEN: string;
} {
  const tokenFile = resolve(process.cwd(), ".e2e-tokens.json");
  return JSON.parse(readFileSync(tokenFile, "utf-8"));
}
