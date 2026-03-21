import { type Browser, type BrowserContext } from "@playwright/test";
import { getLatestEmail, extractVerificationUrl, clearMailhog } from "./mailhog";

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
  // Clear any previous emails for this address
  await clearMailhog();

  const context = await browser.newContext();
  const page = await context.newPage();

  // Navigate to login
  await page.goto("/login");

  // Fill in the email field and submit the magic link form
  await page.fill('input#email', email);
  await page.click('form button[type="submit"]');

  // Wait for the "check your email" confirmation
  await page.waitForTimeout(1000);

  // Fetch the verification email from Mailhog
  const message = await getLatestEmail(email);
  const verifyUrl = extractVerificationUrl(message);

  // Navigate to the verification URL to complete login
  await page.goto(verifyUrl);

  // Wait for redirect to /home (authenticated)
  await page.waitForURL("**/home", { timeout: 15000 });

  // Save the authenticated state
  await context.storageState({ path: storageStatePath });

  await context.close();
}
