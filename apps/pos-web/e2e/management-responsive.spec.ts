import { expect, test, type Page } from "@playwright/test";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ALL_SECTIONS = [
  "overview",
  "staff_access",
  "locations",
  "registers",
  "devices",
  "shifts_cash",
  "returns_approvals",
  "system_health",
  "audit",
  "policies",
  "receipt_settings",
] as const;

async function installManagementMocks(page: Page) {
  await page.route("**/api/pos/v1/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: {
          session: {
            actorId: "owner_a",
            displayName: "Ama Mensah — Store Owner",
            organizationId: "org_a",
            locationIds: ["loc_a1"],
            capabilities: [],
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
          assignedLocationIds: ["loc_a1"],
          assignedRegisterIds: ["reg_a", "reg_a2"],
        },
      }),
    });
  });
  await page.route("**/api/pos/v1/admin/context", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: {
          actorId: "owner_a",
          displayName: "Ama Mensah — Store Owner",
          organizationId: "org_a",
          controlRole: "owner",
          managerLocationIds: ["loc_a1"],
          locationRoles: [{ locationId: "loc_a1", role: "manager" }],
          sections: ALL_SECTIONS,
        },
      }),
    });
  });
  await page.route("**/api/pos/v1/admin/staff", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: [{
          actorId: "cashier_a",
          displayName: "Kwame Asante — Main Counter Cashier",
          email: "cashier@example.test",
          authStatus: "active",
          posAccessStatus: "active",
          controlRole: null,
          locations: [{
            locationId: "loc_a1",
            role: "cashier",
            registerIds: ["reg_a"],
          }],
        }],
      }),
    });
  });
  await page.route("**/api/pos/v1/admin/topology", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: [{
          id: "loc_a1",
          name: "Accra Main Store and Service Counter — North Ridge Industrial",
          registers: [
            { id: "reg_a", name: "Front Register A — Express Lane", currency: "GHS", status: "active" },
            { id: "reg_a2", name: "Customer Service Register", currency: "GHS", status: "active" },
          ],
          devices: [{ id: "device_a", label: "Counter tablet 1", status: "active" }],
        }],
      }),
    });
  });
  await page.route("**/api/pos/v1/admin/policy**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: {
          scope: { organizationId: "org_a" },
          effective: {
            cashierCanCloseShift: false,
            managerCanCloseShift: true,
            cashierOwnShiftOnly: true,
            managerCanCloseOthersShift: true,
            nonZeroVarianceRequiresManager: true,
            varianceToleranceMinor: 100,
            varianceCurrency: "GHS",
            returnApprovalRequired: true,
          },
          canManage: true,
        },
      }),
    });
  });
}

async function expectNoHorizontalPageOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test.describe("ADMIN-105 Management responsiveness and operator language", () => {
  test("desktop Staff & access uses the intended management layout", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installManagementMocks(page);
    await page.goto("/management");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 15_000 });
    await page.locator(".management-nav").getByRole("button", { name: "Staff & access", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Staff & access" })).toBeVisible();
    await expect(page.getByText("Account active")).toBeVisible();
    await expect(page.getByText("POS access active")).toBeVisible();
    await expect(page.locator(".management-control-role .label").filter({ hasText: "Organization role" }).first()).toBeVisible();
    await expect(page.getByText("Location and register assignments")).toBeVisible();

    expect(await page.locator(".management-staff-head").first().evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    expect(await page.locator(".management-meta-grid").first().evaluate((el) => getComputedStyle(el).display)).toBe("grid");
    await expect(page.getByText("Management control plane")).toHaveCount(0);
    await expect(page.getByText("Operational assignments")).toHaveCount(0);
    await expectNoHorizontalPageOverflow(page);
  });

  test("tablet Management uses compact horizontal navigation and styled operational rules", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await installManagementMocks(page);
    await page.goto("/management");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 15_000 });

    const nav = page.locator(".management-nav");
    await expect(nav).toBeVisible();
    expect(await nav.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
    const firstNav = nav.getByRole("button").first();
    const firstBox = await firstNav.boundingBox();
    expect(firstBox).toBeTruthy();
    expect(firstBox!.height).toBeGreaterThanOrEqual(44);

    await nav.getByRole("button", { name: "Operational rules", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Shift closing" })).toBeVisible();
    await expect(page.getByText("Cash difference requires manager review")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save operational rules" })).toBeVisible();
    expect(await page.locator(".management-policy-row").first().evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    await expectNoHorizontalPageOverflow(page);
  });

  test("phone Management keeps navigation compact, touchable and horizontally scrollable", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installManagementMocks(page);
    await page.goto("/management");
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible({ timeout: 15_000 });

    await expect(page.locator(".management-brand")).toBeHidden();
    const sidebar = page.locator(".management-sidebar");
    const sidebarBox = await sidebar.boundingBox();
    expect(sidebarBox).toBeTruthy();
    expect(sidebarBox!.height).toBeLessThan(80);

    const nav = page.locator(".management-nav");
    const navMetrics = await nav.evaluate((el) => ({
      overflowX: getComputedStyle(el).overflowX,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(navMetrics.overflowX).toBe("auto");
    expect(navMetrics.scrollWidth).toBeGreaterThan(navMetrics.clientWidth);

    const firstNav = nav.getByRole("button").first();
    const firstBox = await firstNav.boundingBox();
    expect(firstBox).toBeTruthy();
    expect(firstBox!.height).toBeGreaterThanOrEqual(44);

    await page.locator(".management-nav").getByRole("button", { name: "Staff & access", exact: true }).click();
    await expect(page.getByText("Kwame Asante — Main Counter Cashier")).toBeVisible();
    await expect(page.getByText("Staff ID cashier_a")).toBeHidden();
    await expect(page.getByText("Location and register assignments")).toBeVisible();
    await expectNoHorizontalPageOverflow(page);
  });
});
