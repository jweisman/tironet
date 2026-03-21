import { test, expect } from "@playwright/test";
import { getTokens } from "./helpers/constants";

let INVITATION_TOKEN: string;
let EXPIRED_INVITATION_TOKEN: string;

test.beforeAll(() => {
  const tokens = getTokens();
  INVITATION_TOKEN = tokens.INVITATION_TOKEN;
  EXPIRED_INVITATION_TOKEN = tokens.EXPIRED_INVITATION_TOKEN;
});

test.describe("Invite flow", () => {
  test.use({ storageState: "e2e/.auth/platoon-cmd.json" });

  test("valid invitation shows invitation details", async ({ page }) => {
    await page.goto(`/invite/${INVITATION_TOKEN}`);

    // Should show invitation details
    await expect(page.getByText("פרטי ההזמנה")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Test Cycle 2026")).toBeVisible();
    await expect(page.getByText("Squad B")).toBeVisible();
  });

  test("expired invitation shows error", async ({ page }) => {
    await page.goto(`/invite/${EXPIRED_INVITATION_TOKEN}`);

    // Should show expiry message
    await expect(page.getByText("פג תוקפה")).toBeVisible({ timeout: 10000 });
  });

  test("invalid token shows not found", async ({ page }) => {
    await page.goto("/invite/nonexistent-token-12345");

    // Should show not found message
    await expect(page.getByText("לא נמצאה")).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Invite flow — unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("unauthenticated user sees login prompt", async ({ page }) => {
    await page.goto(`/invite/${INVITATION_TOKEN}`);

    // Should show login/connect prompt — actual button text is "התחבר וקבל הזמנה"
    await expect(page.getByText("התחבר וקבל הזמנה")).toBeVisible({ timeout: 10000 });
  });
});
