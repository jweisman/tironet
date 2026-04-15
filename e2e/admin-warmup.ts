import { test } from "@playwright/test";

/**
 * Admin route warmup — runs before admin-tests to pre-compile all admin
 * routes via Turbopack. Without this, parallel admin tests trigger
 * concurrent compilations that block each other (Turbopack compiles
 * routes serially, blocking ALL requests while compiling).
 *
 * After this warmup, all routes are compiled and cached in the dev server,
 * so admin tests can run in parallel without compilation-induced hangs.
 */
test("warmup admin routes", async ({ page }) => {
  test.setTimeout(300000); // 5 minutes — first-time compilation can be slow

  const routes = [
    "/admin/cycles",
    "/admin/structure",
    "/admin/activity-types",
    "/admin/users",
  ];

  // Visit each admin page to compile it (domcontentloaded = page shell is ready)
  for (const route of routes) {
    console.log(`Warming up: ${route}`);
    await page.goto(route, { timeout: 120000, waitUntil: "domcontentloaded" });
  }

  // Warm up API routes used by admin tests
  const apiRoutes = [
    "/api/admin/activity-types",
    "/api/admin/cycles",
  ];

  for (const api of apiRoutes) {
    console.log(`Warming up API: ${api}`);
    await page.request.get(api, { timeout: 120000 }).catch((e) => {
      // 403 is expected (no auth for warmup), but the route is compiled
      console.log(`  API warmup result: ${e instanceof Error ? e.message : "ok"}`);
    });
  }

  console.log("Admin warmup complete");
});
