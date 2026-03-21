import { test, expect } from "@playwright/test";

test.describe("Admin — Activity Types", () => {
  test("shows seeded activity types", async ({ page }) => {
    await page.goto("/admin/activity-types");

    // Use the type list area to avoid matching nav or dialog text
    const typeList = page.locator(".space-y-2").last();
    await expect(typeList.getByText("Shooting")).toBeVisible({ timeout: 10000 });
    await expect(typeList.getByText("Navigation", { exact: true })).toBeVisible();
  });

  test("create new activity type", async ({ page }) => {
    await page.goto("/admin/activity-types");
    await expect(page.getByText("Shooting")).toBeVisible({ timeout: 10000 });

    // Click add
    await page.getByRole("button", { name: /הוסף סוג/ }).click();

    // Fill name and icon
    await page.fill('input[placeholder="שם סוג פעילות"]', "Fitness Test");
    await page.fill('input[placeholder*="Lucide"]', "Dumbbell");

    // Confirm
    await page.locator("button:has(svg.lucide-check)").click();

    // Should appear
    await expect(page.getByText("Fitness Test")).toBeVisible({ timeout: 5000 });
  });

  test("edit activity type name", async ({ page }) => {
    await page.goto("/admin/activity-types");
    await expect(page.getByText("Shooting")).toBeVisible({ timeout: 10000 });

    // Create a temporary type to edit (don't modify seeded ones)
    await page.getByRole("button", { name: /הוסף סוג/ }).click();
    await page.fill('input[placeholder="שם סוג פעילות"]', "Rename Me");
    await page.fill('input[placeholder*="Lucide"]', "Edit");
    await page.locator("button:has(svg.lucide-check)").click();
    await expect(page.getByText("Rename Me")).toBeVisible({ timeout: 5000 });

    // Click edit on Rename Me
    const row = page.getByText("Rename Me").locator("..");
    await row.locator("button:has(svg.lucide-pencil)").click();

    // Clear and type new name — use textbox role (not hidden checkbox)
    const input = page.getByRole("textbox").first();
    await input.clear();
    await input.fill("Renamed Type");

    // Confirm
    await page.locator("button:has(svg.lucide-check)").click();

    await expect(page.getByText("Renamed Type")).toBeVisible({ timeout: 5000 });
  });

  test("delete activity type", async ({ page }) => {
    await page.goto("/admin/activity-types");
    await expect(page.getByText("Shooting")).toBeVisible({ timeout: 10000 });

    // Create a temporary type to delete (seeded types have activities and can't be deleted)
    await page.getByRole("button", { name: /הוסף סוג/ }).click();
    await page.fill('input[placeholder="שם סוג פעילות"]', "Temp Delete Me");
    await page.fill('input[placeholder*="Lucide"]', "Trash");
    await page.locator("button:has(svg.lucide-check)").click();
    await expect(page.getByText("Temp Delete Me")).toBeVisible({ timeout: 5000 });

    // Now delete it
    const row = page.getByText("Temp Delete Me").locator("..");
    await row.locator("button:has(svg.lucide-trash-2)").click();
    await page.getByRole("button", { name: "מחק" }).click();

    // Should be removed
    await expect(page.getByText("Temp Delete Me")).toHaveCount(0, { timeout: 5000 });
  });
});
