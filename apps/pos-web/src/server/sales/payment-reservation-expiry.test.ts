import { afterEach, describe, expect, test, vi } from "vitest";
import type { CommandContext, Money, PreparedSale } from "../../../../../docs/contracts/domain.generated";
import { createInMemoryCheckoutStore } from "../../core/checkout/in-memory-store";
import type { CheckoutStore, StaffActor } from "../../core/checkout/types";
import { createFakeElectronicPaymentProvider } from "../payments/fake-provider";
import { initializeElectronicPayment } from "../payments/initialize-electronic";
import { confirmCash } from "./confirm-cash";

const TX = "11111111-1111-4111-8111-111111111111";
const SHIFT = "66666666-6666-4666-8666-666666666666";
const KEY = "22222222-2222-4222-8222-222222222222";
const NEXT_KEY = "22222222-2222-4222-8222-222222222223";
const NOW = new Date("2026-10-03T04:00:00.000Z");
const LATER = new Date("2026-10-03T05:00:00.000Z");
const ACTOR: StaffActor = {
  actorId: "manager_a", displayName: "Staging Manager", organizationId: "org_a", locationIds: ["loc_a"],
};
const ghs = (minor: number): Money => ({ minor, currency: "GHS" });
const context = (idempotencyKey: string = KEY): CommandContext => ({
  idempotencyKey, correlationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
});

afterEach(() => vi.restoreAllMocks());

async function setup(expiresAt = "2026-10-03T04:10:00.000Z") {
  const store = createInMemoryCheckoutStore();
  await store.insertOpenShift({
    id: SHIFT, organizationId: "org_a", locationId: "loc_a", registerId: "reg_a",
    deviceId: "44444444-4444-4444-8444-444444444444", cashierId: ACTOR.actorId,
    status: "open", openingFloat: ghs(1000), expectedCash: ghs(1000), openedAt: NOW.toISOString(),
  });
  const prepared: PreparedSale = {
    transactionId: TX, saleId: "original-order", orderReference: "ORIGINAL-ORDER",
    quoteFingerprint: "0123456789abcdef0123456789abcdef", total: ghs(1500),
    status: "prepared", stockCommitment: "reserved", preparedAt: NOW.toISOString(), expiresAt,
  };
  await store.seedPreparedSale({
    organizationId: "org_a", locationId: "loc_a", locationName: "Store", registerId: "reg_a",
    registerName: "Register A", deviceId: "44444444-4444-4444-8444-444444444444", shiftId: SHIFT,
    cashierId: ACTOR.actorId, cashierName: ACTOR.displayName, customer: { kind: "walkin" },
    customerLabel: "Walk-in", prepared, subtotal: ghs(1500), discount: ghs(0), tax: ghs(0),
    lines: [{ name: "Synthetic item", quantity: "1", unitPrice: ghs(1500), subtotal: ghs(1500),
      discount: ghs(0), tax: ghs(0), total: ghs(1500) }],
  });
  return store;
}

function cash(store: CheckoutStore, now = NOW, idempotencyKey = KEY) {
  return confirmCash({ store, actor: ACTOR, request: { transactionId: TX, cashReceived: ghs(2000) },
    context: context(idempotencyKey), now });
}

function electronic(store: CheckoutStore, provider: ReturnType<typeof createFakeElectronicPaymentProvider>,
  now = NOW, idempotencyKey = KEY) {
  return initializeElectronicPayment({ store, provider, actor: ACTOR,
    request: { transactionId: TX, tender: "card" }, context: context(idempotencyKey), now,
    appEnv: "local", sandboxPayerEmail: "fixture@example.invalid", methodConfigured: true });
}

