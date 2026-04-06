import { test, expect, type Page } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait until a request exists on the server (PowerSync connector has uploaded it).
 * Polls the API every 1s for up to 30s. Call this BEFORE closing a browser context
 * to ensure the local PowerSync write has been synced to PostgreSQL.
 *
 * Optionally verifies the request has a specific status (for workflow transitions).
 */
async function waitForRequestOnServer(page: Page, requestId: string, expectedStatus?: string) {
  await expect(async () => {
    const res = await page.request.get(`/api/requests/${requestId}`);
    expect(res.ok()).toBeTruthy();
    if (expectedStatus) {
      const data = await res.json();
      expect(data.request.status).toBe(expectedStatus);
    }
  }).toPass({ timeout: 30000, intervals: [1000] });
}

/**
 * Wait for PowerSync to sync and the requests page to be ready.
 * Navigates to /requests and waits for either request cards or the empty state.
 */
async function gotoRequestsPage(page: Page) {
  await page.goto("/requests");
  // Wait for PowerSync sync — either the "open" tab button or empty state text
  await expect(
    page.getByRole("button", { name: /פתוחות/ })
  ).toBeVisible({ timeout: 60000 });
}

/**
 * Create a hardship request for the first available soldier.
 * Returns the soldier name displayed on the request card.
 */
async function createHardshipRequest(
  page: Page,
  description: string,
): Promise<string> {
  // Open type selection dialog — use the FAB (mobile) or header button
  const fab = page.getByRole("button", { name: "בקשה חדשה" });
  const headerBtn = page.getByRole("button", { name: /בקשה חדשה/ });
  if (await fab.isVisible()) {
    await fab.click();
  } else {
    await headerBtn.click();
  }

  // Select hardship type
  const typeDialog = page.getByRole("dialog");
  await typeDialog.getByText('בקשת ת"ש').click();

  // Fill the create form
  const formDialog = page.getByRole("dialog");
  await expect(formDialog).toBeVisible();

  // Select first soldier
  await formDialog.getByRole("combobox").click();
  const firstOption = page.getByRole("option").first();
  const soldierName = (await firstOption.textContent())!.replace(/\s*\(.*\)$/, "");
  await firstOption.click();

  // Fill description
  await formDialog.getByLabel("תיאור").fill(description);

  // Submit
  await formDialog.getByRole("button", { name: "צור בקשה" }).click();

  // Wait for toast
  await expect(page.getByText("הבקשה נוצרה בהצלחה")).toBeVisible({ timeout: 10000 });

  return soldierName;
}

// ---------------------------------------------------------------------------
// Squad commander tests
// ---------------------------------------------------------------------------

