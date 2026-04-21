import { type Browser, type BrowserContext } from "@playwright/test";
import { getLatestEmail, extractVerificationUrl } from "./mailhog";

/**
 * Log in a user via the magic link flow and save storageState.
 *
 * 1. Navigate to /login
 * 2. Enter email, submit
 * 3. Fetch verification email from Mailhog
 * 4. Navigate to the verification URL
 * 5. Wait for redirect to /home
 * 6. Save storageState to the given path
 */
export async function loginAndSaveState(
  browser: Browser,
  email: string,
  storageStatePath: string
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to login
  await page.goto("/login");

  // Fill in the email field and submit the magic link form.
  // The login page has multiple forms (SMS, Google, email) — scope to the
  // form that contains the email input so we click the right submit button.
  const emailInput = page.locator('input#email');
  await emailInput.fill(email);
  await emailInput.locator('xpath=ancestor::form').locator('button[type="submit"]').click();

  // Fetch the verification email from Mailhog (retries internally until delivery)
  const message = await getLatestEmail(email);
  const verifyUrl = extractVerificationUrl(message);

  // Navigate to the verification URL to complete login
  await page.goto(verifyUrl);

  // Wait for redirect to /home (authenticated)
  await page.waitForURL("**/home", { timeout: 15000 });

  // Dismiss all guided tours so the driver.js overlay doesn't block interactions
  await page.evaluate(() => {
    const pages = [
      "home", "soldiers", "activities", "requests",
      "soldier-detail", "activity-detail", "request-detail",
    ];
    for (const p of pages) {
      localStorage.setItem(`tironet:tour-seen:${p}`, "1");
    }
  });

  // Save the authenticated state
  await context.storageState({ path: storageStatePath });

  await context.close();
}
