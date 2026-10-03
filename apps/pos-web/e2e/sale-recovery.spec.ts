import { expect, test, type Page } from "@playwright/test";
import { installAuthoritativeStaffSession } from "./staff-session";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RECOVERY_MESSAGE = "This existing order cannot yet be safely opened for payment.";
const FINGERPRINT = "0123456789abcdef0123456789abcdef";

async function installRecoveryFixture(page: Page, lostResponse?: "remote-prepared" | "locally-prepared") {
  await installAuthoritativeStaffSession(page);
  await page.route("**/api/pos/v1/registers/reg_a/active-shift", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, correlationId: CORRELATION, data: {
        id: "11111111-1111-4111-8111-111111111111", registerId: "reg_a",
        deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cashierId: "cashier_a",
        status: "open", openingFloat: { minor: 50000, currency: "GHS" }, openedAt: "2026-10-03T03:00:00Z",
      },
    }),
  }));
  await page.route("**/api/pos/v1/attention", (route) => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ ok: true, correlationId: CORRELATION, data: { items: [] } }),
  }));
  await page.route("**/api/pos/v1/session", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, correlationId: CORRELATION, data: {
        session: { actorId: "cashier_a", displayName: "Recovery Manager", organizationId: "org_a",
          locationIds: ["loc_a1"], capabilities: ["ui.hint.only"], expiresAt: "2099-01-01T00:00:00Z" },
        assignedLocationIds: ["loc_a1"], assignedRegisterIds: ["reg_a"],
      },
    }),
  }));
  await page.route("**/api/pos/v1/quotes", (route) => {
    const input = route.request().postDataJSON();
    const money = { minor: 1500, currency: "GHS" };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, correlationId: CORRELATION, data: {
        id: "quote-original-recovery", fingerprint: FINGERPRINT, cartId: input.cartId,
        cartRevision: input.cartRevision, customer: input.customer, locationId: input.locationId,
        currency: "GHS", lines: input.lines.map((line: object) => ({ ...line,
          unitPrice: money, subtotal: money, discount: { minor: 0, currency: "GHS" },
          tax: { minor: 0, currency: "GHS" }, total: money, stockStatus: "in_stock",
          purchasable: true, problems: [],
        })), subtotal: money, discount: { minor: 0, currency: "GHS" },
        tax: { minor: 0, currency: "GHS" }, total: money,
        calculatedAt: "2026-10-03T03:00:00Z", expiresAt: "2099-01-01T00:00:00Z", purchasable: true,
      },
    }) });
  });
  const prepareRequests: Array<{ body: Record<string, unknown>; key: string }> = [];
  let repaired = false;
  let financialCalls = 0;
  await page.route("**/api/pos/v1/payments/**", (route) => {
    if (route.request().method() === "GET") return route.fallback();
    financialCalls += 1;
    return route.fulfill({ status: 500, body: "Recovery must not take payment" });
  });
  await page.route("**/api/pos/v1/sales/finalize", (route) => {
    financialCalls += 1;
    return route.fulfill({ status: 500, body: "Recovery must not finalize" });
  });
  await page.route("**/api/pos/v1/sales/prepare", (route) => {
    const body = route.request().postDataJSON();
    prepareRequests.push({ body, key: route.request().headers()["idempotency-key"] ?? "" });
    if (prepareRequests.length === 1) {
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({
        ok: false, correlationId: CORRELATION, error: { code: "REQUIRES_ATTENTION",
          message: RECOVERY_MESSAGE, retryable: false, nextAction: "resolve" },
      }) });
    }
    if (lostResponse && prepareRequests.length === 2) {
      repaired = true;
      return route.abort("failed");
    }
    repaired = true;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, correlationId: CORRELATION, data: { transactionId: body.transactionId,
        saleId: "sale-original-recovery", orderReference: "SYNTHETIC-RECOVERY",
        quoteFingerprint: body.quoteFingerprint, total: { minor: 1500, currency: "GHS" },
        status: "prepared", stockCommitment: "reserved", preparedAt: "2026-10-03T03:00:00Z",
        expiresAt: "2099-01-01T00:00:00Z" },
    }) });
  });
  await page.route("**/api/pos/v1/sales/*", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const transactionId = new URL(route.request().url()).pathname.split("/").at(-1);
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, correlationId: CORRELATION, data: { transactionId,
        status: repaired && lostResponse !== "remote-prepared" ? "prepared" : "requires_attention",
        saleId: "sale-original-recovery", orderReference: "SYNTHETIC-RECOVERY",
        message: repaired && lostResponse === "remote-prepared"
          ? "The stored quote is no longer valid, so this prepared sale cannot be opened for payment. Current catalog data was not used."
          : RECOVERY_MESSAGE },
    }) });
  });
  return { prepareRequests, financialCalls: () => financialCalls };
}

