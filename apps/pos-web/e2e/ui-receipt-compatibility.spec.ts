import { expect, test } from "@playwright/test";
import { installAuthoritativeStaffSession } from "./staff-session";

const TX = "11111111-1111-4111-8111-111111111111";
const MONEY = { minor: 15500, currency: "GHS" };
const ZERO = { minor: 0, currency: "GHS" };
const HISTORICAL_NAME = "Historical hardener name saved when this sale completed";

test("refined Orders reprint preserves the immutable receipt and its thermal print layout", async ({ page }) => {
  const writes: string[] = [];
  await page.route("**/api/pos/v1/**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fallback();
      return;
    }
    writes.push(route.request().url());
    await route.fulfill({ status: 500, contentType: "application/json", body: "{}" });
  });
  await installAuthoritativeStaffSession(page);
  await page.addInitScript(() => {
    const state = window as Window & { uiPrintEvidence?: { calls: number; text: string; html: string; sizing: string } };
    state.uiPrintEvidence = { calls: 0, text: "", html: "", sizing: "" };
    window.print = () => {
      const host = document.querySelector(".receipt-print-host");
      const previousCalls = state.uiPrintEvidence?.calls ?? 0;
      state.uiPrintEvidence = {
        calls: previousCalls + 1,
        text: host?.textContent ?? "",
        html: host?.outerHTML ?? "",
        sizing: document.querySelector("[data-receipt-print-sizing]")?.textContent ?? "",
      };
      // Simulate the native dialog lifecycle, rather than leaving PrintPort pending.
      setTimeout(() => window.dispatchEvent(new Event("afterprint")), 0);
    };
  });
  const order = {
    id: TX,
    saleId: "woo-reprint-1",
    orderReference: "POS-UI-REF-1",
    receiptNumber: "RCP-UI-REF-1",
    customerLabel: "Walk-in",
    createdAt: "2026-10-03T01:39:00.000Z",
    paymentLabel: "Cash",
    paymentStatus: "verified",
    total: MONEY,
    status: "completed",
    lines: [{ id: "line-1", name: HISTORICAL_NAME, quantity: "1", total: MONEY }],
  };
  function envelope(data: unknown): string {
    return JSON.stringify({ ok: true, correlationId: TX, data });
  }
  await page.route("**/api/pos/v1/orders", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: envelope({ items: [order] }) });
  });
  await page.route(`**/api/pos/v1/orders/${TX}`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: envelope(order) });
  });
  await page.route("**/api/pos/v1/receipts/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: envelope({
        id: "receipt-ui-refinement-1",
        transactionId: TX,
        receiptNumber: order.receiptNumber,
        orderReference: order.orderReference,
        issuedAt: order.createdAt,
        locationName: "CETECH Test Counter",
        registerName: "Front Counter",
        cashierName: "Test Cashier",
        customerLabel: "Walk-in",
        lines: [{ name: HISTORICAL_NAME, quantity: "1", unitPrice: MONEY, subtotal: MONEY, discount: ZERO, tax: ZERO, total: MONEY }],
        subtotal: MONEY,
        discount: ZERO,
        tax: ZERO,
        total: MONEY,
        tender: "cash",
        cashReceived: MONEY,
        changeDue: ZERO,
        documentKind: "operational_pos_receipt",
      }),
    });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/orders");
  await page.getByRole("button", { name: /POS-UI-REF-1/ }).click({ timeout: 30_000 });
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Reprint", exact: true }).click();
  await expect(page.getByText("Print dialog opened.", { exact: true })).toBeVisible();
  const printed = await page.evaluate(() => (window as Window & {
    uiPrintEvidence?: { calls: number; text: string; html: string; sizing: string };
  }).uiPrintEvidence);
  expect(printed?.calls).toBe(1);
  expect(printed?.text).toContain(order.receiptNumber);
  expect(printed?.text).toContain(HISTORICAL_NAME);
  expect(printed?.text).toContain("155.00");
  expect(writes, "Reprinting must not prepare, charge or finalize another sale").toEqual([]);

  // Replay only the captured mounted print host to inspect the actual app CSS.
  // The browser print dialog is stubbed; this is not physical-printer evidence.
  await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), printed?.html ?? "");
  if (printed?.sizing) await page.addStyleTag({ content: printed.sizing });
  await page.emulateMedia({ media: "print" });
  const receipt = page.locator(".receipt-print-host .receipt-paper");
  await expect(receipt).toBeVisible();
  const box = await receipt.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(200);
  expect(box?.width ?? 0).toBeLessThan(320);
  // Model the selected printer sheet explicitly; the receipt helper now preserves
  // driver paper dimensions so short receipts start at the top at the same scale.
  expect(printed?.sizing).toContain("@page { size: auto; margin: 2mm; }");
  const pdf = await page.pdf({ width: "80mm", height: "297mm", scale: 1, preferCSSPageSize: true, printBackground: true });
  const mediaBox = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/);
  expect(mediaBox).not.toBeNull();
  expect(Math.abs(Number(mediaBox?.[3]) - (80 / 25.4) * 72)).toBeLessThan(3);
  expect(Math.abs(Number(mediaBox?.[4]) - (297 / 25.4) * 72)).toBeLessThan(3);
});
