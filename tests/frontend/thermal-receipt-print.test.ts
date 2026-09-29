import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, test } from "vitest";

const css = readFileSync(
  new URL("../../apps/pos-web/src/features/sell/sell.css", import.meta.url),
  "utf8",
);
const workspace = readFileSync(
  new URL("../../apps/pos-web/src/app/workspace-runtime.tsx", import.meta.url),
  "utf8",
);
const sellRuntime = readFileSync(
  new URL("../../apps/pos-web/src/features/sell/runtime/SellRuntimeScreen.tsx", import.meta.url),
  "utf8",
);
const checkout = readFileSync(
  new URL("../../apps/pos-web/src/app/checkout-client.ts", import.meta.url),
  "utf8",
);

describe("BUG #85 thermal browser receipt printing", () => {
  test("browser print removes the POS shell from layout and exposes an 80mm receipt only", () => {
    expect(css).toContain("@media print");
    expect(css).toContain("@page");
    expect(css).toContain("size: 80mm 297mm");
    expect(css).not.toContain("size: 80mm auto");
    expect(css).toContain("margin: 2mm");
    expect(css).toContain("font-size: 12px");
    expect(css).toContain(
      "body *:not(:has(.receipt-print-host)):not(.receipt-print-host):not(.receipt-print-host *)",
    );
    expect(css).toContain("display: none !important");
    expect(css).not.toContain("visibility: hidden !important");
    expect(css).toContain(".receipt-print-host");
    expect(css).toContain(".receipt-paper");
    expect(css).toContain("width: 76mm !important");
  });

  test("completed-sale print mounts the receipt-only host before browser print", () => {
    expect(sellRuntime).toContain('className="receipt-print-host"');
    expect(sellRuntime).toContain("<ReceiptPaper receipt={printReceipt} />");
    expect(sellRuntime).toContain("flushSync(() =>");
    expect(sellRuntime).toContain("setPrintReceipt(receipt)");
    expect(sellRuntime).toContain("printReceipt ?");
    expect(checkout).toContain("window.print()");
  });

  test("Orders reprint mounts the immutable receipt snapshot before window.print", () => {
    expect(workspace).toContain("reprintImmutableReceipt");
    expect(workspace).toContain("flushSync(() =>");
    expect(workspace).toContain("receiptPaperIsMounted(document, view.receiptNumber)");
    expect(workspace).toContain('className="receipt-print-host"');
    expect(workspace).toContain("<ReceiptPaper receipt={printReceipt} />");
    expect(workspace).toContain('reason: "reprint"');
    expect(workspace).not.toContain("window.setTimeout");
    expect(sellRuntime).toContain("receiptPaperIsMounted(document, receipt.receiptNumber)");
  });
});

const THERMAL_WIDTH_PT = (80 / 25.4) * 72;
const A4_WIDTH_PT = (210 / 25.4) * 72;
const LETTER_WIDTH_PT = 612;

describe("Chromium thermal page size", () => {
  test("accepts the 80mm page box and emits a thermal-width PDF", async () => {
    const { createServer } = await import("node:http");
    const { once } = await import("node:events");
    const { chromium } = await import("@playwright/test");
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(`<!doctype html><html><head><style>${css}</style></head><body>
        <div class="receipt-print-host"><article class="receipt-paper"><h1>CETECH receipt</h1><p>Synthetic line item 12.50</p></article></div>
      </body></html>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("thermal test server did not bind");
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${address.port}/receipt`);
      await page.emulateMedia({ media: "print" });
      const accepted = await page.evaluate(() => {
        for (const sheet of [...document.styleSheets]) {
          for (const rule of [...sheet.cssRules]) {
            if (rule.type !== CSSRule.MEDIA_RULE) continue;
            for (const inner of [...(rule as CSSMediaRule).cssRules]) {
              if (inner.type === CSSRule.PAGE_RULE) {
                return (inner as CSSPageRule).style.getPropertyValue("size");
              }
            }
          }
        }
        return "";
      });
      expect(accepted).toBe("80mm 297mm");
      const receiptText = await page.locator(".receipt-paper").innerText();
      expect(receiptText).toContain("Synthetic line item 12.50");
      const box = await page.locator(".receipt-paper").boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(250);
      expect(box?.width ?? 0).toBeLessThan(320);
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      const media = pdf.toString("latin1").match(/\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/);
      expect(media).not.toBeNull();
      const width = Number(media?.[3]);
      expect(Math.abs(width - THERMAL_WIDTH_PT)).toBeLessThan(3);
      expect(Math.abs(width - A4_WIDTH_PT)).toBeGreaterThan(100);
      expect(Math.abs(width - LETTER_WIDTH_PT)).toBeGreaterThan(100);
      expect(pdf.length).toBeGreaterThan(1000);
      const streams = inflatedPdfStreams(pdf);
      expect(streams).toMatch(/Tj|TJ/);
      expect(streams.length).toBeGreaterThan(20);
    } finally {
      await browser.close();
      server.close();
    }
  }, 30_000);
});

function inflatedPdfStreams(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const parts: string[] = [];
  const pattern = /stream\r?\n([\s\S]*?)\nendstream/g;
  for (const match of raw.matchAll(pattern)) {
    const bytes = Buffer.from(match[1] ?? "", "latin1");
    try {
      parts.push(inflateSync(bytes).toString("latin1"));
    } catch {
      parts.push(match[1] ?? "");
    }
  }
  return parts.join("\n");
}
