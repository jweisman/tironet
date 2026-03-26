import { test, expect } from "@playwright/test";

test.describe("Admin — Users", () => {
  test.setTimeout(60000);

  test("shows seeded users", async ({ page }) => {
    await page.goto("/admin/users");

    const main = page.getByRole("main");
    await expect(main.getByText("admin-e2e@test.com")).toBeVisible({ timeout: 15000 });
    await expect(main.getByText("Platoon Commander")).toBeVisible();
    await expect(main.getByText("Squad Commander")).toBeVisible();
  });

  test("shows pending invitations", async ({ page }) => {
    await page.goto("/admin/users");

    // Pending invitations section
    await expect(page.getByText("הזמנות ממתינות")).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("new-e2e@test.com")).toBeVisible();
  });

  test("create new invitation", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("main").getByText("admin-e2e@test.com")).toBeVisible({ timeout: 15000 });

    // Click invite button
    await page.getByRole("button", { name: /הזמן משתמש/ }).click();
    const dialog = page.getByRole("dialog");

    // Fill email
    await dialog.getByLabel("אימייל").fill("another-e2e@test.com");

    // Select cycle — click combobox in the מחזור field group
    await dialog.locator("text=מחזור").first().locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Test Cycle 2026" }).click();

    // Select role
    await dialog.locator("text=תפקיד").first().locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "מ\"כ" }).click();

    // Select unit
    await dialog.locator("text=יחידה").first().locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Squad A" }).click();

    // Submit
    await dialog.getByRole("button", { name: "צור הזמנה" }).click();

    // Should show success with invite URL
    await expect(page.getByText("העתק קישור הזמנה")).toBeVisible({
      timeout: 10000,
    });

    // Close dialog
    await page.getByRole("button", { name: "סיום" }).click();
  });

  test("cancel invitation", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page.getByRole("main").getByText("admin-e2e@test.com")).toBeVisible({ timeout: 15000 });

    // Create a temporary invitation to cancel (don't rely on seeded one)
    await page.getByRole("button", { name: /הזמן משתמש/ }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByLabel("אימייל").fill("cancel-me-e2e@test.com");

    await dialog.locator("text=מחזור").first().locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Test Cycle 2026" }).click();

    await dialog.locator("text=תפקיד").first().locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "מ\"כ" }).click();

    await dialog.locator("text=יחידה").first().locator("..").getByRole("combobox").click();
    await page.getByRole("option", { name: "Squad A" }).click();

    await dialog.getByRole("button", { name: "צור הזמנה" }).click();
    await expect(page.getByText("העתק קישור הזמנה")).toBeVisible({ timeout: 10000 });
    await page.getByRole("button", { name: "סיום" }).click();

    // Now cancel it
    await expect(page.getByText("cancel-me-e2e@test.com")).toBeVisible({ timeout: 10000 });
    const invRow = page.getByText("cancel-me-e2e@test.com", { exact: true }).locator("../..");
    await invRow.locator("button:has(svg.lucide-trash-2)").click();
    await page.getByRole("button", { name: "בטל הזמנה" }).click();

    // Should be removed
    await expect(
      page.getByText("cancel-me-e2e@test.com", { exact: true })
    ).toHaveCount(0, { timeout: 10000 });
  });
});
