import { execSync } from "child_process";

export default async function globalTeardown() {
  execSync("npx tsx e2e/helpers/seed.ts --teardown", { stdio: "inherit" });
}
