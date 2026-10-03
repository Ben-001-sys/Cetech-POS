import { expect, test, type Page } from "@playwright/test";
import { installAuthoritativeStaffSession } from "./staff-session";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
] as const;

async function expectNoOverflow(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
  }));
  expect(widths.page, "The cashier must not pan the page horizontally").toBeLessThanOrEqual(widths.viewport + 1);
}

async function expectInViewport(page: Page, selector: string): Promise<void> {
  const control = page.locator(selector);
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  expect(box!.height, "Primary actions remain comfortable touch targets").toBeGreaterThanOrEqual(44);
}

async function installQuotes(page: Page): Promise<void> {
  await page.route("**/api/pos/v1/quotes", async (route) => {
    const posted = route.request().postDataJSON() as {
      cartId: string;
      cartRevision: number;
      customer: { kind: string };
      locationId: string;
      lines: Array<{ lineId: string; productId: string; quantity: string; variationId?: string }>;
    };
    const lines = posted.lines.map((line) => {
      const total = { minor: Math.round(Number(line.quantity) * 15500), currency: "GHS" };
      return {
        ...line,
        unitPrice: { minor: 15500, currency: "GHS" },
        subtotal: total,
        discount: { minor: 0, currency: "GHS" },
        tax: { minor: 0, currency: "GHS" },
        total,
        stockStatus: "in_stock",
        purchasable: true,
        problems: [],
      };
    });
    const total = { minor: lines.reduce((sum, line) => sum + line.total.minor, 0), currency: "GHS" };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: {
          id: CORRELATION,
          fingerprint: `fp-ui-refinement-${posted.cartRevision}`,
          cartId: posted.cartId,
          cartRevision: posted.cartRevision,
          customer: posted.customer,
          locationId: posted.locationId,
          currency: "GHS",
          lines,
          subtotal: total,
          discount: { minor: 0, currency: "GHS" },
          tax: { minor: 0, currency: "GHS" },
          total,
          calculatedAt: "2026-10-03T01:39:00.000Z",
          expiresAt: "2099-01-01T00:00:00.000Z",
          purchasable: true,
        },
      }),
    });
  });
}

async function loadSale(page: Page): Promise<void> {
  await installAuthoritativeStaffSession(page);
  await installQuotes(page);
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await page.locator("#product-search").fill("0012345678901");
  await page.locator("#product-search").press("Enter");
  await expect(page.locator("[data-quote-status='confirmed']")).toBeAttached({ timeout: 15_000 });
}

