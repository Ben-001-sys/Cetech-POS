import { expect, test, type Page } from "@playwright/test";
import { installAuthoritativeStaffSession } from "./staff-session";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TRANSACTION = "11111111-1111-4111-8111-111111111111";
const CSRF = "synthetic-manager-recovery-csrf";
const RECOVERY_PATH = `/api/pos/v1/admin/sales/${TRANSACTION}/recovery`;
const success = (data: unknown) => JSON.stringify({ ok: true, correlationId: CORRELATION, data });

type RecoveryRequest = { readonly path: string; readonly body: string | null; readonly csrf: string; readonly key?: string };

async function managerRecoveryFixture(page: Page, options: { readonly blocked?: boolean; readonly holdFirstCheck?: Promise<void> } = {}) {
  await installAuthoritativeStaffSession(page);
  await page.context().addCookies([{ name: "cetech_pos_csrf", value: CSRF, url: "http://127.0.0.1:3000" }]);
  await page.addInitScript(() => localStorage.setItem("cetech-pos:selected-register:org_a:manager_a", "reg_a"));
  await page.route("**/api/pos/v1/session", route => route.fulfill({ contentType: "application/json", body: success({
    session: { actorId: "manager_a", displayName: "Recovery Manager", organizationId: "org_a", locationIds: ["loc_a1"], capabilities: [], expiresAt: "2099-01-01T00:00:00Z" },
    assignedLocationIds: ["loc_a1"], assignedRegisterIds: ["reg_a", "reg_a2"],
  }) }));
  await page.route("**/api/pos/v1/admin/context", route => route.fulfill({ contentType: "application/json", body: success({
    actorId: "manager_a", displayName: "Recovery Manager", organizationId: "org_a", controlRole: null,
    managerLocationIds: ["loc_a1"], locationRoles: [{ locationId: "loc_a1", role: "manager" }], sections: ["overview", "shifts_cash", "returns_attention"],
  }) }));
  await page.route("**/api/pos/v1/attention", route => route.fulfill({ contentType: "application/json", body: success({ items: [{
    id: `operation:sale.prepare:${TRANSACTION}`, title: "Sale needs a status check", summary: "Keep the existing sale for review.",
    typeLabel: "Sale", severity: "critical", transactionReference: TRANSACTION, transactionId: TRANSACTION,
    resolveAllowed: true, reviewAllowed: false, recoverKind: "sale",
  }] }) }));
  for (const registerId of ["reg_a", "reg_a2"]) {
    await page.route(`**/api/pos/v1/registers/${registerId}`, route => route.fulfill({ contentType: "application/json", body: success({
      id: registerId, name: registerId === "reg_a" ? "Front Counter" : "Second Counter", locationId: "loc_a1", currency: "GHS", status: "active",
    }) }));
    await page.route(`**/api/pos/v1/registers/${registerId}/active-shift`, route => route.fulfill({ contentType: "application/json", body: success({
      id: registerId === "reg_a" ? "33333333-3333-4333-8333-333333333333" : "44444444-4444-4444-8444-444444444444",
      registerId, deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cashierId: "cashier_a", status: "open",
      openingFloat: { minor: 50000, currency: "GHS" }, openedAt: "2026-10-03T03:00:00Z",
    }) }));
    await page.route(`**/api/pos/v1/registers/${registerId}/devices`, route => route.fulfill({ contentType: "application/json", body: success([
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Synthetic counter tablet" },
    ]) }));
  }
  const writes: RecoveryRequest[] = [];
  let checks = 0;
  const unsafeCalls: string[] = [];
  page.on("request", request => {
    if (request.method() !== "GET" && /\/api\/pos\/v1\/(payments\/|sales\/(prepare|finalize|cancel))/.test(new URL(request.url()).pathname)) {
      unsafeCalls.push(new URL(request.url()).pathname);
    }
  });
  await page.route(`**${RECOVERY_PATH}`, async route => {
    const request = route.request();
    if (request.method() === "GET") {
      checks += 1;
      const check = checks;
      if (check === 1) await options.holdFirstCheck;
      await route.fulfill({ contentType: "application/json", body: success({
        transactionId: TRANSACTION, locationId: "loc_a1", registerId: "reg_a",
        status: options.blocked ? "blocked" : "eligible",
        message: options.blocked ? "Payment work already exists. Keep this same sale for review."
          : check === 1 ? "Original unpaid sale is eligible for manager recovery." : "Current register context checked the original unpaid sale.",
        orderReference: "SYNTHETIC-ORIGINAL", total: { minor: 1500, currency: "GHS" },
      }) });
      return;
    }
    writes.push({ path: new URL(request.url()).pathname, body: request.postData(), csrf: request.headers()["x-csrf-token"] ?? "", key: request.headers()["idempotency-key"] });
    await route.fulfill({ contentType: "application/json", body: success({
      transactionId: TRANSACTION, saleId: "sale-original", orderReference: "SYNTHETIC-ORIGINAL", quoteFingerprint: "0123456789abcdef0123456789abcdef",
      total: { minor: 1500, currency: "GHS" }, status: "prepared", stockCommitment: "reserved",
      preparedAt: "2026-10-03T03:00:00Z", expiresAt: "2099-01-01T00:00:00Z",
    }) });
  });
  await page.goto("/attention");
  const panel = page.locator("[data-manager-sale-recovery='true']");
  await expect(panel.getByRole("heading", { name: "Manager sale recovery", exact: true })).toBeVisible();
  return { panel, writes, unsafeCalls, checks: () => checks };
}

