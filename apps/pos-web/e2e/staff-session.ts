import { expect, type Page } from "@playwright/test";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = {
  actorId: "cashier_a",
  displayName: "Cashier A",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
  capabilities: ["ui.hint.only"],
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const REGISTER = {
  id: "reg_a",
  name: "Front Counter",
  locationId: "loc_a1",
  currency: "GHS",
  status: "active",
};
const OPEN_SHIFT = {
  id: "s1111111-1111-4111-8111-111111111111",
  registerId: "reg_a",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  cashierId: "cashier_a",
  status: "open",
  openingFloat: { minor: 50000, currency: "GHS" },
  openedAt: "2026-09-17T08:00:00.000Z",
};

export type StaffSessionHarness = {
  readonly sessionGets: () => number;
  readonly catalogSyncs: () => number;
};

export async function installAuthoritativeStaffSession(
  page: Page,
  options: { readonly shiftOpen?: boolean } = {},
): Promise<StaffSessionHarness> {
  const shiftOpen = options.shiftOpen ?? true;
  let sessionGets = 0;
  let catalogSyncs = 0;
  // The authenticated fixture must give its inbox the same authority as session.
  // Recovery-specific tests can override this with an actual expired-session result.
  await page.route("**/api/pos/v1/attention", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, correlationId: CORRELATION, data: { items: [] } }),
    });
  });
  await page.route("**/api/pos/v1/catalog/sync**", async (route) => {
    catalogSyncs += 1;
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: {
          code: "AUTH_REQUIRED",
          message: "staff session is required",
          retryable: false,
          nextAction: "reauthenticate",
        },
        correlationId: CORRELATION,
      }),
    });
  });
  await page.route("**/api/pos/v1/health", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: {
          checks: [
            {
              id: "pos-bff",
              status: "healthy",
              message: "e2e health probe",
              checkedAt: "2026-09-17T12:00:00.000Z",
            },
          ],
          contractVersion: "1.0.0",
          pendingOperationCount: 0,
          attentionCount: 0,
          buildId: "e2e",
        },
      }),
    });
  });
  await page.route("**/api/pos/v1/session", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      sessionGets += 1;
    }
    if (method === "GET" || method === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          correlationId: CORRELATION,
          data: {
            session: SESSION,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a"],
          },
        }),
      });
      return;
    }
    if (method === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          correlationId: CORRELATION,
          data: { signedOut: true, localWorkPreserved: true },
        }),
      });
      return;
    }
    await route.continue();
  });
  await page.route("**/api/pos/v1/registers/reg_a/devices", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", label: "Counter tablet" }],
      }),
    });
  });
  await page.route("**/api/pos/v1/registers/reg_a", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, correlationId: CORRELATION, data: REGISTER }),
    });
  });
  await page.route("**/api/pos/v1/registers/reg_a/active-shift", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: shiftOpen ? OPEN_SHIFT : null,
      }),
    });
  });
  return {
    sessionGets: () => sessionGets,
    catalogSyncs: () => catalogSyncs,
  };
}

export async function expectAuthoritativeShell(page: Page, options: { readonly shiftOpen?: boolean } = {}): Promise<void> {
  const topbar = page.getByRole("banner");
  await expect(topbar.getByText("Cashier A")).toBeVisible();
  await expect(page.getByText("Staff member")).toHaveCount(0);
  if (options.shiftOpen === false) {
    await expect(topbar.getByText("No open shift")).toBeVisible();
    await expect(topbar.getByText("Shift open")).toHaveCount(0);
  } else {
    await expect(topbar.getByText("Shift open")).toBeVisible();
  }
}
