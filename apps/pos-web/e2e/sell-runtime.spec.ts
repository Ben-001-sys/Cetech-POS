import { expect, test, type Page } from "@playwright/test";
import { expectAuthoritativeShell, installAuthoritativeStaffSession } from "./staff-session";

test("staff-context refresh does not restart an unchanged cart's pending price", async ({ page }) => {
  let quoteRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/pos/v1/quotes", async (route) => {
    quoteRequests += 1;
    const posted = route.request().postDataJSON();
    await gate;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      ok: true, correlationId: route.request().headers()["x-correlation-id"], data: quotePayload(posted, "fp-a", 1500),
    }) });
  });
  await installAuthoritativeStaffSession(page);
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await scanHardener(page);
  await expect(page.locator("[data-quote-status='quoting']")).toBeVisible();
  await expect.poll(() => quoteRequests).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(async () => Number(await page.locator("[data-sell-restore-count]").getAttribute("data-sell-restore-count"))).toBeGreaterThan(1);
  expect(quoteRequests).toBe(1);
  release();
  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible();
  await expect(page.locator(".cart-totals")).toContainText("GHS 15.00");
  await expect(page.getByRole("button", { name: "Pay GHS 15.00" })).toBeEnabled();
});

test("failed pricing can be retried while retaining the same cart and quantity", async ({ page }) => {
  const postedRequests: Array<{ cartId: string; cartRevision: number; lines: Array<{ quantity: string }> }> = [];
  await page.route("**/api/pos/v1/quotes", async (route) => {
    const posted = route.request().postDataJSON();
    postedRequests.push(posted);
    const correlationId = route.request().headers()["x-correlation-id"];
    await route.fulfill({ status: postedRequests.length === 1 ? 503 : 200, contentType: "application/json", body: JSON.stringify(
      postedRequests.length === 1
        ? { ok: false, correlationId, error: { code: "INTEGRATION_UNAVAILABLE", message: "Price check took too long.", retryable: true, nextAction: "retry_same_key" } }
        : { ok: true, correlationId, data: quotePayload(posted, "fp-a", 1500) },
    ) });
  });
  await installAuthoritativeStaffSession(page);
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await scanHardener(page);
  await expect(page.locator("[data-quote-status='failed']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Check price again" }).click();
  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible();
  expect(postedRequests).toHaveLength(2);
  expect(postedRequests[1]).toEqual(postedRequests[0]);
  await expect(page.getByRole("complementary", { name: "Current sale" }).locator(".qty-input")).toHaveValue("1");
});

test("Sell runtime restores workspace once and cart edits do not restore again", async ({ page }) => {
  await installAuthoritativeStaffSession(page);
  await page.goto("/sell");
  await expectAuthoritativeShell(page);
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("[data-sell-restore-count]")).toHaveAttribute("data-sell-restore-count", "1");
  await expect(page.getByText("Loading catalog…")).toHaveCount(0);
  await expect(page.getByText("Loading products…")).toHaveCount(0);

  await page.locator("#product-search").fill("0012345678901");
  await page.locator("#product-search").press("Enter");
  const cart = page.getByRole("complementary", { name: "Current sale" });
  await expect(cart.getByText("Epoxy Hardener 1L")).toBeVisible();
  const qty = cart.locator(".qty-input");
  await expect(qty).toHaveValue("1");

  await page.getByRole("button", { name: "Increase quantity" }).click();
  await expect(qty).toHaveValue("2");
  await expect.poll(async () => page.locator("[data-sell-restore-count]").getAttribute("data-sell-restore-count"), {
    timeout: 3_000,
  }).toBe("1");
  await expect(qty).toHaveValue("2");
  await expect(page.locator("#product-search")).toBeVisible();
  await expect(page.getByText("Loading catalog…")).toHaveCount(0);
  await expect(page.getByText("Loading products…")).toHaveCount(0);

  await page.reload();
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("complementary", { name: "Current sale" }).locator(".qty-input")).toHaveValue("2");
  await expect(page.locator("[data-sell-restore-count]")).toHaveAttribute("data-sell-restore-count", "1");
});