async function leaveUnfinishedOriginalSale(page: Page) {
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await page.locator("#product-search").fill("0012345678901");
  await page.locator("#product-search").press("Enter");
  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible();
  await page.getByRole("button", { name: "Pay GHS 15.00" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-checkout-stage='finalize_failed']")).toBeVisible();
  await page.goto("/attention");
  await expect(page.getByText("Sale needs a status check", { exact: true })).toBeVisible();
}

test("manager explicitly repairs the same original sale and resumes payment choice without a charge", async ({ page }) => {
  const fixture = await installRecoveryFixture(page);
  await leaveUnfinishedOriginalSale(page);
  await expect(page.getByRole("banner")).toContainText("Recovery Manager");
  await page.getByRole("button", { name: "Check / Recover" }).click();
  await expect(page.getByRole("button", { name: "Repair this sale" })).toBeVisible();
  expect(fixture.prepareRequests).toHaveLength(1);
  await page.getByRole("button", { name: "Repair this sale" }).click();
  await expect(page).toHaveURL(/\/sell$/);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.locator("[data-checkout-stage='choose_payment']")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("GHS 15.00");
  expect(fixture.prepareRequests).toHaveLength(2);
  expect(fixture.prepareRequests[1]).toEqual(fixture.prepareRequests[0]);
  expect(fixture.prepareRequests[0]?.key).toMatch(/^[0-9a-f-]{36}$/);
  expect(fixture.financialCalls()).toBe(0);
  await expect(page.getByRole("button", { name: "Repair this sale" })).toHaveCount(0);
});

for (const state of ["remote-prepared", "locally-prepared"] as const) {
  test(`lost repair response can resume the same sale from ${state} without another charge`, async ({ page }) => {
    const fixture = await installRecoveryFixture(page, state);
    await leaveUnfinishedOriginalSale(page);
    await page.getByRole("button", { name: "Check / Recover" }).click();
    await page.getByRole("button", { name: "Repair this sale" }).click();
    await expect(page.locator("[data-attention-recovery-feedback]")).toContainText("original sale was kept");
    expect(fixture.prepareRequests).toHaveLength(2);
    await page.getByRole("button", { name: "Check / Recover" }).click();
    await expect(page.getByRole("button", { name: "Repair this sale" })).toBeVisible();
    expect(fixture.prepareRequests).toHaveLength(2);
    await page.getByRole("button", { name: "Repair this sale" }).click();
    await expect(page).toHaveURL(/\/sell$/);
    await expect(page.locator("[data-checkout-stage='choose_payment']")).toBeVisible();
    expect(fixture.prepareRequests).toHaveLength(3);
    expect(fixture.prepareRequests[1]).toEqual(fixture.prepareRequests[0]);
    expect(fixture.prepareRequests[2]).toEqual(fixture.prepareRequests[0]);
    expect(fixture.financialCalls()).toBe(0);
  });
}

test("expired recovery sign-in is shown and the original saved work survives", async ({ page }) => {
  const fixture = await installRecoveryFixture(page);
  await leaveUnfinishedOriginalSale(page);
  const failure = { ok: false, correlationId: CORRELATION, error: {
    code: "AUTH_REQUIRED", message: "staff session expired", retryable: false, nextAction: "reauthenticate",
  } };
  await page.route("**/api/pos/v1/sales/*", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify(failure),
  }));
  await page.route("**/api/pos/v1/session", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify(failure),
  }));
  await page.getByRole("button", { name: "Check / Recover" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(fixture.prepareRequests).toHaveLength(1);
  expect(fixture.financialCalls()).toBe(0);
  const saved = await page.evaluate(() => new Promise<{ journals: number; drafts: number }>((resolve, reject) => {
    const open = indexedDB.open("cetech-pos-local");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction(["journal", "cartDrafts"], "readonly");
      const journal = tx.objectStore("journal").count();
      const drafts = tx.objectStore("cartDrafts").count();
      tx.oncomplete = () => { resolve({ journals: journal.result, drafts: drafts.result }); db.close(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  expect(saved.journals).toBeGreaterThan(0);
  expect(saved.drafts).toBeGreaterThan(0);
});

test("an unauthorized inbox cannot repeatedly restart a valid staff session", async ({ page }) => {
  const harness = await installAuthoritativeStaffSession(page);
  await page.route("**/api/pos/v1/attention", (route) => route.fulfill({
    status: 401, contentType: "application/json", body: JSON.stringify({
      ok: false, correlationId: CORRELATION, error: {
        code: "AUTH_REQUIRED", message: "staff session expired", retryable: false, nextAction: "reauthenticate",
      },
    }),
  }));
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await expect.poll(harness.sessionGets).toBe(2);
  await page.getByRole("button", { name: "Orders", exact: true }).click();
  await expect(page.getByRole("region", { name: "Orders" })).toBeVisible();
  await page.getByRole("button", { name: "Sell", exact: true }).click();
  await expect(page.locator("#product-search")).toBeVisible();
  expect(harness.sessionGets()).toBe(2);
});
