import { test as setup } from "@playwright/test";
import { execSync } from "child_process";
import { EMAILS } from "./helpers/constants";
import { loginAndSaveState } from "./helpers/auth";
import { clearMailhog } from "./helpers/mailhog";

setup("seed database and authenticate users", async ({ browser }) => {
  // 1. Seed the test database via tsx (avoids Prisma ESM import issues)
  execSync("npx tsx e2e/helpers/seed.ts", { stdio: "inherit" });

  // 2. Clear Mailhog inbox
  await clearMailhog();

  // 3. Log in each user role in parallel and save storageState
  await Promise.all([
    loginAndSaveState(browser, EMAILS.admin, "e2e/.auth/admin.json"),
    loginAndSaveState(browser, EMAILS.platoonCmd, "e2e/.auth/platoon-cmd.json"),
    loginAndSaveState(browser, EMAILS.squadCmd, "e2e/.auth/squad-cmd.json"),
  ]);
});