test("Sell picker debounces remote-only customer search and binds wholesale context", async ({ page }) => {
  const remoteQueries: string[] = [];
  await page.route("**/api/pos/v1/customers**", async (route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") ?? "";
    if (query) remoteQueries.push(query);
    const items = query.toLowerCase() === "arden"
      ? [{
          id: "remote-arden",
          kind: "b2b",
          displayName: "Arden Studio",
          company: "Arden Studio Ltd",
          phoneMasked: "024 *** 7788",
          commercialContext: "Trade account",
        }]
      : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        data: { items },
      }),
    });
  });

  await installAuthoritativeStaffSession(page);
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });

  const localHasArden = await page.evaluate(async () => {
    return new Promise<boolean>((resolve, reject) => {
      const open = indexedDB.open("cetech-pos-local");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("customers", "readonly");
        const request = tx.objectStore("customers").get("remote-arden");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          resolve(Boolean(request.result));
          db.close();
        };
      };
    });
  });
  expect(localHasArden).toBe(false);

  await page.locator(".customer-chip").click();
  const customerSearch = page.locator("#customer-search");
  await customerSearch.pressSequentially("arden", { delay: 30 });

  await expect(page.getByText("Arden Studio", { exact: true })).toBeVisible({ timeout: 5_000 });
  expect(remoteQueries).toEqual(["arden"]);
  await expect(page.getByText("Wholesale", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Arden Studio/ }).click();
  await expect(page.locator(".customer-chip")).toContainText("Arden Studio");
  await expect(page.locator(".customer-chip")).toContainText("Wholesale");
});

