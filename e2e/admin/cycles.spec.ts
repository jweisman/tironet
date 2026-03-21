import { test, expect } from "@playwright/test";

test.describe("Admin — Cycles", () => {
  test("shows seeded cycle in list", async ({ page }) => {
    await page.goto("/admin/cycles");

    await expect(page.getByText("Test Cycle 2026")).toBeVisible({
      timeout: 10000,
    });
  });

  test("create new cycle", async ({ page }) => {
    await page.goto("/admin/cycles");

    // Click add button
    await page.getByRole("button", { name: /הוסף מחזור/ }).click();

    // Fill in name
    await page.fill('input[placeholder="שם מחזור"]', "E2E New Cycle");

    // Confirm (checkmark button)
    await page.locator("button:has(svg.lucide-check)").click();

    // New cycle should appear
    await expect(page.getByText("E2E New Cycle")).toBeVisible({
      timeout: 5000,
    });
  });

  test("edit cycle name", async ({ page }) => {
    await page.goto("/admin/cycles");
    await expect(page.getByText("Test Cycle 2026")).toBeVisible({
      timeout: 10000,
    });

    // Create a temporary cycle to edit (don't touch the seeded one)
    await page.getByRole("button", { name: /הוסף מחזור/ }).click();
    await page.fill('input[placeholder="שם מחזור"]', "Edit Me Cycle");
    await page.locator("button:has(svg.lucide-check)").click();
    await expect(page.getByText("Edit Me Cycle")).toBeVisible({ timeout: 5000 });

    // Click the edit button on the new cycle row
    const cycleRow = page.getByText("Edit Me Cycle").locator("..");
    await cycleRow.locator("button:has(svg.lucide-pencil)").click();

    // Clear and type new name
    const input = page.locator("input").first();
    await input.clear();
    await input.fill("Edited Cycle");

    // Confirm
    await page.locator("button:has(svg.lucide-check)").click();

    // Updated name should appear
    await expect(page.getByText("Edited Cycle")).toBeVisible({
      timeout: 5000,
    });
  });

  test("toggle cycle active/inactive", async ({ page }) => {
    await page.goto("/admin/cycles");
    await expect(page.getByText("Test Cycle 2026")).toBeVisible({
      timeout: 10000,
    });

    // Create a temporary cycle to toggle (don't touch the seeded one)
    await page.getByRole("button", { name: /הוסף מחזור/ }).click();
    await page.fill('input[placeholder="שם מחזור"]', "Toggle Test Cycle");
    await page.locator("button:has(svg.lucide-check)").click();
    await expect(page.getByText("Toggle Test Cycle")).toBeVisible({ timeout: 5000 });

    // Toggle the new cycle off
    const toggle = page
      .getByText("Toggle Test Cycle")
      .locator("..")
      .getByRole("switch");
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked({ timeout: 5000 });

    // Toggle back on
    await toggle.click();
    await expect(toggle).toBeChecked({ timeout: 5000 });
  });
});
