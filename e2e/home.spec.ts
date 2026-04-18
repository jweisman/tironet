import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Platoon commander
// ---------------------------------------------------------------------------

test.describe("Dashboard — platoon commander", () => {
  test.use({ storageState: "e2e/.auth/platoon-cmd.json" });
  test.setTimeout(90000);

  test("dashboard loads and shows user context", async ({ page }) => {
    await page.goto("/home");

    await expect(page.getByText("Platoon Commander")).toBeVisible({
      timeout: 60000,
    });
  });

  test("platoon commander sees squad cards", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    // Squad A and Squad B are in Platoon 1 (the commander's platoon)
    await expect(main.getByRole("heading", { name: "Squad A" })).toBeVisible({ timeout: 60000 });
    await expect(main.getByRole("heading", { name: "Squad B" })).toBeVisible();
  });

  test("today's activities section shows today's activity", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    // "Shooting Drill 1" is seeded for today in Platoon 1
    await expect(main.getByText("Shooting Drill 1")).toBeVisible({ timeout: 60000 });
    // Section header
    await expect(main.getByText("פעילויות היום")).toBeVisible();
  });

  test("today's activities show report progress", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    // Wait for today's activities to load
    await expect(main.getByText("Shooting Drill 1")).toBeVisible({ timeout: 60000 });
    // Shooting Drill 1 has reports — verify the progress fraction is shown in its button
    // Exact counts may vary due to parallel test data
    const activityButton = main.getByRole("button", { name: /Shooting Drill 1/ });
    await expect(activityButton.getByText(/\d+\/\d+/)).toBeVisible({ timeout: 10000 });
  });

  test("active requests callout shows today's active requests", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    // Section header
    await expect(main.getByText("בקשות פעילות להיום")).toBeVisible({ timeout: 60000 });
    // Soldier1 (Cohen Avi) has an approved leave active today
    await expect(main.getByText("Cohen Avi")).toBeVisible({ timeout: 30000 });
    // Soldier4 (Eilat Dan) has a medical appointment today
    await expect(main.getByText("Eilat Dan")).toBeVisible({ timeout: 30000 });
  });

  test("today's activity card navigates to activity detail", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    await expect(main.getByText("Shooting Drill 1")).toBeVisible({ timeout: 60000 });
    await main.getByText("Shooting Drill 1").click();

    await expect(page).toHaveURL(/\/activities\//, { timeout: 15000 });
  });
});

// ---------------------------------------------------------------------------
// Squad commander
// ---------------------------------------------------------------------------

test.describe("Dashboard — squad commander", () => {
  test.use({ storageState: "e2e/.auth/squad-cmd.json" });
  test.setTimeout(90000);

  test("squad commander sees only their squad", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    await expect(
      main.getByRole("heading", { name: "Squad A" })
    ).toBeVisible({ timeout: 60000 });

    // Should NOT see Squad B or Squad C
    await expect(main.getByRole("heading", { name: "Squad B" })).not.toBeVisible();
    await expect(main.getByRole("heading", { name: "Squad C" })).not.toBeVisible();
  });

  test("today's activities section visible for squad commander", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    await expect(main.getByText("פעילויות היום")).toBeVisible({ timeout: 60000 });
    await expect(main.getByText("Shooting Drill 1")).toBeVisible();
  });

  test("active requests scoped to squad commander's squad", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    // Soldier1 (Cohen Avi) is in Squad A — should be visible
    await expect(main.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });
    // Soldier4 (Eilat Dan) is in Squad B — should NOT be visible for squad commander
    await expect(main.getByText("Eilat Dan")).not.toBeVisible();
  });

  test("squad card shows active request count", async ({ page }) => {
    await page.goto("/home");

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Squad A" })).toBeVisible({ timeout: 60000 });
    // Squad A has at least 1 active request (soldier1's seeded leave)
    // Exact count may vary due to parallel test data — just verify the label appears
    const squadCard = main.getByRole("heading", { name: "Squad A" }).locator("../..");
    await expect(squadCard.getByRole("button", { name: /\d+.*פעיל[הות]/ })).toBeVisible();
  });
});
