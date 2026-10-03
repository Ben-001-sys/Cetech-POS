import { expect, test, type Page } from "@playwright/test";
import type { ReceiptSettings } from "../../../docs/contracts/domain.generated";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fWQAAAAASUVORK5CYII=";

async function installReceiptManagement(page: Page, canManage = true) {
  let settings: ReceiptSettings = { shortenProductNames: false, productNameMaxCharacters: 40, showSku: false };
  const saves: ReceiptSettings[] = [];
  const commerce: string[] = [];
  page.on("request", (request) => {
    if (/\/api\/pos\/v1\/(?:sales|payments|returns)(?:\/|$)/.test(request.url())) commerce.push(request.url());
  });
  const data = (value: unknown) => JSON.stringify({ ok: true, data: value, correlationId: CORRELATION });
  await page.route("**/api/pos/v1/session", (route) => route.fulfill({
    contentType: "application/json", body: data({
      session: { actorId: "receipt_owner", displayName: "Receipt Tester", organizationId: "org_a", locationIds: ["loc_a1"], capabilities: [], expiresAt: "2099-01-01T00:00:00.000Z" },
      assignedLocationIds: ["loc_a1"], assignedRegisterIds: ["reg_a"],
    }),
  }));
  await page.route("**/api/pos/v1/admin/context", (route) => route.fulfill({
    contentType: "application/json", body: data({
      actorId: "receipt_owner", displayName: "Receipt Tester", organizationId: "org_a", controlRole: canManage ? "owner" : null,
      managerLocationIds: ["loc_a1"], locationRoles: [{ locationId: "loc_a1", role: "manager" }], sections: ["overview", "receipt_settings"],
    }),
  }));
  await page.route("**/api/pos/v1/admin/topology", (route) => route.fulfill({
    contentType: "application/json", body: data([{ id: "loc_a1", name: "Accra Shop", registers: [], devices: [] }]),
  }));
  await page.route("**/api/pos/v1/admin/receipt-settings**", async (route) => {
    if (route.request().method() === "PUT") {
      settings = route.request().postDataJSON().settings as ReceiptSettings;
      saves.push(settings);
    }
    await route.fulfill({ contentType: "application/json", body: data({ locationId: "loc_a1", locationName: "Accra Shop", settings, persisted: saves.length > 0, canManage }) });
  });
  await page.addInitScript(() => {
    const state = { calls: 0, text: "", widthPx: 0, imageReady: false };
    Object.assign(window, { receiptPrintTest: state });
    window.print = () => {
      state.calls += 1;
      const paper = document.querySelector<HTMLElement>(".receipt-print-host .receipt-paper");
      state.text = paper?.innerText ?? "";
      state.widthPx = paper?.getBoundingClientRect().width ?? 0;
      const image = paper?.querySelector("img");
      state.imageReady = !image || (image.complete && image.naturalWidth > 0);
      window.setTimeout(() => window.dispatchEvent(new Event("afterprint")), 25);
    };
  });
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Receipt settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live receipt preview" })).toBeVisible();
  return { saves, commerce };
}

test("unsaved branding preview, logo, save/reload and marked sample print use the maintained receipt", async ({ page }) => {
  const harness = await installReceiptManagement(page);
  const preview = page.locator("[data-receipt-preview]");
  await page.getByLabel("Business name", { exact: true }).fill("CETECH Ghana");
  await page.getByLabel("Business address", { exact: true }).fill("Nmai Dzorn Curve\nAccra");
  await page.getByLabel("Contact phone", { exact: true }).fill("030 000 0000");
  await page.getByLabel("Tax registration number", { exact: true }).fill("TEST-123");
  await page.getByRole("textbox", { name: "Footer message", exact: true }).fill("Thank You For Purchasing");
  await page.getByRole("checkbox", { name: /^Show SKU on receipts/ }).check();
  await page.getByLabel(/^Receipt logo/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await expect(preview.getByText("CETECH Ghana", { exact: true })).toBeVisible();
  await expect(preview.getByText("030 000 0000", { exact: true })).toBeVisible();
  await expect(preview.locator("img")).toHaveCount(1);
  expect(harness.saves).toHaveLength(0);

  await page.getByRole("button", { name: "Save receipt settings", exact: true }).click();
  await expect.poll(() => harness.saves.length).toBe(1);
  expect(harness.saves[0]?.presentation?.businessName).toBe("CETECH Ghana");
  expect(harness.saves[0]?.presentation?.logoDataUrl).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  await page.getByRole("button", { name: "Receipt settings", exact: true }).click();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("CETECH Ghana");
  await page.getByRole("combobox", { name: /^Printer paper width on this device/ }).selectOption("58");
  await page.getByRole("button", { name: "Test print (sample)", exact: true }).click();
  await expect(page.getByText("Sample print dialog opened. No sale was created.", { exact: true })).toBeVisible();
  const printed = await page.evaluate(() => (window as unknown as { receiptPrintTest: { calls: number; text: string; widthPx: number; imageReady: boolean } }).receiptPrintTest);
  expect(printed.calls).toBe(1);
  expect(printed.text).toContain("CETECH Ghana");
  expect(printed.text).toMatch(/sample/i);
  expect(Math.abs(printed.widthPx - 54 * 96 / 25.4)).toBeLessThan(1);
  expect(printed.imageReady).toBe(true);
  expect(harness.commerce).toEqual([]);
});

test("phone preview wraps long details and Manager can inspect but cannot change receipt configuration", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const harness = await installReceiptManagement(page, false);
  await expect(page.getByLabel("Business name", { exact: true })).toBeDisabled();
  await expect(page.getByLabel(/^Receipt logo/)).toBeDisabled();
  await expect(page.getByRole("button", { name: "Save receipt settings", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: /^Printer paper width on this device/ }).selectOption("58");
  const metrics = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.client + 1);
  expect(harness.saves).toHaveLength(0);
  expect(harness.commerce).toEqual([]);
});
