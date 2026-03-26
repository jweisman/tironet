import { defineConfig, devices } from "@playwright/test";

const TEST_DB_URL =
  "postgresql://tironet:tironet@127.0.0.1:5434/tironet_test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",

  use: {
    baseURL: "http://localhost:3001",
    trace: "on-first-retry",
    locale: "he-IL",
  },

  projects: [
    // Auth setup — runs first, logs in all 3 users and saves storageState
    { name: "setup", testMatch: /global-setup\.ts/ },

    // Admin warmup — pre-compiles all admin routes so tests don't block each other
    {
      name: "admin-warmup",
      testMatch: /admin-warmup\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
      },
    },
    {
      name: "admin-tests",
      testMatch: /admin\/.*\.spec\.ts/,
      dependencies: ["admin-warmup"],
      fullyParallel: false, // Serial within each file to avoid compilation storms
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
      },
    },
    {
      name: "commander-tests",
      testMatch: /(navigation|home|activities|soldiers|profile|invite|requests)\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/platoon-cmd.json",
      },
    },
    {
      name: "squad-tests",
      testMatch: /(navigation|home|soldiers)\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/squad-cmd.json",
      },
    },
    {
      name: "unauthenticated",
      testMatch: /auth\.spec\.ts/,
      dependencies: ["setup"],
      use: {
        ...devices["Desktop Chrome"],
        // No storageState — tests run unauthenticated
      },
    },
  ],

  webServer: {
    command: `DATABASE_URL="${TEST_DB_URL}" AUTH_TRUST_HOST=true npm run dev -- --port 3001`,
    url: "http://localhost:3001",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
