import { test, expect } from "@playwright/test";

test.describe("Activities — platoon commander", () => {
  test.use({ storageState: "e2e/.auth/platoon-cmd.json" });
  test.setTimeout(90000);

  test("activity list shows seeded activities", async ({ page }) => {
    await page.goto("/activities");

    // Wait for PowerSync sync
    await expect(page.getByText("Shooting Drill 1")).toBeVisible({
      timeout: 60000,
    });
    await expect(page.getByText("Navigation Exercise")).toBeVisible();
  });

  test("filter by draft shows only draft activities", async ({ page }) => {
    await page.goto("/activities");
    await expect(page.getByText("Shooting Drill 1")).toBeVisible({
      timeout: 60000,
    });

    // Click draft filter pill (use exact to avoid matching activity card buttons)
    await page.getByRole("button", { name: "טיוטה", exact: true }).click();

    // Only draft activity should be visible
    await expect(page.getByText("Draft Activity")).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Shooting Drill 1")).not.toBeVisible();
  });

  test("activity detail page shows squads with soldiers", async ({ page }) => {
    await page.goto("/activities");
    await expect(page.getByText("Shooting Drill 1")).toBeVisible({
      timeout: 60000,
    });

    // Click on the activity
    await page.getByText("Shooting Drill 1").click();

    // Should navigate to detail page
    await expect(page).toHaveURL(/\/activities\//, { timeout: 5000 });

    // Should show soldiers from Platoon 1 squads (familyName givenName)
    await expect(page.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Levi Barak")).toBeVisible();
  });

  test("platoon commander sees create activity button", async ({ page }) => {
    await page.goto("/activities");
    await expect(page.getByText("Shooting Drill 1")).toBeVisible({
      timeout: 60000,
    });

    // Should see create button
    await expect(
      page.getByRole("button", { name: /פעילות חדשה|הוסף פעילות/ })
    ).toBeVisible();
  });

  test("create new activity", async ({ page }) => {
    await page.goto("/activities");
    await expect(page.getByText("Shooting Drill 1")).toBeVisible({
      timeout: 60000,
    });

    // Click create
    await page
      .getByRole("button", { name: /פעילות חדשה|הוסף פעילות/ })
      .click();

    // Fill activity form — select type first
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").click();
    // Use first available option (Shooting may be renamed by parallel admin test)
    await page.getByRole("option").first().click();

    // Fill name
    const nameInput = dialog.getByLabel("שם הפעילות");
    await nameInput.clear();
    await nameInput.fill("E2E Test Activity");

    // Submit
    await dialog.getByRole("button", { name: /צור פעילות/ }).click();

    // Should see the new activity
    await expect(page.getByText("E2E Test Activity")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Activities — squad commander", () => {
  test.use({ storageState: "e2e/.auth/squad-cmd.json" });
  test.setTimeout(90000);

  test("squad commander does NOT see create activity button", async ({
    page,
  }) => {
    await page.goto("/activities");

    // Wait for activities to load
    await expect(page.getByText("Shooting Drill 1")).toBeVisible({
      timeout: 60000,
    });

    // Should NOT have create button
    await expect(
      page.getByRole("button", { name: /פעילות חדשה|הוסף פעילות/ })
    ).not.toBeVisible();
  });
});
