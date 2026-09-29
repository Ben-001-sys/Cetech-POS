import { createServer } from "node:http";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";

const THERMAL_WIDTH_PT = (80 / 25.4) * 72;
const A4_WIDTH_PT = (210 / 25.4) * 72;
const LETTER_WIDTH_PT = 612;
const css = readFileSync(path.join(process.cwd(), "src/features/sell/sell.css"), "utf8");

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
