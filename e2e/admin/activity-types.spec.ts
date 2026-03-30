import { test, expect } from "@playwright/test";

/**
 * Helper: fill the add-activity-type form and submit.
 */
async function addActivityType(
  page: import("@playwright/test").Page,
  name: string,
  icon: string,
) {
  await page.getByRole("button", { name: /הוסף סוג/ }).click();

  const nameInput = page.getByPlaceholder("שם סוג פעילות");
  await expect(nameInput).toBeVisible({ timeout: 5000 });

  await nameInput.fill(name);
  const iconInput = page.getByPlaceholder("שם אייקון (Lucide)");
  await iconInput.fill(icon);

  const confirmBtn = page.getByRole("button", { name: "אישור" });
  await expect(confirmBtn).toBeEnabled({ timeout: 5000 });
  await confirmBtn.click();

  await expect(page.getByText(name)).toBeVisible({ timeout: 15000 });
}

test.describe("Admin — Activity Types", () => {
  test.setTimeout(60000);

  test("shows seeded activity types", async ({ page }) => {
    await page.goto("/admin/activity-types");

    const typeList = page.locator(".space-y-2").last();
    await expect(typeList.getByText("Shooting")).toBeVisible({ timeout: 15000 });
    await expect(typeList.getByText("Navigation", { exact: true })).toBeVisible();
  });

  test("create new activity type", async ({ page }) => {
    await page.goto("/admin/activity-types");
    await expect(page.getByText("Shooting")).toBeVisible({ timeout: 15000 });

    await addActivityType(page, "Fitness Test", "Dumbbell");
  });

  test("edit activity type name", async ({ page }) => {
    await page.goto("/admin/activity-types");
    await expect(page.getByText("Shooting")).toBeVisible({ timeout: 15000 });

    // Create a temporary type to edit (don't modify seeded ones)
    await addActivityType(page, "Rename Me", "Edit");

    // Click edit on Rename Me — navigate up to the border rounded-lg card
    const row = page.locator(".border.rounded-lg", { hasText: "Rename Me" });
    await row.getByRole("button", { name: "ערוך סוג פעילות" }).click();

    // Clear and type new name — use textbox role (not hidden checkbox)
    const input = page.getByRole("textbox").first();
    await input.clear();
    await input.fill("Renamed Type");

    // Confirm edit
    const saveBtn = page.getByRole("button", { name: "שמור" });
    await expect(saveBtn).toBeEnabled({ timeout: 10000 });
    await saveBtn.click();

    await expect(page.getByText("Renamed Type")).toBeVisible({ timeout: 10000 });
  });

  test("delete activity type", async ({ page }) => {
    await page.goto("/admin/activity-types");
    await expect(page.getByText("Shooting")).toBeVisible({ timeout: 15000 });

    // Create a temporary type to delete (seeded types have activities and can't be deleted)
    await addActivityType(page, "Temp Delete Me", "Trash");

    // Now delete it — navigate up to the border rounded-lg card
    const row = page.locator(".border.rounded-lg", { hasText: "Temp Delete Me" });
    await row.getByRole("button", { name: "מחק סוג פעילות" }).click();
    await page.getByRole("button", { name: "מחק" }).click();

    // Should be removed
    await expect(page.getByText("Temp Delete Me")).toHaveCount(0, { timeout: 10000 });
  });
});