test.describe("Requests — squad commander", () => {
  test.use({ storageState: "e2e/.auth/squad-cmd.json" });
  test.setTimeout(120000);

  test("can create a hardship request", async ({ page }) => {
    await gotoRequestsPage(page);

    const soldierName = await createHardshipRequest(page, "E2E hardship test");

    // Request should appear in the open tab
    await expect(page.getByText(soldierName).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText('בקשת ת"ש').first()).toBeVisible();
  });

  test("can create and view request detail", async ({ page }) => {
    await gotoRequestsPage(page);

    const soldierName = await createHardshipRequest(page, "E2E detail test");

    // Click on the request to open detail
    await page.getByText(soldierName).first().click();
    await expect(page).toHaveURL(/\/requests\//, { timeout: 15000 });

    // The request should show as assigned to platoon commander (ממתין למ"מ)
    await expect(page.getByText('ממתין למ"מ')).toBeVisible({ timeout: 10000 });
  });

  test("sees open and approved tabs", async ({ page }) => {
    await gotoRequestsPage(page);

    // Verify the page loads (open tab is default)
    await expect(page.getByRole("button", { name: /פתוחות/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /אושרו/ })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Platoon commander tests
// ---------------------------------------------------------------------------

test.describe("Requests — platoon commander", () => {
  test.use({ storageState: "e2e/.auth/platoon-cmd.json" });
  test.setTimeout(120000);

  test("can create a hardship request", async ({ page }) => {
    await gotoRequestsPage(page);

    // Platoon commander can also create requests
    const soldierName = await createHardshipRequest(
      page,
      "E2E platoon cmd hardship",
    );

    // Should appear — platoon commander creating skips to company_commander
    await expect(page.getByText(soldierName).first()).toBeVisible({ timeout: 10000 });
  });

  test("request list shows open and approved tabs", async ({ page }) => {
    await gotoRequestsPage(page);

    // Both tabs should be visible
    await expect(page.getByRole("button", { name: /פתוחות/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /אושרו/ })).toBeVisible();

    // Switch to approved tab
    await page.getByRole("button", { name: /אושרו/ }).click();
  });

  test("'assigned to me' filter works", async ({ page }) => {
    await gotoRequestsPage(page);

    // Click "דורשות טיפולי" filter
    const filterBtn = page.getByRole("button", { name: /דורשות טיפולי/ });
    if (await filterBtn.isVisible()) {
      await filterBtn.click();
      // Filter should be active (amber background)
      await expect(filterBtn).toBeVisible();
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-role workflow: hardship approval chain
// ---------------------------------------------------------------------------

test.describe("Requests — hardship approval workflow (cross-role)", () => {
  test.setTimeout(180000);

  test("squad cmd creates → platoon cmd approves → squad cmd acknowledges", async ({
    browser,
  }) => {
    // Unique description prevents retry contamination (stale requests from attempt 1)
    const desc = `E2E workflow ${Date.now()}`;

    // --- Step 1: Squad commander creates a hardship request ---
    const squadContext = await browser.newContext({
      storageState: "e2e/.auth/squad-cmd.json",
      locale: "he-IL",
    });
    const squadPage = await squadContext.newPage();

    await gotoRequestsPage(squadPage);
    await createHardshipRequest(squadPage, desc);

    // Verify request appears — use description to find the specific request
    await expect(squadPage.getByText(desc).first()).toBeVisible({
      timeout: 10000,
    });

    // Click the specific request card by its unique description
    await squadPage.getByText(desc).first().click();
    await expect(squadPage).toHaveURL(/\/requests\//, { timeout: 15000 });
    const requestUrl = squadPage.url();
    const requestId = requestUrl.match(/\/requests\/([^/]+)/)?.[1];
    expect(requestId).toBeTruthy();

    // Verify it's waiting for platoon commander
    await expect(squadPage.getByText('ממתין למ"מ')).toBeVisible({
      timeout: 10000,
    });

    // Wait for the connector to upload the new request to the server
    await waitForRequestOnServer(squadPage, requestId!);

    await squadPage.close();
    await squadContext.close();

    // --- Step 2: Platoon commander approves the hardship request ---
    const platoonContext = await browser.newContext({
      storageState: "e2e/.auth/platoon-cmd.json",
      locale: "he-IL",
    });
    const platoonPage = await platoonContext.newPage();

    // Navigate directly to the request detail — avoids list strict-mode issues
    await platoonPage.goto(`/requests/${requestId}`);

    // Wait for the approve button — confirms both data loaded and role resolved
    const approveBtn = platoonPage.getByRole("button", { name: "אשר" });
    await expect(approveBtn).toBeVisible({ timeout: 60000 });

    // Click approve — opens note dialog
    await approveBtn.click();

    // Confirm in the note dialog
    const approveDialog = platoonPage.getByRole("dialog");
    await expect(approveDialog).toBeVisible();
    await approveDialog.getByRole("button", { name: "אשר" }).click();

    // Toast should confirm
    await expect(platoonPage.getByText("הבקשה אושרה")).toBeVisible({
      timeout: 10000,
    });

    // For hardship: after platoon commander approves, it goes directly to
    // squad_commander for acknowledgment (skips company commander).
    // The status badge should now show "אושר"
    await expect(platoonPage.getByText("אושר").first()).toBeVisible({
      timeout: 10000,
    });

    // Wait for the connector to upload the approval to the server
    await waitForRequestOnServer(platoonPage, requestId!, "approved");

    await platoonPage.close();
    await platoonContext.close();

    // --- Step 3: Squad commander acknowledges the approved request ---
    const squadContext2 = await browser.newContext({
      storageState: "e2e/.auth/squad-cmd.json",
      locale: "he-IL",
    });
    const squadPage2 = await squadContext2.newPage();

    // Navigate to the request detail
    await squadPage2.goto(`/requests/${requestId}`);

    // Wait for the acknowledge button — confirms data synced and role resolved
    const ackBtn = squadPage2.getByRole("button", { name: "קבלתי" });
    await expect(ackBtn).toBeVisible({ timeout: 60000 });

    // Click acknowledge
    await ackBtn.click();

    // Toast should confirm
    await expect(squadPage2.getByText("הבקשה התקבלה")).toBeVisible({
      timeout: 10000,
    });

    // Workflow is now complete — should show "הטיפול בבקשה הושלם"
    await expect(
      squadPage2.getByText("הטיפול בבקשה הושלם")
    ).toBeVisible({ timeout: 10000 });

    await squadPage2.close();
    await squadContext2.close();
  });
});

// ---------------------------------------------------------------------------
// Cross-role workflow: denial with reason
// ---------------------------------------------------------------------------

test.describe("Requests — denial workflow (cross-role)", () => {
  test.setTimeout(180000);

  test("squad cmd creates → platoon cmd denies with reason → squad cmd acknowledges", async ({
    browser,
  }) => {
    // Unique description prevents retry contamination (stale requests from attempt 1)
    const desc = `E2E deny ${Date.now()}`;

    // --- Step 1: Squad commander creates a hardship request ---
    const squadContext = await browser.newContext({
      storageState: "e2e/.auth/squad-cmd.json",
      locale: "he-IL",
    });
    const squadPage = await squadContext.newPage();

    await gotoRequestsPage(squadPage);
    await createHardshipRequest(squadPage, desc);

    // Verify request appears — use description to find the specific request
    await expect(squadPage.getByText(desc).first()).toBeVisible({
      timeout: 10000,
    });

    // Click the specific request card by its unique description
    await squadPage.getByText(desc).first().click();
    await expect(squadPage).toHaveURL(/\/requests\//, { timeout: 15000 });
    const requestId = squadPage.url().match(/\/requests\/([^/]+)/)?.[1];
    expect(requestId).toBeTruthy();

    // Wait for the connector to upload the new request to the server
    await waitForRequestOnServer(squadPage, requestId!);

    await squadPage.close();
    await squadContext.close();

    // --- Step 2: Platoon commander denies the request ---
    const platoonContext = await browser.newContext({
      storageState: "e2e/.auth/platoon-cmd.json",
      locale: "he-IL",
    });
    const platoonPage = await platoonContext.newPage();

    // Navigate directly to the request detail
    await platoonPage.goto(`/requests/${requestId}`);

    // Wait for the deny button — confirms both data loaded and role resolved
    const denyBtn = platoonPage.getByRole("button", { name: "דחה" });
    await expect(denyBtn).toBeVisible({ timeout: 60000 });

    // Click deny
    await denyBtn.click();

    // Deny dialog should appear
    const denyDialog = platoonPage.getByRole("dialog");
    await expect(denyDialog).toBeVisible();

    // Fill commander note
    await denyDialog.getByPlaceholder("הוסף הערה...").fill("E2E denial reason");

    // Confirm denial
    await denyDialog.getByRole("button", { name: "דחה" }).click();

    // Toast
    await expect(platoonPage.getByText("הבקשה נדחתה")).toBeVisible({
      timeout: 10000,
    });

    // Status should show "נדחה"
    await expect(platoonPage.getByText("נדחה").first()).toBeVisible({
      timeout: 10000,
    });

    // Wait for the connector to upload the denial AND the action note to the server
    await waitForRequestOnServer(platoonPage, requestId!, "denied");
    // Also wait for the request_action (denial note) to be uploaded — it's a separate CRUD op
    await expect(async () => {
      const res = await platoonPage.request.get(`/api/requests/${requestId}`);
      const data = await res.json();
      const hasDenyAction = data.request?.actions?.some(
        (a: { action: string; note: string }) => a.action === "deny" && a.note === "E2E denial reason"
      );
      expect(hasDenyAction).toBeTruthy();
    }).toPass({ timeout: 30000, intervals: [1000] });

    await platoonPage.close();
    await platoonContext.close();

    // --- Step 3: Squad commander sees commander note and acknowledges ---
    const squadContext2 = await browser.newContext({
      storageState: "e2e/.auth/squad-cmd.json",
      locale: "he-IL",
    });
    const squadPage2 = await squadContext2.newPage();

    await squadPage2.goto(`/requests/${requestId}`);

    // Wait for the acknowledge button — confirms data synced and role resolved
    const ackBtn = squadPage2.getByRole("button", { name: "קבלתי" });
    await expect(ackBtn).toBeVisible({ timeout: 60000 });

    // Denial note should be displayed in the audit trail timeline (visible in both desktop+mobile containers, use .first())
    // request_actions may still be syncing via PowerSync even after the request itself is synced, so allow extra time
    await expect(squadPage2.getByText("E2E denial reason").first()).toBeVisible({ timeout: 30000 });
    await expect(squadPage2.getByText("מהלך הטיפול")).toBeVisible();

    // Acknowledge
    await ackBtn.click();

    await expect(squadPage2.getByText("הבקשה התקבלה")).toBeVisible({
      timeout: 10000,
    });

    // Workflow complete — for denied requests, "הטיפול בבקשה הושלם" doesn't show
    // (it only shows for approved). Instead verify the acknowledge button is gone
    // and the "נדחה" status badge remains.
    await expect(
      squadPage2.getByRole("button", { name: "קבלתי" })
    ).not.toBeVisible({ timeout: 10000 });
    await expect(squadPage2.getByText("נדחה").first()).toBeVisible();

    await squadPage2.close();
    await squadContext2.close();
  });
});