test("same-revision quote revalidation reaches changed and blocks checkout", async ({ page }) => {
  const quoteControl = { fingerprint: "fp-a", delayMs: 0 };
  await page.route("**/api/pos/v1/quotes", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const posted = route.request().postDataJSON() as {
      cartId: string;
      cartRevision: number;
      customer: { kind: "walkin" | "retail" | "b2b"; customerId?: string };
      locationId: string;
      lines: Array<{ lineId: string; productId: string; quantity: string; variationId?: string }>;
    };
    if (quoteControl.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, quoteControl.delayMs));
    }
    const total = quoteControl.fingerprint === "fp-a" ? 1500 : 1800;
    const correlationId = route.request().headers()["x-correlation-id"] ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId,
        data: quotePayload(posted, quoteControl.fingerprint, total),
      }),
    });
  });

  await installAuthoritativeStaffSession(page);
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await page.locator("#product-search").fill("0012345678901");
  await page.locator("#product-search").press("Enter");
  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cart-totals")).toContainText("GHS 15.00");

  await page.context().setOffline(true);
  await expect(page.locator("[data-quote-status='offline']")).toBeVisible();
  await expect(page.locator("[data-eligibility-allowed='false']")).toBeVisible();
  await expect(page.locator("[data-eligibility-reason='CONNECTION_REQUIRED']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();

  quoteControl.fingerprint = "fp-b";
  quoteControl.delayMs = 800;
  await page.context().setOffline(false);
  await expect(page.locator("[data-quote-status='quoting']")).toBeVisible();
  await expect(page.locator("[data-eligibility-allowed='false']")).toBeVisible();
  await expect(page.locator("[data-eligibility-reason='QUOTE_REQUIRED']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();

  await expect(page.locator("[data-quote-status='changed']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-quote-status='changed']")).toContainText("Previous total");
  await expect(page.locator("[data-quote-status='changed']")).toContainText("GHS 15.00");
  await expect(page.locator("[data-quote-status='changed']")).toContainText("New total");
  await expect(page.locator("[data-quote-status='changed']")).toContainText("GHS 18.00");
  await expect(page.locator("[data-eligibility-allowed='false']")).toBeVisible();
  await expect(page.locator("[data-eligibility-reason='QUOTE_REQUIRED']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();
});

test("New Sale Cart B quote is accepted even when Cart A had a higher revision", async ({ page }) => {
  await installIdentityQuotes(page, { delayNewCartMs: 800 });
  await installAuthoritativeStaffSession(page);
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await scanHardener(page);
  const cart = page.getByRole("complementary", { name: "Current sale" });
  await expect(cart.getByText("Epoxy Hardener 1L")).toBeVisible();
  for (let step = 0; step < 3; step += 1) {
    await page.getByRole("button", { name: "Increase quantity" }).click();
  }
  await expect(cart.locator(".qty-input")).toHaveValue("4");
  await expect(cart).toHaveAttribute("data-cart-revision", "4");
  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cart-totals")).toContainText("GHS 40.00");

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Clear sale" }).click();
  await expect(cart.getByText("Your cart is empty")).toBeVisible();
  await expect(cart).toHaveAttribute("data-cart-revision", "0");
  await expect(page.locator("[data-quote-status='confirmed']")).toHaveCount(0);
  await expect(page.locator("[data-quote-status='changed']")).toHaveCount(0);
  await expect(page.getByText("GHS 40.00")).toHaveCount(0);

  await scanHardener(page);
  await expect(cart.getByText("Epoxy Hardener 1L")).toBeVisible();
  await expect(cart).toHaveAttribute("data-cart-revision", "1");
  await expect(page.locator("[data-quote-status='quoting']")).toBeVisible();
  await expect(page.getByText("GHS 40.00")).toHaveCount(0);
  await expect(page.locator("[data-eligibility-allowed='false']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();

  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cart-totals")).toContainText("GHS 15.00");
  await expect(page.getByText("GHS 40.00")).toHaveCount(0);
  await expect(page.locator("[data-quote-status='changed']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pay" })).toBeEnabled();
});

test("equal revision across New Sale cannot reuse Cart A quote while Cart B is quoting", async ({ page }) => {
  await installIdentityQuotes(page, { delayNewCartMs: 800 });
  await installAuthoritativeStaffSession(page);
  await page.goto("/sell");
  await expect(page.locator("#product-search")).toBeVisible({ timeout: 30_000 });
  await scanHardener(page);
  const cart = page.getByRole("complementary", { name: "Current sale" });
  await expect(cart.getByText("Epoxy Hardener 1L")).toBeVisible();
  await expect(cart).toHaveAttribute("data-cart-revision", "1");
  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cart-totals")).toContainText("GHS 40.00");

  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Clear sale" }).click();
  await expect(cart.getByText("Your cart is empty")).toBeVisible();
  await expect(page.getByText("GHS 40.00")).toHaveCount(0);

  await scanHardener(page);
  await expect(cart.getByText("Epoxy Hardener 1L")).toBeVisible();
  await expect(cart).toHaveAttribute("data-cart-revision", "1");
  await expect(page.locator("[data-quote-status='quoting']")).toBeVisible();
  await expect(page.getByText("GHS 40.00")).toHaveCount(0);
  await expect(page.locator("[data-eligibility-allowed='false']")).toBeVisible();
  await expect(page.locator("[data-eligibility-reason='QUOTE_REQUIRED']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pay" })).toBeDisabled();

  await expect(page.locator("[data-quote-status='confirmed']")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".cart-totals")).toContainText("GHS 15.00");
  await expect(page.getByText("GHS 40.00")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pay" })).toBeEnabled();
});

function quotePayload(
  request: {
    cartId: string;
    cartRevision: number;
    customer: { kind: "walkin" | "retail" | "b2b"; customerId?: string };
    locationId: string;
    lines: Array<{ lineId: string; productId: string; quantity: string; variationId?: string }>;
  },
  fingerprint: string,
  totalMinor: number,
) {
  const money = { minor: totalMinor, currency: "GHS" };
  return {
    id: quoteIdFor(fingerprint),
    fingerprint,
    cartId: request.cartId,
    cartRevision: request.cartRevision,
    customer: request.customer,
    locationId: request.locationId,
    currency: "GHS",
    lines: request.lines.map((line) => ({
      lineId: line.lineId,
      productId: line.productId,
      variationId: line.variationId,
      quantity: line.quantity,
      unitPrice: money,
      subtotal: money,
      discount: { minor: 0, currency: "GHS" },
      tax: { minor: 0, currency: "GHS" },
      total: money,
      stockStatus: "in_stock",
      purchasable: true,
      problems: [],
    })),
    subtotal: money,
    discount: { minor: 0, currency: "GHS" },
    tax: { minor: 0, currency: "GHS" },
    total: money,
    calculatedAt: "2026-09-13T20:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    purchasable: true,
  };
}

async function scanHardener(page: Page): Promise<void> {
  await page.locator("#product-search").fill("0012345678901");
  await page.locator("#product-search").press("Enter");
}

async function installIdentityQuotes(page: Page, options: { delayNewCartMs?: number } = {}): Promise<void> {
  const seenCarts: string[] = [];
  await page.route("**/api/pos/v1/quotes", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const posted = route.request().postDataJSON() as {
      cartId: string;
      cartRevision: number;
      customer: { kind: "walkin" | "retail" | "b2b"; customerId?: string };
      locationId: string;
      lines: Array<{ lineId: string; productId: string; quantity: string; variationId?: string }>;
    };
    if (!seenCarts.includes(posted.cartId)) {
      seenCarts.push(posted.cartId);
    }
    const cartIndex = seenCarts.indexOf(posted.cartId);
    if (cartIndex > 0 && options.delayNewCartMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayNewCartMs));
    }
    const fingerprint = cartIndex === 0 ? "fp-cart-a" : "fp-cart-b";
    const total = cartIndex === 0 ? 4000 : 1500;
    const correlationId = route.request().headers()["x-correlation-id"] ?? "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        correlationId,
        data: quotePayload(posted, fingerprint, total),
      }),
    });
  });
}

function quoteIdFor(fingerprint: string): string {
  switch (fingerprint) {
    case "fp-a":
      return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    case "fp-b":
      return "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    case "fp-cart-a":
      return "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    default:
      return "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  }
}
