import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import ts from "typescript";
import type { ReceiptViewModel } from "../src/features/sell/state/checkoutSession";

const THERMAL_WIDTH_PT = (80 / 25.4) * 72;
const A4_WIDTH_PT = (210 / 25.4) * 72;
const LETTER_WIDTH_PT = 612;
const css = readFileSync(path.join(process.cwd(), "src/features/sell/sell.css"), "utf8");
const printerModule = ts.transpileModule(
  readFileSync(path.join(process.cwd(), "src/core/receipt/printer-preference.ts"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } },
).outputText;

// Playwright replaces imported JSX with its component-test object format. Render
// the real maintained component in a separate Node process, then inspect its
// actual markup, CSS, readiness helper and PDF through Chromium.
function renderSyntheticReceipt(receipt: ReceiptViewModel): string {
  return execFileSync(process.execPath, ["-e", `
    const fs = require('node:fs');
    const ts = require('typescript');
    for (const extension of ['.ts', '.tsx']) require.extensions[extension] = (module, filename) => {
      module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
      }).outputText, filename);
    };
    const { createElement } = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const { ReceiptPaper } = require('./src/features/sell/components/ReceiptPaper.tsx');
    process.stdout.write(renderToStaticMarkup(createElement(ReceiptPaper, { receipt: JSON.parse(fs.readFileSync(0, 'utf8')), sample: true })));
  `], { input: JSON.stringify(receipt), encoding: "utf8" });
}

function syntheticReceipt(lineCount: number): ReceiptViewModel {
  return {
    id: "synthetic-receipt", transactionId: "11111111-1111-4111-8111-111111111111", receiptNumber: "SAMPLE-1001", orderReference: "SAMPLE",
    issuedAt: "2026-10-03T01:00:00Z", locationName: "Accra Main Store", registerName: "Front Counter", cashierName: "Sample cashier", customerLabel: "Sample customer", customerPhone: "***1234",
    presentation: { templateVersion: 1, businessName: "CETECH Ghana", logoDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", address: "CETECH Nmai Dzorn Curve\nAccra", contactPhone: "0300000000", footerMessage: "Thank You For Purchasing" },
    lines: Array.from({ length: lineCount }, (_, index) => ({ name: `${index + 1}. Very long Leyland Emulsion Paint Magnolia SampleABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`, sku: "LONG-SAMPLE-SKU-ABCDEFGHIJKLMNOPQRSTUVWXYZ", variationLabel: "Colour: Magnolia — Size: 10L", quantity: "2", unitPrice: { minor: 12345600, currency: "GHS" }, total: { minor: 24691200, currency: "GHS" } })),
    subtotal: { minor: 24691200, currency: "GHS" }, discount: { minor: 0, currency: "GHS" }, tax: { minor: 0, currency: "GHS" }, total: { minor: 24691200, currency: "GHS" }, tender: "cash", cashReceived: { minor: 25000000, currency: "GHS" }, changeDue: { minor: 308800, currency: "GHS" }, documentKind: "operational_pos_receipt",
  };
}

for (const scenario of [{ width: 80, lines: 1 }, { width: 58, lines: 1 }, { width: 58, lines: 40 }] as const) {
  test(`measured ${scenario.width}mm ${scenario.lines === 1 ? "short" : "long"} receipt prints intact and in black`, async ({ page }) => {
    const markup = renderSyntheticReceipt(syntheticReceipt(scenario.lines));
    const server = createServer((req, res) => {
      if (req.url === "/printer.js") {
        res.writeHead(200, { "content-type": "text/javascript" });
        res.end(printerModule);
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><html><head><style>${css}</style></head><body><nav>POS shell must not print</nav><div class="receipt-print-host">${markup}</div></body></html>`);
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("receipt test server did not bind");
    try {
      await page.goto(`http://127.0.0.1:${address.port}/receipt`);
      await page.evaluate(async (width) => {
        const modulePath = "/printer.js";
        const { prepareReceiptPrint } = await import(modulePath);
        await prepareReceiptPrint(document, width);
      }, scenario.width);
      await page.emulateMedia({ media: "print" });
      const layout = await page.evaluate(() => {
        const paper = document.querySelector<HTMLElement>(".receipt-paper")!;
        const box = paper.getBoundingClientRect();
        const clipped = [...paper.querySelectorAll("th, td, .r-row")].some((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.right > box.right + 1 || bounds.left < box.left - 1 || element.scrollWidth > element.clientWidth + 1;
        });
        return {
          width: box.width, height: box.height, clipped,
          text: paper.innerText,
          cells: paper.querySelectorAll("tbody tr").length,
          black: [...paper.querySelectorAll("td, th, strong, h3")].every((element) => getComputedStyle(element).color === "rgb(0, 0, 0)"),
          logo: { ready: paper.querySelector<HTMLImageElement>("img")!.naturalWidth > 0, filter: getComputedStyle(paper.querySelector("img")!).filter },
          shell: getComputedStyle(document.querySelector("nav")!).display,
          sizing: document.querySelector<HTMLStyleElement>("[data-receipt-print-sizing]")!.textContent,
        };
      });
      expect(Math.abs(layout.width - (scenario.width - 4) * 96 / 25.4)).toBeLessThan(1);
      expect(layout.clipped).toBe(false);
      expect(layout.black).toBe(true);
      expect(layout.logo.ready).toBe(true);
      expect(layout.logo.filter).toBe("grayscale(1)");
      expect(layout.shell).toBe("none");
      expect(layout.cells).toBe(scenario.lines);
      expect(layout.text).toContain("LONG-SAMPLE-SKU-ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      expect(layout.text).toContain("Colour: Magnolia — Size: 10L");
      expect(layout.text).toContain("Sample — not a sale");
      expect(layout.text).toContain("Thank You For Purchasing");
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: false });
      const boxes = [...pdf.toString("latin1").matchAll(/\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/g)];
      expect(boxes.length).toBeGreaterThan(0);
      for (const box of boxes) expect(Math.abs(Number(box[3]) - scenario.width * 72 / 25.4)).toBeLessThan(3);
      if (scenario.lines === 1) {
        expect(boxes).toHaveLength(1);
        expect(Number(boxes[0]?.[4])).toBeLessThan(layout.height * 72 / 96 + 25);
        expect(Number(boxes[0]?.[4])).toBeGreaterThan(layout.height * 72 / 96);
        expect(layout.sizing).not.toContain(`${scenario.width}mm 297mm`);
      } else {
        expect(boxes.length).toBeGreaterThan(1);
        expect(layout.sizing).toContain("58mm 297mm");
      }
      expect(inflatedPdfStreams(pdf)).toMatch(/Tj|TJ/);
    } finally {
      server.close();
    }
  });
}

test("Chromium keeps the 80mm page box and emits a thermal-width PDF", async ({ page }) => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><style>${css}</style></head><body>
      <div class="receipt-print-host"><article class="receipt-paper"><h1>CETECH receipt</h1><p>Synthetic line item 12.50</p></article></div>
    </body></html>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("thermal test server did not bind");
  }
  try {
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
    server.close();
  }
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