describe("new payment effects require a current prepared reservation", () => {
  test.each([
    ["expired", "2026-10-03T03:59:59.000Z"],
    ["exact expiry boundary", NOW.toISOString()],
    ["unverifiable expiry", "not-a-date"],
  ])("cash refuses %s before any ledger or payment effect", async (_label, expiresAt) => {
    const store = await setup(expiresAt);
    const append = vi.spyOn(store, "appendCashMovement");
    const save = vi.spyOn(store, "savePayment");
    const result = await cash(store);
    expect(result).toMatchObject({ ok: false, error: { code: "REQUIRES_ATTENTION", details: { field: "pre_effect" } } });
    expect(append).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(await store.listCashSales(TX)).toHaveLength(0);
    expect(await store.getPaymentForTransaction(TX)).toBeUndefined();
    expect((await store.getSale(TX))?.status).toBe("prepared");
    expect(await store.expectedCash(SHIFT)).toEqual(ghs(1000));
  });

  test.each([
    ["expired", "2026-10-03T03:59:59.000Z"],
    ["exact expiry boundary", NOW.toISOString()],
    ["unverifiable expiry", "not-a-date"],
  ])("electronic refuses %s before saving an intent or calling the provider", async (_label, expiresAt) => {
    const store = await setup(expiresAt);
    const provider = createFakeElectronicPaymentProvider();
    const save = vi.spyOn(store, "savePayment");
    const result = await electronic(store, provider);
    expect(result).toMatchObject({ ok: false, error: { code: "REQUIRES_ATTENTION", details: { field: "pre_effect" } } });
    expect(save).not.toHaveBeenCalled();
    expect(provider.initializeCount).toBe(0);
    expect(await store.getPaymentForTransaction(TX)).toBeUndefined();
    expect((await store.getSale(TX))?.status).toBe("prepared");
  });

  test("cash checks elapsed time at the ledger boundary", async () => {
    const store = await setup(new Date(NOW.getTime() + 1000).toISOString());
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => 10000 + elapsed);
    const mark = store.markIdempotencySent.bind(store);
    vi.spyOn(store, "markIdempotencySent").mockImplementation(async (...args) => {
      await mark(...args);
      elapsed = 1001;
    });
    expect(await cash(store)).toMatchObject({ ok: false, error: { code: "REQUIRES_ATTENTION" } });
    expect(await store.listCashSales(TX)).toHaveLength(0);
    expect(await store.getPaymentForTransaction(TX)).toBeUndefined();
  });

  test("electronic checks elapsed time immediately before the first intent", async () => {
    const store = await setup(new Date(NOW.getTime() + 1000).toISOString());
    const provider = createFakeElectronicPaymentProvider();
    let elapsed = 0;
    vi.spyOn(Date, "now").mockImplementation(() => 10000 + elapsed);
    const mark = store.markIdempotencySent.bind(store);
    vi.spyOn(store, "markIdempotencySent").mockImplementation(async (...args) => {
      await mark(...args);
      elapsed = 1001;
    });
    expect(await electronic(store, provider)).toMatchObject({ ok: false, error: { code: "REQUIRES_ATTENTION" } });
    expect(provider.initializeCount).toBe(0);
    expect(await store.getPaymentForTransaction(TX)).toBeUndefined();
  });

  test("an invalid current clock cannot authorize any new payment effect", async () => {
    const store = await setup();
    const provider = createFakeElectronicPaymentProvider();
    const invalidNow = new Date("invalid");
    expect(await cash(store, invalidNow)).toMatchObject({ ok: false, error: { code: "REQUIRES_ATTENTION" } });
    expect(await electronic(store, provider, invalidNow)).toMatchObject({ ok: false, error: { code: "REQUIRES_ATTENTION" } });
    expect(await store.listCashSales(TX)).toHaveLength(0);
    expect(await store.getPaymentForTransaction(TX)).toBeUndefined();
    expect(provider.initializeCount).toBe(0);
  });
});

describe("expiry never hides payment effects that already exist", () => {
  test("recorded cash payment remains recoverable with the original and fresh keys after expiry", async () => {
    const store = await setup();
    const original = await cash(store);
    expect(original.ok).toBe(true);
    if (!original.ok) throw new Error("expected original cash effect");
    for (const key of [KEY, NEXT_KEY]) {
      const recovered = await cash(store, LATER, key);
      expect(recovered).toMatchObject({ ok: true, data: { paymentId: original.data.paymentId, status: "verified" } });
    }
    expect(await store.listCashSales(TX)).toHaveLength(1);
    expect(await store.expectedCash(SHIFT)).toEqual(ghs(2500));
  });

  test("existing cash ledger without POS payment repairs after expiry without another movement", async () => {
    const store = await setup();
    const save = store.savePayment.bind(store);
    vi.spyOn(store, "savePayment").mockRejectedValueOnce(new Error("synthetic persist loss"));
    const lost = await cash(store);
    expect(lost).toMatchObject({ ok: true, data: { status: "requires_attention" } });
    expect(await store.listCashSales(TX)).toHaveLength(1);
    expect(await store.getPaymentForTransaction(TX)).toBeUndefined();
    vi.spyOn(store, "savePayment").mockImplementation(save);
    const recovered = await cash(store, LATER);
    expect(recovered).toMatchObject({ ok: true, data: { status: "verified" } });
    expect(await store.listCashSales(TX)).toHaveLength(1);
    expect(await store.expectedCash(SHIFT)).toEqual(ghs(2500));
  });

  test("an existing electronic intent remains recoverable after expiry without another provider call", async () => {
    const store = await setup();
    const provider = createFakeElectronicPaymentProvider();
    provider.setInitializeOutcome("lost_response");
    const original = await electronic(store, provider);
    expect(original.ok).toBe(true);
    if (!original.ok) throw new Error("expected original electronic intent");
    for (const key of [KEY, NEXT_KEY]) {
      const recovered = await electronic(store, provider, LATER, key);
      expect(recovered).toMatchObject({ ok: true, data: { paymentId: original.data.paymentId,
        displayReference: original.data.displayReference, status: "reconciling" } });
    }
    expect(provider.initializeCount).toBe(1);
  });
});
