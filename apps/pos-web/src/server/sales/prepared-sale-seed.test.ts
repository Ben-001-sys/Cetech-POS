import { describe, expect, test } from "vitest";
import type { PosSaleRecord, SeedPreparedSaleInput } from "../../core/checkout/types";
import { createInMemoryCheckoutStore } from "../../core/checkout/in-memory-store";
import type { PosRestFetch } from "../http/server-fetch";
import { createSupabaseCheckoutStore } from "./supabase-checkout-store";

const TX = "11111111-1111-4111-8111-111111111111";
const PAYMENT = "22222222-2222-4222-8222-222222222222";
const ghs = (minor: number) => ({ minor, currency: "GHS" as const });

function input(): SeedPreparedSaleInput {
  return {
    organizationId: "org_a", locationId: "loc_a", locationName: "Shop", registerId: "reg_a", registerName: "Register",
    shiftId: "55555555-5555-4555-8555-555555555555", deviceId: "44444444-4444-4444-8444-444444444444",
    cashierId: "cashier_a", cashierName: "Cashier A", customer: { kind: "walkin" }, customerLabel: "Walk-in",
    prepared: {
      transactionId: TX, saleId: "sale-50104", orderReference: "50104", quoteFingerprint: "0123456789abcdef0123456789abcdef",
      total: ghs(500), status: "prepared", stockCommitment: "reserved", preparedAt: "2026-10-03T12:00:00.000Z",
      expiresAt: "2026-10-03T12:20:00.000Z",
    },
    lines: [{ name: "Frozen product name", sku: "SAMPLE", quantity: "1", unitPrice: ghs(500), subtotal: ghs(500), discount: ghs(0), tax: ghs(0), total: ghs(500) }],
    subtotal: ghs(500), discount: ghs(0), tax: ghs(0),
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** Model PostgREST's distinct INSERT-ignore and UPDATE/upsert effects. */
function restBackend() {
  let row: { record: PosSaleRecord } | undefined;
  let pauseNextInsert = false;
  const entered = deferred();
  const release = deferred();
  const fetchImpl: PosRestFetch = async (url, init) => {
    expect(new URL(url).pathname).toBe("/rest/v1/pos_checkout_sales");
    if (init.method === "POST") {
      if (pauseNextInsert) {
        pauseNextInsert = false;
        entered.resolve();
        await release.promise;
      }
      const incoming = JSON.parse(init.body!) as { record: PosSaleRecord };
      if (!row || !init.headers.Prefer?.includes("resolution=ignore-duplicates")) row = incoming;
      return { ok: true, status: 201, async json() { return []; } };
    }
    expect(init.method).toBe("GET");
    return { ok: true, status: 200, async json() { return row ? [structuredClone(row)] : []; } };
  };
  return {
    fetchImpl, entered, release,
    pauseInsert() { pauseNextInsert = true; },
    sale() { return row?.record; },
  };
}

function durable(fetchImpl: PosRestFetch) {
  return createSupabaseCheckoutStore({ url: "https://example.supabase.co", serviceRoleKey: "test-infrastructure", fetchImpl });
}

describe("prepared sale seeding preserves the first operational record", () => {
  test("a delayed second server seed cannot reset a newly pending payment", async () => {
    const backend = restBackend();
    const first = durable(backend.fetchImpl);
    const second = durable(backend.fetchImpl);
    backend.pauseInsert();
    const delayedRepair = second.seedPreparedSale({ ...input(), cashierName: "Stale repair writer" });
    await backend.entered.promise;
    const seeded = await first.seedPreparedSale(input());
    const paying: PosSaleRecord = { ...seeded, status: "payment_pending", assignedPaymentId: PAYMENT };
    await first.saveSale(paying);
    backend.release.resolve();
    const recovered = await delayedRepair;
    expect(recovered).toEqual(paying);
    expect(backend.sale()).toEqual(paying);
    expect(recovered.assignedPaymentId).toBe(PAYMENT);
    expect(recovered.status).toBe("payment_pending");
    expect(recovered.cashierName).toBe("Cashier A");
  });

  test("a duplicate durable seed returns actual completion instead of its prepared input", async () => {
    const backend = restBackend();
    const store = durable(backend.fetchImpl);
    const seeded = await store.seedPreparedSale(input());
    const complete: PosSaleRecord = { ...seeded, status: "completed", assignedPaymentId: PAYMENT, commercialConfirmed: true };
    await store.saveSale(complete);
    expect(await store.seedPreparedSale({ ...input(), cashierName: "Replacement" })).toEqual(complete);
    expect(backend.sale()).toEqual(complete);
  });

  test("in-memory seeding also leaves the first pending payment and presentation intact", async () => {
    const store = createInMemoryCheckoutStore();
    const seeded = await store.seedPreparedSale(input());
    const paying: PosSaleRecord = { ...seeded, status: "payment_pending", assignedPaymentId: PAYMENT };
    await store.saveSale(paying);
    expect(await store.seedPreparedSale({ ...input(), cashierName: "Stale writer", lines: [] })).toEqual(paying);
    expect(await store.getSale(TX)).toEqual(paying);
  });

  test("durable insert failure cannot return an invented prepared record", async () => {
    const fetchImpl: PosRestFetch = async () => ({ ok: false, status: 500, async json() { return []; } });
    await expect(durable(fetchImpl).seedPreparedSale(input())).rejects.toThrow("rejected prepared sale insert");
  });

  test("successful HTTP insert without a retained row does not grant a prepared result", async () => {
    const fetchImpl: PosRestFetch = async (_url, init) => ({ ok: true, status: init.method === "POST" ? 201 : 200, async json() { return []; } });
    await expect(durable(fetchImpl).seedPreparedSale(input())).rejects.toThrow("did not retain a prepared sale");
  });
});
