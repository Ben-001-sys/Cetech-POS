import { readFileSync } from "node:fs";
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
const printPreparation = readFileSync(
  new URL("../../apps/pos-web/src/core/receipt/printer-preference.ts", import.meta.url),
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
    expect(checkout).toContain("await printMountedReceipt(document, undefined, input.receiptId)");
    expect(printPreparation).toContain("view.print()");
    expect(printPreparation).toContain('view.addEventListener("afterprint", afterPrinted)');
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
