import { test, expect } from "@playwright/test";

test.describe("Soldiers — platoon commander", () => {
  test.use({ storageState: "e2e/.auth/platoon-cmd.json" });
  test.setTimeout(90000);

  test("soldier list shows seeded soldiers", async ({ page }) => {
    await page.goto("/soldiers");

    // Wait for PowerSync sync — UI shows familyName givenName (Hebrew convention)
    await expect(page.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Levi Barak")).toBeVisible();
    await expect(page.getByText("Eilat Dan")).toBeVisible();
  });

  test("soldiers are grouped by squad", async ({ page }) => {
    await page.goto("/soldiers");
    await expect(page.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });

    // Squad headers should be visible
    await expect(page.getByText("Squad A")).toBeVisible();
    await expect(page.getByText("Squad B")).toBeVisible();
  });

  test("search filters soldiers by name", async ({ page }) => {
    await page.goto("/soldiers");
    await expect(page.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });

    // Type in search
    await page.fill('input[type="search"], input[placeholder*="חיפוש"]', "Avi");

    // Only Avi should be visible
    await expect(page.getByText("Cohen Avi")).toBeVisible();
    await expect(page.getByText("Levi Barak")).not.toBeVisible();
  });

  test("soldier detail page shows reports", async ({ page }) => {
    await page.goto("/soldiers");
    await expect(page.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });

    // Click on soldier — use first() in case multiple elements match
    await page.getByText("Cohen Avi").first().click();

    // Should navigate to detail
    await expect(page).toHaveURL(/\/soldiers\//, { timeout: 15000 });

    // Should show soldier name
    await expect(page.getByRole("heading", { name: "Cohen Avi" })).toBeVisible({ timeout: 60000 });
  });

  test("add soldier form", async ({ page }) => {
    await page.goto("/soldiers");
    await expect(page.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });

    // Click add soldier button
    await page
      .getByRole("button", { name: /הוסף חייל|חייל חדש/ })
      .click();

    // Fill form
    await page.fill('input[name="givenName"], input[placeholder*="שם פרטי"]', "Ziv");
    await page.fill('input[name="familyName"], input[placeholder*="שם משפחה"]', "Test");

    // Select squad if needed (no default — user must pick one)
    const squadSelect = page.getByText("בחר כיתה");
    if (await squadSelect.isVisible()) {
      await squadSelect.click();
      await page.getByRole("option", { name: "Squad A" }).click();
    }

    // Submit
    await page.getByRole("button", { name: /הוסף|צור/ }).click();

    // Handle "existing activities" dialog if it appears
    const activitiesDialog = page.getByRole("alertdialog");
    if (await activitiesDialog.isVisible({ timeout: 3000 }).catch(() => false)) {
      await activitiesDialog.getByRole("button", { name: /כן/ }).click();
    }

    // Should appear in list (familyName givenName format)
    await expect(page.getByText("Test Ziv")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Soldiers — squad commander", () => {
  test.use({ storageState: "e2e/.auth/squad-cmd.json" });
  test.setTimeout(90000);

  test("squad commander sees soldiers from their cycle", async ({
    page,
  }) => {
    await page.goto("/soldiers");

    // Squad commander sees all soldiers synced for their cycle (sync scopes by cycle_id)
    // Their own squad soldiers should be visible
    await expect(page.getByText("Cohen Avi")).toBeVisible({ timeout: 60000 });
    await expect(page.getByText("Levi Barak")).toBeVisible();
  });
});
