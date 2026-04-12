import { test, expect } from "@playwright/test";

test.describe("Admin — Structure", () => {
  test("shows seeded structure tree", async ({ page }) => {
    await page.goto("/admin/structure");

    // Select the cycle first
    // Select Test Cycle 2026 from the cycle combobox
    const cyclePicker = page.getByRole("combobox").first();
    await cyclePicker.click();
    await page.getByRole("option", { name: "Test Cycle 2026" }).click();

    // Company should be visible
    await expect(page.getByText("Company Alpha")).toBeVisible({
      timeout: 10000,
    });
  });

  test("expand company to see platoons", async ({ page }) => {
    await page.goto("/admin/structure");
    // Select Test Cycle 2026 from the cycle combobox
    const cyclePicker = page.getByRole("combobox").first();
    await cyclePicker.click();
    await page.getByRole("option", { name: "Test Cycle 2026" }).click();
    await expect(page.getByText("Company Alpha")).toBeVisible({
      timeout: 10000,
    });

    // Expand Company Alpha
    // Click the chevron expand button next to Company Alpha
    await page
      .getByText("Company Alpha")
      .locator("..")
      .locator("button:has(svg.lucide-chevron-right), button:has(svg.lucide-chevron-down)")
      .first()
      .click();

    // Platoons should be visible
    await expect(page.getByText("Platoon 1")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Platoon 2")).toBeVisible();
  });

  test("expand platoon to see squads", async ({ page }) => {
    await page.goto("/admin/structure");
    // Select Test Cycle 2026 from the cycle combobox
    const cyclePicker = page.getByRole("combobox").first();
    await cyclePicker.click();
    await page.getByRole("option", { name: "Test Cycle 2026" }).click();
    await expect(page.getByText("Company Alpha")).toBeVisible({
      timeout: 10000,
    });

    // Expand company then platoon
    // Click the chevron expand button next to Company Alpha
    await page
      .getByText("Company Alpha")
      .locator("..")
      .locator("button:has(svg.lucide-chevron-right), button:has(svg.lucide-chevron-down)")
      .first()
      .click();
    await expect(page.getByText("Platoon 1")).toBeVisible({ timeout: 5000 });
    // Click the chevron expand button next to Platoon 1
    await page
      .getByText("Platoon 1")
      .locator("..")
      .locator("button:has(svg.lucide-chevron-right), button:has(svg.lucide-chevron-down)")
      .first()
      .click();

    // Squads should be visible
    await expect(page.getByText("Squad A")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("Squad B")).toBeVisible();
  });

  test("create new company", async ({ page }) => {
    await page.goto("/admin/structure");
    // Select Test Cycle 2026 from the cycle combobox
    const cyclePicker = page.getByRole("combobox").first();
    await cyclePicker.click();
    await page.getByRole("option", { name: "Test Cycle 2026" }).click();
    await expect(page.getByText("Company Alpha")).toBeVisible({
      timeout: 10000,
    });

    // Click "פלוגה" button inside the battalion section to add a company
    await page.getByRole("button", { name: "פלוגה" }).first().click();

    // Fill name
    await page.fill('input[placeholder="שם פלוגה"]', "Company Bravo");
    await page.locator("button:has(svg.lucide-check)").click();

    // Should appear
    await expect(page.getByText("Company Bravo")).toBeVisible({
      timeout: 5000,
    });
  });

  test("create platoon under company", async ({ page }) => {
    await page.goto("/admin/structure");
    // Select Test Cycle 2026 from the cycle combobox
    const cyclePicker = page.getByRole("combobox").first();
    await cyclePicker.click();
    await page.getByRole("option", { name: "Test Cycle 2026" }).click();
    await expect(page.getByText("Company Alpha")).toBeVisible({
      timeout: 10000,
    });

    // Expand company
    // Click the chevron expand button next to Company Alpha
    await page
      .getByText("Company Alpha")
      .locator("..")
      .locator("button:has(svg.lucide-chevron-right), button:has(svg.lucide-chevron-down)")
      .first()
      .click();

    // Click "מחלקה" button (add platoon)
    await page.getByRole("button", { name: /מחלקה/ }).first().click();

    // Fill name
    await page.fill('input[placeholder="שם מחלקה"]', "Platoon 3");
    await page.locator("button:has(svg.lucide-check)").click();

    // Should appear
    await expect(page.getByText("Platoon 3")).toBeVisible({ timeout: 5000 });
  });
});
