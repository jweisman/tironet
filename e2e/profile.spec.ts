import { test, expect } from "@playwright/test";

test.describe("Profile", () => {
  test.use({ storageState: "e2e/.auth/admin.json" });

  test("shows user info", async ({ page }) => {
    await page.goto("/profile");

    // Name fields should be populated — profile uses label-based inputs
    const givenNameInput = page.getByLabel("שם פרטי");
    await expect(givenNameInput).toHaveValue("Admin", { timeout: 10000 });

    const familyNameInput = page.getByLabel("שם משפחה");
    await expect(familyNameInput).toHaveValue("Test");

    // Email is in a disabled textbox (no proper label)
    await expect(
      page.locator('input[disabled]').filter({ hasText: /admin-e2e/ }).or(
        page.locator('input[value="admin-e2e@test.com"]')
      )
    ).toBeVisible();
  });

  test("edit name saves successfully", async ({ page }) => {
    await page.goto("/profile");
    const givenNameInput = page.getByLabel("שם פרטי");
    await expect(givenNameInput).toBeVisible({ timeout: 10000 });

    // Update given name
    await givenNameInput.clear();
    await givenNameInput.fill("AdminUpdated");

    // Click save
    await page.getByRole("button", { name: "שמור שינויים" }).click();

    // Should show success toast
    await expect(page.getByText(/נשמר/)).toBeVisible({ timeout: 5000 });

    // Restore original name
    await givenNameInput.clear();
    await givenNameInput.fill("Admin");
    await page.getByRole("button", { name: "שמור שינויים" }).click();
    await expect(page.getByText(/נשמר/)).toBeVisible({ timeout: 5000 });
  });

  test("shows cycle assignments", async ({ page }) => {
    await page.goto("/profile");
    // Admin has no cycle assignments — just verify page loads
    await expect(page.getByLabel("שם פרטי")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Profile — platoon commander", () => {
  test.use({ storageState: "e2e/.auth/platoon-cmd.json" });

  test("shows cycle assignments", async ({ page }) => {
    await page.goto("/profile");

    // Should show assignments section
    await expect(page.getByText(/שיבוצים|תפקידים/)).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByText(/Test Cycle 2026/)).toBeVisible();
  });
});
