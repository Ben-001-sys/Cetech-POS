import { describe, expect, test } from "vitest";
import type { ReceiptSnapshot } from "../../../../../docs/contracts/domain.generated";
import { mapReceiptSnapshot } from "../sell/runtime/cashCheckoutController";
import { receiptPaperIsMounted, reprintImmutableReceipt } from "./reprint-receipt";

const SNAPSHOT: ReceiptSnapshot = {
  id: "rcpt-1",
  transactionId: "11111111-1111-4111-8111-111111111111",
  receiptNumber: "POS-1001",
  orderReference: "1001",
  issuedAt: "2026-09-23T10:15:00.000Z",
  locationName: "Accra Main Store",
  registerName: "Front Counter",
  cashierName: "Ama",
  customerLabel: "Walk-in",
  lines: [],
  subtotal: { minor: 2500, currency: "GHS" },
  discount: { minor: 0, currency: "GHS" },
  tax: { minor: 0, currency: "GHS" },
  total: { minor: 2500, currency: "GHS" },
  tender: "cash",
  documentKind: "operational_pos_receipt",
};

describe("immutable receipt reprint", () => {
  test("prints only after the stored receipt is mounted and does not call sale or payment", async () => {
    const calls: string[] = [];
    let presented = "";
    const result = await reprintImmutableReceipt({
      transactionId: SNAPSHOT.transactionId,
      receipts: {
        async getByTransaction(id) {
          calls.push(`load:${id}`);
          return { ok: true, data: SNAPSHOT, correlationId: "corr" };
        },
      },
      mapReceipt: mapReceiptSnapshot,
      present: (view) => {
        calls.push("mount");
        presented = `${view.locationName}|${view.receiptNumber}`;
        return presented.includes("POS-1001");
      },
      print: async (receiptId) => {
        calls.push(`print:${receiptId}`);
        expect(presented).toContain("POS-1001");
        return { status: "dialog_opened" };
      },
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "load:11111111-1111-4111-8111-111111111111",
      "mount",
      "print:rcpt-1",
    ]);
    expect(presented).toBe("Accra Main Store|POS-1001");
    expect(calls.join(" ")).not.toContain("sale");
    expect(calls.join(" ")).not.toContain("payment");
  });

  test("a blank preview does not print", async () => {
    const calls: string[] = [];
    const result = await reprintImmutableReceipt({
      transactionId: SNAPSHOT.transactionId,
      receipts: {
        async getByTransaction() {
          calls.push("load");
          return { ok: true, data: SNAPSHOT, correlationId: "corr" };
        },
      },
      mapReceipt: mapReceiptSnapshot,
      present: () => {
        calls.push("mount");
        return false;
      },
      print: async () => {
        calls.push("print");
        return { status: "dialog_opened" };
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toEqual(["load", "mount"]);
  });

  test("historic internal location id stays stored and is not the mounted customer label", async () => {
    const historic: ReceiptSnapshot = { ...SNAPSHOT, locationName: "loc_a1", registerName: "reg_a1" };
    let viewLocation = "";
    await reprintImmutableReceipt({
      transactionId: historic.transactionId,
      receipts: {
        async getByTransaction() {
          return { ok: true, data: historic, correlationId: "corr" };
        },
      },
      mapReceipt: mapReceiptSnapshot,
      present: (view) => {
        viewLocation = `${view.locationName}|${view.registerName}`;
        return true;
      },
      print: async () => ({ status: "dialog_opened" }),
    });
    expect(historic.locationName).toBe("loc_a1");
    expect(viewLocation).toBe("Store|Register");
  });

  test("receipt paper mount check requires printable text", () => {
    const blank = {
      querySelector: () => ({ textContent: "   " }),
    } as unknown as ParentNode;
    const ready = {
      querySelector: () => ({ textContent: "Receipt POS-1001 Accra Main Store" }),
    } as unknown as ParentNode;
    expect(receiptPaperIsMounted(blank, "POS-1001")).toBe(false);
    expect(receiptPaperIsMounted(ready, "POS-1001")).toBe(true);
  });
});
