import { expect, test, type Page } from "@playwright/test";
import type { ManagementReturnDetailView } from "../src/server/admin/handle-management-return-detail";
import type { ManagementReturnsAttentionItem } from "../src/server/admin/management-returns-attention-directory";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RETURN_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_RETURN = "44444444-4444-4444-8444-444444444444";

function item(overrides: Partial<ManagementReturnsAttentionItem> = {}): ManagementReturnsAttentionItem {
  return {
    id: `return:${RETURN_ID}`, category: "return", priority: "needs_attention", intervention: "required",
    organizationId: "org_a", locationId: "loc_a1", locationName: "Accra Store", registerId: "reg_a", registerName: "Counter A",
    returnId: RETURN_ID, saleId: "sale_a", persistedStatus: "requires_attention", statusLabel: "Return needs attention",
    summary: "This return needs review.", nextAction: "Review the existing return.",
    updatedAt: "2026-10-03T06:00:00.000Z", canApprove: false, canReconcile: false, canReview: true,
    amount: { minor: 999, currency: "GHS" },
    ...overrides,
  };
}

function detail(overrides: Partial<ManagementReturnDetailView> = {}): ManagementReturnDetailView {
  return {
    returnId: RETURN_ID, saleId: "sale_a", saleReference: "Order 123",
    locationId: "loc_a1", locationName: "Accra Store", registerId: "reg_a", registerName: "Counter A",
    persistedStatus: "requires_attention", statusLabel: "Return needs attention",
    refundTotal: { minor: 999, currency: "GHS" }, previewExpiresAt: "2026-10-02T06:00:00.000Z",
    executed: true, canApprove: false, namesAvailable: true,
    lines: [{ orderLineId: "line_a", name: "Original saved product", quantity: "1", reason: "Damaged packaging", condition: "damaged", intendedDisposition: "no_automatic_restock", allocatedAmount: { minor: 999, currency: "GHS" } }],
    effects: [
      { kind: "cash_refund", label: "Cash refund", effectId: "55555555-5555-4555-8555-555555555555", status: "verified", amount: { minor: 999, currency: "GHS" } },
      { kind: "stock_disposition", label: "Stock handling", effectId: "77777777-7777-4777-8777-777777777777", status: "requires_attention", message: "Remote stock record needs review." },
    ],
    ...overrides,
  };
}

async function installManagement(
  page: Page,
  options: {
    readonly rows?: readonly ManagementReturnsAttentionItem[];
    readonly detail?: ManagementReturnDetailView;
    readonly detailResponses?: readonly (ManagementReturnDetailView | "forbidden")[];
    readonly detailForbidden?: boolean;
    readonly controlRole?: "owner" | null;
    readonly managerLocationIds?: readonly string[];
  } = {},
) {
  const requests: Array<{ method: string; path: string }> = [];
  const detailReads: string[] = [];
  const approvals: Array<{ method: string; path: string; csrf: string | undefined; body: string | null }> = [];
  let approved = false;
  const data = (value: unknown) => JSON.stringify({ ok: true, data: value, correlationId: CORRELATION });
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/api/pos/v1/")) requests.push({ method: request.method(), path });
  });
  // Every API request is synthetic. Unrecognized operations are rejected so
  // this browser test cannot accidentally issue a real checkout/refund effect.
  await page.route("**/api/pos/v1/**", (route) => route.fulfill({
    status: 404, contentType: "application/json",
    body: JSON.stringify({ ok: false, correlationId: CORRELATION, error: { code: "NOT_FOUND", message: "Not part of this synthetic fixture.", retryable: false, nextAction: "none" } }),
  }));
  await page.context().addCookies([{ name: "cetech_pos_csrf", value: "return-test-csrf", url: "http://127.0.0.1:3000" }]);
  await page.route("**/api/pos/v1/session", (route) => route.fulfill({
    contentType: "application/json", body: data({
      session: { actorId: "manager_a", displayName: "Staging Manager", organizationId: "org_a", locationIds: ["loc_a1"], capabilities: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      assignedLocationIds: ["loc_a1"], assignedRegisterIds: ["reg_a"],
    }),
  }));
  await page.route("**/api/pos/v1/admin/context", (route) => route.fulfill({
    contentType: "application/json", body: data({
      actorId: "manager_a", displayName: "Staging Manager", organizationId: "org_a", controlRole: options.controlRole === undefined ? "owner" : options.controlRole,
      managerLocationIds: options.managerLocationIds ?? ["loc_a1"], locationRoles: (options.managerLocationIds ?? ["loc_a1"]).map((locationId) => ({ locationId, role: "manager" })),
      sections: ["overview", "returns_approvals"],
    }),
  }));
  await page.route("**/api/pos/v1/admin/topology", (route) => route.fulfill({ contentType: "application/json", body: data([]) }));
  await page.route("**/api/pos/v1/admin/returns-attention", (route) => route.fulfill({
    contentType: "application/json", body: data({
      scope: { kind: "organization" }, limit: 40, truncated: false,
      rows: (options.rows ?? [item()]).map((row) => approved && row.returnId === RETURN_ID
        ? { ...row, approvalState: "recorded", canApprove: false, nextAction: "The cashier can continue the same return." }
        : row),
    }),
  }));
  await page.route(/\/api\/pos\/v1\/admin\/returns\/[^/?]+$/, async (route) => {
    const request = route.request();
    detailReads.push(new URL(request.url()).pathname);
    const response = options.detailResponses?.[detailReads.length - 1] ?? options.detail ?? detail();
    if (options.detailForbidden || response === "forbidden" || request.method() !== "GET") {
      await route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, correlationId: CORRELATION, error: { code: "FORBIDDEN", message: "Return location is outside management authority.", retryable: false, nextAction: "none" } }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: data(response) });
  });
  await page.route(`**/api/pos/v1/admin/returns/${RETURN_ID}/approve`, async (route) => {
    const request = route.request();
    approvals.push({ method: request.method(), path: new URL(request.url()).pathname, csrf: request.headers()["x-csrf-token"], body: request.postData() });
    approved = true;
    await route.fulfill({ contentType: "application/json", body: data({ approvalId: "88888888-8888-4888-8888-888888888888", returnId: RETURN_ID, fingerprint: "0123456789abcdef0123456789abcdef", actorId: "manager_a", expiresAt: "2099-01-01T00:00:00.000Z" }) });
  });
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Returns & approvals", exact: true }).click();
  await expect(page.getByText("Counts are work items.", { exact: false })).toBeVisible();
  return { requests, detailReads, approvals };
}

