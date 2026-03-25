import { test, expect } from "@playwright/test";
import { EMAILS } from "./helpers/constants";
import { getLatestEmail, extractVerificationUrl, clearMailhog } from "./helpers/mailhog";

test.describe("Authentication", () => {
  test("login page renders all provider options", async ({ page }) => {
    await page.goto("/login");

    // Google button
    await expect(page.getByRole("button", { name: /google/i })).toBeVisible();

    // Email magic link form
    await expect(page.locator("input#email")).toBeVisible();

    // WhatsApp/SMS OTP button
    await expect(page.getByRole("button", { name: /SMS/ })).toBeVisible();
  });

  test("unauthenticated user visiting /home is redirected to /login", async ({
    page,
  }) => {
    await page.goto("/home");
    await expect(page).toHaveURL(/\/login/);
  });

  test("unauthenticated user visiting /admin is redirected to /login", async ({
    page,
  }) => {
    await page.goto("/admin/cycles");
    await expect(page).toHaveURL(/\/login/);
  });

  test("magic link login flow works end-to-end", async ({ page }) => {
    await clearMailhog();
    await page.goto("/login");

    // Enter email and submit
    await page.fill("input#email", EMAILS.admin);
    await page.click('form button[type="submit"]');

    // Should show "check your email" confirmation — actual translated text
    await expect(page.getByText("בדוק את תיבת הדואר שלך")).toBeVisible({
      timeout: 5000,
    });

    // Fetch verification email from Mailhog
    const message = await getLatestEmail(EMAILS.admin);
    const verifyUrl = extractVerificationUrl(message);

    // Navigate to verification URL
    await page.goto(verifyUrl);

    // Should land on /home
    await expect(page).toHaveURL(/\/home/, { timeout: 15000 });
  });

  test("authenticated user sees their name in sidebar", async ({ browser }) => {
    test.setTimeout(60000);
    const context = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();
    await page.goto("/home");

    // Ensure we're authenticated and on /home (not redirected to /login)
    await expect(page).toHaveURL(/\/home/, { timeout: 15000 });

    // Admin user name should appear in the desktop sidebar.
    // The profile edit test may temporarily rename "Admin" to "AdminUpdated",
    // so match either variant to avoid flake from parallel test execution.
    await expect(
      page.locator("aside p").filter({ hasText: /Admin.*Test/ })
    ).toBeVisible({ timeout: 30000 });
    await context.close();
  });

  test("logout clears session and redirects to landing", async ({
    browser,
  }) => {
    test.setTimeout(60000);
    const context = await browser.newContext({
      storageState: "e2e/.auth/admin.json",
    });
    const page = await context.newPage();
    await page.goto("/home");

    // Wait for the page to be fully loaded and interactive
    await expect(page).toHaveURL(/\/home/, { timeout: 15000 });
    await expect(page.getByRole("button", { name: /התנתק/ })).toBeVisible({
      timeout: 10000,
    });

    // Click logout and wait for navigation away from /home
    await Promise.all([
      page.waitForURL(/^(?!.*\/home)/, { timeout: 30000 }),
      page.getByRole("button", { name: /התנתק/ }).click(),
    ]);

    // Should be on landing page (/) or login page
    await expect(page).toHaveURL(/:\d+\/?$|\/login/, { timeout: 15000 });
    await context.close();
  });
});