test("manager repairs a server attention sale without a local attempt, new request or payment", async ({ page }) => {
  const fixture = await managerRecoveryFixture(page);
  await fixture.panel.getByRole("button", { name: "Check original sale", exact: true }).click();
  await expect(fixture.panel.getByText("Original unpaid sale is eligible for manager recovery.", { exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]);
  const repair = fixture.panel.getByRole("button", { name: "Repair this sale", exact: true });
  await repair.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(fixture.panel).toContainText("No payment was taken.");
  expect(fixture.writes).toEqual([{ path: RECOVERY_PATH, body: null, csrf: CSRF, key: undefined }]);
  expect(fixture.unsafeCalls).toEqual([]);
  await expect(repair).toHaveCount(0);
});

test("blocked manager capability provides a reason and offers no repair action", async ({ page }) => {
  const fixture = await managerRecoveryFixture(page, { blocked: true });
  await fixture.panel.getByRole("button", { name: "Check original sale", exact: true }).click();
  await expect(fixture.panel).toContainText("Payment work already exists.");
  await expect(fixture.panel.getByRole("button", { name: "Repair this sale", exact: true })).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.unsafeCalls).toEqual([]);
});

test("a delayed old check cannot disable or restore a capability after changing register context", async ({ page }) => {
  let release!: () => void;
  const holdFirstCheck = new Promise<void>(resolve => { release = resolve; });
  const fixture = await managerRecoveryFixture(page, { holdFirstCheck });
  await fixture.panel.getByRole("button", { name: "Check original sale", exact: true }).click();
  await expect(fixture.panel).toContainText("Checking the original sale");
  await page.getByRole("button", { name: "Register", exact: true }).click();
  await page.getByLabel("Working register", { exact: true }).selectOption("reg_a2");
  await expect(page.getByRole("banner")).toContainText("Second Counter");
  await page.getByRole("navigation", { name: "Primary navigation", exact: true })
    .getByRole("button", { name: /^Attention(?: \d+)?$/ }).click();
  await expect(fixture.panel.getByRole("button", { name: "Check original sale", exact: true })).toBeEnabled();
  await fixture.panel.getByRole("button", { name: "Check original sale", exact: true }).click();
  await expect(fixture.panel).toContainText("Current register context checked the original unpaid sale.");
  const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === RECOVERY_PATH && response.request().method() === "GET");
  release();
  await (await oldResponse).finished();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
  await expect.poll(fixture.checks).toBe(2);
  await expect(fixture.panel).not.toContainText("Original unpaid sale is eligible for manager recovery.");
  expect(fixture.writes).toEqual([]);
  expect(fixture.unsafeCalls).toEqual([]);
});