test("expired return preview is history rather than a fake pending approval", async ({ page }) => {
  const harness = await installManagement(page, { rows: [item({
    persistedStatus: "previewed", priority: "informational", intervention: "informational",
    statusLabel: "Return preview expired", summary: "This saved preview is no longer valid.",
    previewState: "expired", previewExpiresAt: "2026-10-02T06:00:00.000Z",
    nextAction: "Review the original sale again in Returns if a return is still needed.",
    actionUnavailableReason: "This preview has expired and cannot be approved or completed. Review the original sale again in Returns.",
  })] });
  await expect(page.getByRole("heading", { name: "Return preview expired", exact: true })).toBeVisible();
  const summary = page.getByRole("list", { name: "Returns and refund summary" });
  await expect(summary.locator("li").filter({ hasText: "Pending" }).locator("strong")).toHaveText("0");
  await expect(summary.locator("li").filter({ hasText: "History" }).locator("strong")).toHaveText("1");
  await expect(page.getByRole("button", { name: "Approve return", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Review existing return", exact: true })).toBeVisible();
  expect(harness.approvals).toEqual([]);
});

test("review loads the exact saved return with pure GET and no commerce/recovery effects", async ({ page }) => {
  const harness = await installManagement(page);
  await page.getByRole("button", { name: "Review existing return", exact: true }).click();
  const saved = page.locator(`[data-return-detail="${RETURN_ID}"]`);
  await expect(saved.getByText("1 × Original saved product", { exact: true })).toBeVisible();
  await expect(saved.getByText("Cash refund · Completed", { exact: true })).toBeVisible();
  await expect(saved.getByText("Stock handling · Needs review", { exact: true })).toBeVisible();
  await expect(saved.getByText("Remote stock record needs review.", { exact: true })).toBeVisible();
  await expect(saved.getByText("Reviewing these saved records does not send a refund or change stock.", { exact: true })).toBeVisible();
  expect(harness.detailReads).toEqual([`/api/pos/v1/admin/returns/${RETURN_ID}`]);
  expect(harness.requests.every((request) => request.method === "GET")).toBe(true);
  expect(harness.requests.filter((request) => /\/api\/pos\/v1\/(?:returns|sales|payments)(?:\/|$)/.test(request.path))).toEqual([]);
  expect(harness.approvals).toEqual([]);
  await page.getByRole("button", { name: "Close return details", exact: true }).click();
  await expect(saved).toHaveCount(0);
});

test("a current approval-required return uses the existing scoped approval POST then refreshes", async ({ page }) => {
  const harness = await installManagement(page, { rows: [item({
    priority: "pending", persistedStatus: "approval_required", statusLabel: "Approval required",
    approvalState: "required", previewState: "current", previewExpiresAt: "2099-01-01T00:00:00.000Z", canApprove: true,
  })] });
  await page.getByRole("button", { name: "Approve return", exact: true }).click();
  await expect(page.getByText("Manager approval recorded. The cashier can continue the same return.", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve return", exact: true })).toHaveCount(0);
  expect(harness.approvals).toEqual([{ method: "POST", path: `/api/pos/v1/admin/returns/${RETURN_ID}/approve`, csrf: "return-test-csrf", body: null }]);
  expect(harness.requests.filter((request) => request.method !== "GET")).toEqual([{ method: "POST", path: `/api/pos/v1/admin/returns/${RETURN_ID}/approve` }]);
  expect(harness.requests.filter((request) => /\/api\/pos\/v1\/(?:returns|sales|payments)(?:\/|$)/.test(request.path))).toEqual([]);
});

test("organization owner can review an unmanaged location without gaining return approval", async ({ page }) => {
  const reason = "A Manager assignment at this location is required to approve this return. Organization access alone does not grant approval.";
  const harness = await installManagement(page, {
    managerLocationIds: ["loc_a1"],
    rows: [item({ locationId: "loc_a2", locationName: "Tema Store", priority: "pending", persistedStatus: "approval_required", statusLabel: "Approval required", approvalState: "required", previewState: "current", previewExpiresAt: "2099-01-01T00:00:00.000Z", actionUnavailableReason: reason })],
    detail: detail({ locationId: "loc_a2", locationName: "Tema Store", persistedStatus: "approval_required", statusLabel: "Approval required", executed: false, effects: [], canApprove: false, actionUnavailableReason: reason }),
  });
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve return", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Review existing return", exact: true }).click();
  await expect(page.locator(`[data-return-detail="${RETURN_ID}"]`).getByText(reason, { exact: true })).toBeVisible();
  expect(harness.approvals).toEqual([]);
});

test("a newly forbidden detail read reports the scope denial and exposes no saved details", async ({ page }) => {
  const harness = await installManagement(page, { controlRole: null, detailForbidden: true });
  await page.getByRole("button", { name: "Review existing return", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Return location is outside management authority." })).toBeVisible();
  await expect(page.locator("[data-return-detail]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve return", exact: true })).toHaveCount(0);
  expect(harness.approvals).toEqual([]);
  expect(harness.requests.every((request) => request.method === "GET")).toBe(true);
});

test("a mismatched saved return response fails closed instead of displaying another return", async ({ page }) => {
  const harness = await installManagement(page, { detail: detail({ returnId: OTHER_RETURN, saleReference: "Other saved return" }) });
  await page.getByRole("button", { name: "Review existing return", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "saved return reference did not match" })).toBeVisible();
  await expect(page.locator("[data-return-detail]")).toHaveCount(0);
  await expect(page.getByText("Other saved return", { exact: true })).toHaveCount(0);
  expect(harness.approvals).toEqual([]);
});

for (const failedRefresh of ["forbidden", "mismatched"] as const) {
  test(`a later ${failedRefresh} detail refresh clears saved approval capability`, async ({ page }) => {
    const current = detail({ persistedStatus: "approval_required", statusLabel: "Approval required", executed: false, effects: [], canApprove: true, previewState: "current", previewExpiresAt: "2099-01-01T00:00:00.000Z" });
    const harness = await installManagement(page, {
      rows: [item({ priority: "pending", persistedStatus: "approval_required", statusLabel: "Approval required", approvalState: "required", previewState: "current", previewExpiresAt: "2099-01-01T00:00:00.000Z", canApprove: true })],
      detailResponses: [current, failedRefresh === "forbidden" ? "forbidden" : detail({ ...current, returnId: OTHER_RETURN })],
    });
    await page.getByRole("button", { name: "Review existing return", exact: true }).click();
    await expect(page.locator(`[data-return-detail="${RETURN_ID}"]`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve return", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Refresh return details", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: failedRefresh === "forbidden" ? "outside management authority" : "saved return reference did not match" })).toBeVisible();
    await expect(page.locator("[data-return-detail]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Approve return", exact: true })).toHaveCount(0);
    expect(harness.detailReads).toHaveLength(2);
    expect(harness.approvals).toEqual([]);
    if (failedRefresh === "forbidden") {
      await expect.poll(() => harness.requests.filter((request) => request.path === "/api/pos/v1/admin/returns-attention").length).toBeGreaterThanOrEqual(2);
    }
  });
}

test("a saved-return read completing after navigation cannot reopen old details", async ({ page }) => {
  const harness = await installManagement(page);
  let releaseRead: (() => void) | undefined;
  const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
  await page.route(`**/api/pos/v1/admin/returns/${RETURN_ID}`, async (route) => {
    await readGate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: CORRELATION, data: detail() }) });
  });
  const completedRead = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/pos/v1/admin/returns/${RETURN_ID}`);
  await page.getByRole("button", { name: "Review existing return", exact: true }).click();
  await expect(page.getByRole("button", { name: "Loading saved return…", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  releaseRead?.();
  await completedRead;
  await page.getByRole("button", { name: "Returns & approvals", exact: true }).click();
  await expect(page.getByRole("button", { name: "Review existing return", exact: true })).toBeVisible();
  await expect(page.locator("[data-return-detail]")).toHaveCount(0);
  expect(harness.approvals).toEqual([]);
  expect(harness.requests.every((request) => request.method === "GET")).toBe(true);
});
