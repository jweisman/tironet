import { test, expect } from "@playwright/test";

test.describe("Navigation — admin user", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("admin sees admin link in sidebar", async ({ page }) => {
    await page.goto("/home");
    // Use .first() because both sidebar and mobile tabbar have admin links
    await expect(page.locator('a[href="/admin"]').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("sidebar links navigate correctly", async ({ page }) => {
    await page.goto("/home");

    // Navigate to soldiers — use .first() to target sidebar link (not tabbar)
    await page.locator('a[href="/soldiers"]').first().click();
    await expect(page).toHaveURL(/\/soldiers/);

    // Navigate to activities
    await page.locator('a[href="/activities"]').first().click();
    await expect(page).toHaveURL(/\/activities/);

    // Navigate back to home
    await page.locator('a[href="/home"]').first().click();
    await expect(page).toHaveURL(/\/home/);
  });
});

test.describe("Navigation — platoon commander", () => {
  test.use({ storageState: "e2e/.auth/platoon-cmd.json" });

  test("platoon commander does NOT see admin link", async ({ page }) => {
    await page.goto("/home");
    // Wait for sidebar to render
    await expect(page.locator('a[href="/home"]').first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  });

  test("non-admin visiting /admin is redirected to /home", async ({
    page,
  }) => {
    await page.goto("/admin/cycles");
    await expect(page).toHaveURL(/\/home/, { timeout: 10000 });
  });

  test("platoon commander sees users nav item", async ({ page }) => {
    await page.goto("/home");
    await expect(page.locator('a[href="/users"]').first()).toBeVisible({
      timeout: 10000,
    });
  });
});

test.describe("Navigation — squad commander", () => {
  test.use({ storageState: "e2e/.auth/squad-cmd.json" });

  test("squad commander does NOT see admin link", async ({ page }) => {
    await page.goto("/home");
    await expect(page.locator('a[href="/home"]').first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  });

  test("squad commander does NOT see users nav item", async ({ page }) => {
    await page.goto("/home");
    await expect(page.locator('a[href="/home"]').first()).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('a[href="/users"]')).toHaveCount(0);
  });
});