test.describe("UI-REF-20261003 cashier refinement", () => {
  for (const appearance of ["light", "dark"] as const) {
    test(`${appearance} Sell keeps products and checkout usable at desktop, tablet and small-phone widths`, async ({ page }, testInfo) => {
      await page.emulateMedia({ colorScheme: appearance });
      await page.addInitScript((theme) => localStorage.setItem("cetech-pos-appearance", theme), appearance);
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize(VIEWPORTS[0]);
      await loadSale(page);
      await page.locator("#product-search").fill("");
      await expect.poll(() => page.locator(".product-card").count()).toBeGreaterThan(1);

      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await expect(page.locator("#product-search")).toBeVisible();
        await expectNoOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`sell-${appearance}-${viewport.width}.png`) });

        if (viewport.width <= 768) {
          await expectInViewport(page, ".mobile-cart-bar");
          await page.locator(".mobile-cart-bar").getByRole("button").click();
          await expect(page.locator(".cart-panel.mobile-open")).toBeVisible();
        }

        await expect(page.locator(".cart-totals")).toContainText("GHS 155.00");
        await expectInViewport(page, ".cart-panel .pay-btn");
        await expect(page.locator(".cart-panel .pay-btn")).toBeEnabled();
        await expectNoOverflow(page);
        await page.screenshot({ path: testInfo.outputPath(`cart-${appearance}-${viewport.width}.png`) });

        if (viewport.width <= 768) {
          await page.locator(".cart-panel .cart-back").click();
        }
      }
      expect(errors).toEqual([]);
      await expect(page.locator("[data-nextjs-dialog], .vite-error-overlay")).toHaveCount(0);
    });
  }

  test("keyboard modal navigation preserves the cart and restores scanning focus", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await loadSale(page);
    await page.locator(".cart-panel .cart-clear").click();
    const dialog = page.getByRole("dialog", { name: "Clear this sale?" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Tab");
    await expect.poll(() => dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Clear sale", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Clear sale", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".cart-line")).toHaveCount(1);
    await page.keyboard.press("F2");
    await expect(page.locator("#product-search")).toBeFocused();
    const focusStyle = await page.locator("#product-search").evaluate((el) => ({
      outline: getComputedStyle(el).outlineStyle,
      shadow: getComputedStyle(el).boxShadow,
    }));
    expect(focusStyle.outline !== "none" || focusStyle.shadow !== "none").toBe(true);
  });

  test("product view preferences change after hydration and survive reload", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loadSale(page);
    const view = page.getByRole("group", { name: "Product view" });
    await view.getByRole("button", { name: "List", exact: true }).click();
    await expect(view.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".product-results")).toHaveClass(/product-view-list/);
    await page.getByRole("button", { name: "Compact", exact: true }).click();
    await expect(page.locator(".product-results")).toHaveClass(/product-density-compact/);
    await expectNoOverflow(page);
    await page.reload();
    await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Compact", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Grid", exact: true }).click();
    await expect(page.locator(".product-results")).toHaveClass(/product-view-grid/);
    await expectNoOverflow(page);
    await expect(page.locator("button.nav-btn[data-route='settings']")).toHaveCount(1);
  });

  test("small-phone sign-in keeps password reveal accessible without submitting credentials", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.route("**/api/pos/v1/session", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          correlationId: CORRELATION,
          error: { code: "AUTH_REQUIRED", message: "staff session is required", retryable: false, nextAction: "reauthenticate" },
        }),
      });
    });
    await page.goto("/sell");
    const password = page.getByLabel("Password", { exact: true });
    await expect(password).toBeVisible({ timeout: 30_000 });
    await password.fill("synthetic-visibility-check");
    await expect(password).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Show password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide password", exact: true }).click();
    await expect(password).toHaveAttribute("type", "password");
    await expectNoOverflow(page);
    await expectInViewport(page, ".auth-password-toggle");
    await page.screenshot({ path: testInfo.outputPath("login-320.png") });
  });

  test("Orders loading skeleton remains announced and resolves without hiding navigation", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installAuthoritativeStaffSession(page);
    let finishRequest!: () => void;
    const pending = new Promise<void>((resolve) => { finishRequest = resolve; });
    await page.route("**/api/pos/v1/orders", async (route) => {
      await pending;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, correlationId: CORRELATION, data: { items: [] } }),
      });
    });
    await page.goto("/orders");
    const loading = page.getByRole("status").filter({ hasText: "Loading orders" });
    try {
      await expect(loading).toBeVisible({ timeout: 30_000 });
      await expect(loading).toHaveAttribute("aria-live", "polite");
      await expect(loading).not.toHaveAttribute("aria-busy", "true");
      await expect(loading.locator("[aria-hidden='true']")).toBeAttached();
      await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
      await expectNoOverflow(page);
      await page.screenshot({ path: testInfo.outputPath("orders-loading-390-reduced-motion.png") });
    } finally {
      finishRequest();
    }
    await expect(page.getByText("No sales available.", { exact: true })).toBeVisible();
    await expect(loading).toHaveCount(0);
    await expectNoOverflow(page);
  });

  test("small-phone header keeps important attention visible and opens its existing route", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await installAuthoritativeStaffSession(page);
    await page.route("**/api/pos/v1/attention", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          correlationId: CORRELATION,
          data: {
            count: 1,
            items: [{
              id: "ui-refinement-existing-payment",
              title: "Payment needs review",
              summary: "Do not charge again. Ask a manager to review the existing payment.",
              typeLabel: "Payment",
              severity: "critical",
              blocksCheckout: false,
              reviewAllowed: true,
            }],
          },
        }),
      });
    });
    await page.goto("/sell");
    await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("banner").getByRole("button", { name: "Needs attention 1", exact: true })).toBeVisible();
    await expectInViewport(page, ".mobile-attention");
    await expectNoOverflow(page);
    await page.screenshot({ path: testInfo.outputPath("sell-important-attention-320.png") });
    await page.locator(".mobile-attention").click();
    await expect(page.getByRole("heading", { name: "Needs attention", exact: true })).toBeVisible();
    await expect(page.getByText("Payment needs review", { exact: true })).toBeVisible();
    await expect(page.getByText("Do not charge again. Ask a manager to review the existing payment.", { exact: true })).toBeVisible();
    await expect(page.locator("button.nav-btn[data-route='settings']")).toHaveCount(1);
    await expectNoOverflow(page);
  });

  test("customer confirmation stays in the screen flow above product search", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installAuthoritativeStaffSession(page);
    await page.route("**/api/pos/v1/customers**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          correlationId: CORRELATION,
          data: { items: [{ id: "customer-ui-refinement", displayName: "UI Test Customer", kind: "retail" }] },
        }),
      });
    });
    await page.goto("/customers");
    await page.getByRole("button", { name: "Use for next sale", exact: true }).click({ timeout: 30_000 });
    const toast = page.locator("[data-app-toast='true']");
    await expect(toast).toContainText("Customer selected for next sale.");
    await expect(page.locator("#product-search")).toBeVisible();
    const [headerBox, toastBox, searchBox] = await Promise.all([
      page.getByRole("banner").boundingBox(), toast.boundingBox(), page.locator("#product-search").boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(toastBox).not.toBeNull();
    expect(searchBox).not.toBeNull();
    expect(toastBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);
    expect(searchBox!.y).toBeGreaterThanOrEqual(toastBox!.y + toastBox!.height - 1);
    await expectNoOverflow(page);
  });
});
