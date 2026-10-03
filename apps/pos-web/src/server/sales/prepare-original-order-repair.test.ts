import { describe, expect, test, vi } from "vitest";
import type { PreparedSale, Quote, ReceiptSnapshot, SaleResolution } from "../../../../../docs/contracts/domain.generated";
import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import type { CheckoutStore } from "../../core/checkout/types";
import { createInMemoryCheckoutStore } from "../../core/checkout/in-memory-store";
import { createMemoryCatalogPresentationLookup } from "../../core/receipt/catalog-presentation";
import { apiFailure } from "../http/api-failure";
import { prepareSale } from "./prepare-sale";
import { resolveSale } from "./resolve-sale";

const CORRELATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" as const;
const TX = "11111111-1111-4111-8111-111111111111" as const;
const DEVICE = "44444444-4444-4444-8444-444444444444";
const SHIFT = "55555555-5555-4555-8555-555555555555";
const PREPARE_KEY = "22222222-2222-4222-8222-222222222222" as const;
const PAYMENT = "66666666-6666-4666-8666-666666666666" as const;
const FINGERPRINT = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-09-18T12:00:00.000Z");
const ACTOR = {
  actorId: "cashier_a",
  displayName: "Cashier A",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
};

function ghs(minor: number) {
  return { minor, currency: "GHS" as const };
}

function quote(): Quote {
  const total = ghs(500);
  const zero = ghs(0);
  return {
    id: "quote-126",
    fingerprint: FINGERPRINT,
    cartId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    cartRevision: 1,
    customer: { kind: "walkin" },
    locationId: "loc_a1",
    currency: "GHS",
    lines: [
      {
        lineId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "p-book",
        quantity: "1",
        unitPrice: total,
        subtotal: total,
        discount: zero,
        tax: zero,
        total,
        stockStatus: "in_stock",
        purchasable: true,
        problems: [],
      },
    ],
    subtotal: total,
    discount: zero,
    tax: zero,
    total,
    calculatedAt: "2026-09-18T12:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    purchasable: true,
  };
}

function resolution(status: SaleResolution["status"], message?: string): ApiResult<SaleResolution> {
  return {
    ok: true,
    correlationId: CORRELATION,
    data: {
      transactionId: TX,
      status,
      ...(status === "prepared" || status === "completed" ? { saleId: "sale-50104", orderReference: "50104" } : {}),
      ...(message ? { message } : {}),
    },
  };
}

async function seed() {
  const store = createInMemoryCheckoutStore();
  await store.seedRegister({
    id: "reg_a1",
    name: "B2 Register",
    locationId: "loc_a1",
    locationName: "B2 Shop",
    currency: "GHS",
    status: "active",
    organizationId: "org_a",
  });
  await store.seedDevice({ id: DEVICE, organizationId: "org_a", locationId: "loc_a1", status: "active" });
  await store.insertOpenShift({
    id: SHIFT,
    registerId: "reg_a1",
    deviceId: DEVICE,
    cashierId: ACTOR.actorId,
    status: "open",
    openingFloat: ghs(10000),
    expectedCash: ghs(10000),
    openedAt: "2026-09-18T11:00:00.000Z",
    organizationId: "org_a",
    locationId: "loc_a1",
  });
  await store.saveQuote(quote());
  const catalogLookup = createMemoryCatalogPresentationLookup({
    org_a: [{ id: "p-book", name: "6\" Fon Exercise Book", sku: "49806", kind: "simple" }],
  });
  return { store, catalogLookup };
}

function port(prepare: SalesPort["prepare"], resolve: SalesPort["resolve"]) {
  let prepareCount = 0;
  let resolveCount = 0;
  return {
    get prepareCount() {
      return prepareCount;
    },
    get resolveCount() {
      return resolveCount;
    },
    async prepare(input: Parameters<SalesPort["prepare"]>[0], context: Parameters<SalesPort["prepare"]>[1]) {
      prepareCount += 1;
      return prepare(input, context);
    },
    async resolve(transactionId: Parameters<SalesPort["resolve"]>[0]) {
      resolveCount += 1;
      return resolve(transactionId);
    },
  };
}

function request() {
  return {
    transactionId: TX,
    registerId: "reg_a1",
    shiftId: SHIFT,
    deviceId: DEVICE,
    quoteId: "quote-126",
    quoteFingerprint: FINGERPRINT,
  };
}

function context() {
  return { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION };
}

const PARTIAL_ORDER_MESSAGE = "This existing order cannot yet be safely opened for payment.";

function known(status: SaleResolution["status"] = "requires_attention", extras: Partial<SaleResolution> = {}): ApiResult<SaleResolution> {
  return {
    ok: true, correlationId: CORRELATION,
    data: {
      transactionId: TX, status, saleId: "sale-50104", orderReference: "50104",
      ...(status === "requires_attention" ? { message: PARTIAL_ORDER_MESSAGE } : {}), ...extras,
    },
  };
}

function prepared(extras: Partial<PreparedSale> = {}): PreparedSale {
  return {
    transactionId: TX, saleId: "sale-50104", orderReference: "50104", quoteFingerprint: FINGERPRINT,
    total: ghs(500), status: "prepared", stockCommitment: "reserved",
    preparedAt: "2026-09-18T12:00:00.000Z", expiresAt: "2026-09-18T12:20:00.000Z", ...extras,
  };
}

type Runtime = Awaited<ReturnType<typeof seed>>;

async function run(runtime: Runtime, salesPort: Pick<SalesPort, "prepare" | "resolve">, extra: Partial<Parameters<typeof prepareSale>[0]> = {}) {
  return prepareSale({
    ...runtime, salesPort, actor: ACTOR, request: request(), context: context(), now: NOW, ...extra,
  });
}

async function unfinished() {
  const runtime = await seed();
  const first = port(
    async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost original response", CORRELATION),
    async () => known(),
  );
  const result = await run(runtime, first);
  expect(result.ok).toBe(false);
  expect(first.prepareCount).toBe(1);
  expect(first.resolveCount).toBe(1);
  expect(await runtime.store.getSale(TX)).toBeUndefined();
  return runtime;
}

function repairPort(result: PreparedSale = prepared(), initial: ApiResult<SaleResolution> = known()) {
  let called = false;
  const seen: { request?: Parameters<SalesPort["prepare"]>[0]; context?: Parameters<SalesPort["prepare"]>[1] } = {};
  const salesPort = port(
    async (body, command) => {
      seen.request = body;
      seen.context = command;
      called = true;
      return { ok: true, data: result, correlationId: CORRELATION };
    },
    async () => called ? known("prepared") : initial,
  );
  return { salesPort, seen };
}

describe("new-sale inactive location guard", () => {
  test("new prepare cannot invoke commerce at an inactive parent location", async () => {
    const { store, catalogLookup } = await seed();
    const register = await store.getRegister("reg_a1");
    if (!register) throw new Error("missing fixture");
    await store.seedRegister({ ...register, locationStatus: "inactive" });
    const prepare = vi.fn<SalesPort["prepare"]>();
    const resolve = vi.fn<SalesPort["resolve"]>();
    const result = await prepareSale({ store, catalogLookup, actor: ACTOR,
      request: request(), context: context(), now: NOW, salesPort: { prepare, resolve },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("location is inactive");
    expect(prepare).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(await store.getSale(TX)).toBeUndefined();
  });
});

describe("explicit original-order prepare repair", () => {
  test("initial settlement and GET checks do not dispatch a repair", async () => {
    const runtime = await unfinished();
    let writes = 0;
    const checked = await resolveSale({
      store: runtime.store, actor: ACTOR, transactionId: TX, correlationId: CORRELATION,
      salesPort: { async resolve() { return known(); } },
    });
    expect(checked.ok && checked.data.status).toBe("requires_attention");
    const forbidden = port(async () => { writes++; throw new Error("must not repair an unknown order"); }, async () => resolution("requires_attention"));
    await run(runtime, forbidden);
    expect(writes).toBe(0);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
  });

  test("explicit retry repairs the same request/key and saves actual reservation with frozen presentation", async () => {
    const runtime = await unfinished();
    const { salesPort, seen } = repairPort();
    const result = await run(runtime, salesPort, { catalogLookup: createMemoryCatalogPresentationLookup({ org_a: [] }) });
    expect(result.ok).toBe(true);
    expect(seen).toEqual({ request: request(), context: context() });
    expect(salesPort.prepareCount).toBe(1);
    expect(salesPort.resolveCount).toBe(2);
    expect(result.ok && result.data).toEqual(prepared());
    const sale = await runtime.store.getSale(TX);
    expect(sale?.lines[0]?.name).toBe('6" Fon Exercise Book');
    expect(sale?.lines[0]?.sku).toBe("49806");
    expect(sale?.prepared.expiresAt).toBe(prepared().expiresAt);
    expect(await runtime.store.peekIdempotency("org_a", "sale.prepare", PREPARE_KEY)).toBe("acknowledged");
    await run(runtime, salesPort);
    expect(salesPort.prepareCount).toBe(1);
  });

  test("expired original quote repairs only its existing order; no new quote or catalog lookup", async () => {
    const runtime = await unfinished();
    const frozen = { ...quote(), expiresAt: "2026-09-18T11:59:59.000Z" as const };
    await runtime.store.saveQuote(frozen);
    const { salesPort } = repairPort();
    const result = await run(runtime, salesPort, { catalogLookup: createMemoryCatalogPresentationLookup({ org_a: [] }) });
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.expiresAt).toBe(prepared().expiresAt);
    expect((await runtime.store.getQuote(frozen.id))?.expiresAt).toBe(frozen.expiresAt);
    expect((await runtime.store.getSale(TX))?.prepared.total).toEqual(frozen.total);
    expect(salesPort.prepareCount).toBe(1);
  });

  test("new expired prepare and a different key for an expired original remain blocked", async () => {
    for (const originalExists of [false, true]) {
      const runtime = originalExists ? await unfinished() : await seed();
      await runtime.store.saveQuote({ ...quote(), expiresAt: "2026-09-18T11:59:59.000Z" });
      const { salesPort } = repairPort();
      const result = await run(runtime, salesPort, {
        context: { ...context(), idempotencyKey: "99999999-9999-4999-8999-999999999999" },
      });
      expect(!result.ok && result.error.code).toBe("QUOTE_EXPIRED");
      expect(salesPort.prepareCount).toBe(0);
      expect(salesPort.resolveCount).toBe(0);
    }
  });

  test("same-key changed request fails the original request-hash check", async () => {
    const runtime = await unfinished();
    await runtime.store.saveQuote({ ...quote(), id: "quote-other" });
    const { salesPort } = repairPort();
    const result = await run(runtime, salesPort, { request: { ...request(), quoteId: "quote-other" } });
    expect(!result.ok && result.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(salesPort.prepareCount).toBe(0);
  });

  test("a new key cannot dispatch prepare for an existing unfinished transaction", async () => {
    const runtime = await unfinished();
    const newKey = "99999999-9999-4999-8999-999999999999";
    const { salesPort } = repairPort();
    const result = await run(runtime, salesPort, { context: { ...context(), idempotencyKey: newKey } });
    expect(!result.ok && result.error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(salesPort.prepareCount).toBe(0);
    expect(await runtime.store.peekIdempotency("org_a", "sale.prepare", newKey)).toBeUndefined();
  });

  test.each([
    ["missing sale id", { saleId: undefined }],
    ["missing order reference", { orderReference: undefined }],
    ["wrong transaction", { transactionId: "99999999-9999-4999-8999-999999999999" }],
    ["unrelated attention reason", { message: "Woo totals are contradictory." }],
    ["payment identity", { paymentId: PAYMENT }],
    ["receipt identity", { receiptId: "rcpt-existing" }],
    ["preparing without recovery proof", { status: "preparing" }],
    ["pending payment", { status: "payment_pending", paymentId: PAYMENT }],
    ["finalizing", { status: "finalizing", paymentId: PAYMENT }],
    ["completed", { status: "completed", paymentId: PAYMENT }],
    ["cancelled", { status: "cancelled" }],
  ] as const)("blocks repair for %s", async (_label, change) => {
    const runtime = await unfinished();
    const { salesPort } = repairPort(prepared(), known("requires_attention", change));
    const result = await run(runtime, salesPort);
    expect(result.ok).toBe(false);
    expect(salesPort.prepareCount).toBe(0);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
  });

  test.each(["missing", "transaction", "line-id", "total"] as const)("blocks %s frozen intent before repair", async (fault) => {
    const runtime = await unfinished();
    const original = await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY);
    if (!original) throw new Error("missing seeded intent");
    const store: CheckoutStore = {
      ...runtime.store,
      async getPrepareIntent() {
        if (fault === "missing") return undefined;
        if (fault === "transaction") return { ...original, transactionId: "99999999-9999-4999-8999-999999999999" };
        if (fault === "line-id") return { ...original, lineIds: ["other-line"] };
        return { ...original, lines: [{ ...original.lines[0]!, total: ghs(501) }] };
      },
    };
    const { salesPort } = repairPort();
    expect((await run(runtime, salesPort, { store })).ok).toBe(false);
    expect(salesPort.prepareCount).toBe(0);
  });

  test.each(["payment", "cash", "receipt", "finalize", "cancel"] as const)("blocks local %s evidence", async (evidence) => {
    const runtime = await unfinished();
    if (evidence === "payment") await runtime.store.savePayment({
      paymentId: PAYMENT, transactionId: TX, saleId: "sale-50104", tender: "cash", status: "pending", amount: ghs(500), actorId: ACTOR.actorId,
    });
    if (evidence === "receipt") await runtime.store.saveReceipt({
      id: "rcpt-existing", transactionId: TX, receiptNumber: "POS-50104", orderReference: "50104",
      issuedAt: "2026-09-18T12:00:00.000Z", locationName: "Shop", registerName: "Register", cashierName: "Cashier",
      customerLabel: "Walk-in", lines: [], subtotal: ghs(500), discount: ghs(0), tax: ghs(0), total: ghs(500), tender: "cash",
      documentKind: "operational_pos_receipt",
    } satisfies ReceiptSnapshot);
    if (evidence === "finalize" || evidence === "cancel") await runtime.store.claimIdempotency(
      "org_a", evidence === "finalize" ? "sale.finalize" : "sale.cancel", PAYMENT, "same-request-hash", "loc_a1",
      { transactionId: TX, registerId: "reg_a1", shiftId: SHIFT },
    );
    const store: CheckoutStore = evidence === "cash" ? {
      ...runtime.store,
      async listCashSales() {
        return [{ id: PAYMENT, transactionId: TX, shiftId: SHIFT, kind: "cash_sale", signedAmount: ghs(500),
          organizationId: "org_a", createdAt: "2026-09-18T12:00:00.000Z", actorId: ACTOR.actorId }];
      },
    } : runtime.store;
    const { salesPort } = repairPort();
    expect((await run(runtime, salesPort, { store })).ok).toBe(false);
    expect(salesPort.prepareCount).toBe(0);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
  });

  test.each([
    ["transaction", { transactionId: "99999999-9999-4999-8999-999999999999" }],
    ["sale", { saleId: "other-sale" }],
    ["order", { orderReference: "other-order" }],
    ["fingerprint", { quoteFingerprint: "ffffffffffffffffffffffffffffffff" }],
    ["total", { total: ghs(501) }],
    ["expired reservation", { expiresAt: "2026-09-18T11:59:59.000Z" }],
    ["invalid reservation expiry", { expiresAt: "not-a-date" }],
  ] as const)("does not persist mismatched %s after repair", async (_label, change) => {
    const runtime = await unfinished();
    const { salesPort } = repairPort(prepared(change));
    expect((await run(runtime, salesPort)).ok).toBe(false);
    expect(salesPort.prepareCount).toBe(1);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    expect(await runtime.store.peekIdempotency("org_a", "sale.prepare", PREPARE_KEY)).toBe("requires_attention");
  });

  test("payment evidence arriving after repair prevents local materialization", async () => {
    const runtime = await unfinished();
    let called = false;
    const salesPort = port(async () => {
      called = true;
      await runtime.store.savePayment({
        paymentId: PAYMENT, transactionId: TX, saleId: "sale-50104", tender: "cash", status: "pending", amount: ghs(500), actorId: ACTOR.actorId,
      });
      return { ok: true, correlationId: CORRELATION, data: prepared() };
    }, async () => called ? known("prepared") : known());
    expect((await run(runtime, salesPort)).ok).toBe(false);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
  });

  test("lost repair response stays blocked, then explicit same-key replay recovers expired original", async () => {
    const runtime = await unfinished();
    await runtime.store.saveQuote({ ...quote(), expiresAt: "2026-09-18T11:59:59.000Z" });
    const lost = port(async () => { throw new Error("lost repair response"); }, async () => known());
    const result = await run(runtime, lost);
    expect(result.ok).toBe(false);
    expect(lost.prepareCount).toBe(1);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    const { salesPort, seen } = repairPort(prepared(), known("prepared"));
    const replayed = await run(runtime, salesPort);
    expect(replayed.ok).toBe(true);
    expect(seen.context?.idempotencyKey).toBe(PREPARE_KEY);
    expect(replayed.ok && replayed.data.orderReference).toBe("50104");
  });

  test("concurrent explicit retries use the same key and do not replace an existing local sale", async () => {
    const runtime = await unfinished();
    const { salesPort, seen } = repairPort();
    const results = await Promise.all([run(runtime, salesPort), run(runtime, salesPort)]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(salesPort.prepareCount).toBe(1);
    expect(seen.context?.idempotencyKey).toBe(PREPARE_KEY);
    expect((await runtime.store.listRecentSales({ organizationId: "org_a" })).length).toBe(1);
  });

  test("parallel durable callers remain bound to the bridge original-key repair/replay lock", async () => {
    const runtime = await unfinished();
    const store: CheckoutStore = { ...runtime.store, async withLock(_key, fn) { return fn(); } };
    let bridgeRepair: Promise<ApiResult<PreparedSale>> | undefined;
    let repairEffects = 0;
    const seenKeys: string[] = [];
    let bridgePrepared = false;
    const salesPort = port(async (body, command) => {
      expect(body).toEqual(request());
      seenKeys.push(command.idempotencyKey);
      // Bridge creator lock and its frozen original-order outcome are canonical;
      // this fake does not grant the BFF a process-local distributed lock.
      if (!bridgeRepair) {
        repairEffects++;
        bridgeRepair = Promise.resolve({ ok: true, correlationId: CORRELATION, data: prepared() });
      }
      bridgePrepared = true;
      return bridgeRepair;
    }, async () => bridgePrepared ? known("prepared") : known());
    const results = await Promise.all([run(runtime, salesPort, { store }), run(runtime, salesPort, { store })]);
    expect(results.some((result) => result.ok)).toBe(true);
    expect(repairEffects).toBe(1);
    expect(seenKeys.length).toBeGreaterThanOrEqual(1);
    expect(seenKeys.every((key) => key === PREPARE_KEY)).toBe(true);
    expect((await runtime.store.listRecentSales({ organizationId: "org_a" })).length).toBe(1);
    expect((await runtime.store.getSale(TX))?.prepared).toEqual(prepared());
  });

  test("expired-original exception still validates current register, shift and staff scope before dispatch", async () => {
    for (const fault of ["shift", "organization", "location"] as const) {
      const runtime = await unfinished();
      await runtime.store.saveQuote({ ...quote(), expiresAt: "2026-09-18T11:59:59.000Z" });
      const store: CheckoutStore = fault === "shift" ? { ...runtime.store, async getShift() { return undefined; } } : runtime.store;
      const actor = fault === "organization" ? { ...ACTOR, organizationId: "org_other" }
        : fault === "location" ? { ...ACTOR, locationIds: ["loc_other"] } : ACTOR;
      const { salesPort } = repairPort();
      expect((await run(runtime, salesPort, { store, actor })).ok).toBe(false);
      expect(salesPort.prepareCount).toBe(0);
      expect(await runtime.store.getSale(TX)).toBeUndefined();
    }
  });

  test("prepared replay with existing payment identity does not open payment again", async () => {
    const runtime = await unfinished();
    const { salesPort } = repairPort(prepared(), known("prepared", { paymentId: PAYMENT }));
    expect((await run(runtime, salesPort)).ok).toBe(false);
    expect(salesPort.prepareCount).toBe(0);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
  });

  test("reservation expiring while remote verification runs cannot open payment", async () => {
    const runtime = await unfinished();
    let clock = NOW.getTime();
    const clockSpy = vi.spyOn(Date, "now").mockImplementation(() => clock);
    let called = false;
    const salesPort = port(async () => {
      called = true;
      return { ok: true, correlationId: CORRELATION, data: prepared() };
    }, async () => {
      if (called) {
        clock += 21 * 60 * 1000;
        return known("prepared");
      }
      return known();
    });
    try {
      expect((await run(runtime, salesPort)).ok).toBe(false);
      expect(await runtime.store.getSale(TX)).toBeUndefined();
    } finally {
      clockSpy.mockRestore();
    }
  });

  test("a different saved reservation is not returned as the proven bridge outcome", async () => {
    const runtime = await unfinished();
    const store: CheckoutStore = {
      ...runtime.store,
      async seedPreparedSale(input) {
        return runtime.store.seedPreparedSale({ ...input, prepared: { ...input.prepared, expiresAt: "2026-09-18T12:19:00.000Z" } });
      },
    };
    const { salesPort } = repairPort();
    expect((await run(runtime, salesPort, { store })).ok).toBe(false);
    expect(await runtime.store.peekIdempotency("org_a", "sale.prepare", PREPARE_KEY)).toBe("requires_attention");
  });
});

async function acknowledged() {
  const runtime = await seed();
  const initial = port(async () => ({ ok: true, data: prepared(), correlationId: CORRELATION }), async () => {
    throw new Error("successful initial prepare must not resolve");
  });
  expect((await run(runtime, initial)).ok).toBe(true);
  expect(await runtime.store.peekIdempotency("org_a", "sale.prepare", PREPARE_KEY)).toBe("acknowledged");
  return runtime;
}

function forbiddenRemote() {
  return port(async () => { throw new Error("local replay must not repair or create remotely"); }, async () => {
    throw new Error("local replay must not call remote resolution");
  });
}

describe("acknowledged prepare replay reflects current unpaid state", () => {
  test("unpaid same-key replay preserves stored outcome and makes no remote requests", async () => {
    const runtime = await acknowledged();
    const before = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    const salesPort = forbiddenRemote();
    const result = await run(runtime, salesPort);
    expect(result.ok && result.data).toEqual(prepared());
    expect(salesPort.prepareCount).toBe(0);
    expect(salesPort.resolveCount).toBe(0);
    expect(await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY)).toEqual(before);
  });

  test("payment starting after the first local read blocks historical PreparedSale replay", async () => {
    const runtime = await acknowledged();
    const original = await runtime.store.getSale(TX);
    if (!original) throw new Error("expected original sale");
    const before = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    const store: CheckoutStore = {
      ...runtime.store,
      async claimIdempotency(...args) {
        const claim = await runtime.store.claimIdempotency(...args);
        await runtime.store.saveSale({ ...original, status: "payment_pending", assignedPaymentId: PAYMENT });
        return claim;
      },
    };
    const salesPort = forbiddenRemote();
    const result = await run(runtime, salesPort, { store });
    expect(!result.ok && result.error.code).toBe("REQUIRES_ATTENTION");
    expect(salesPort.prepareCount).toBe(0);
    expect(salesPort.resolveCount).toBe(0);
    expect((await runtime.store.getSale(TX))?.assignedPaymentId).toBe(PAYMENT);
    expect(await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY)).toEqual(before);
  });

  test.each(["payment_pending", "requires_attention", "finalizing", "completed", "cancelled"] as const)(
    "current %s state cannot replay payment-ready preparation", async (status) => {
      const runtime = await acknowledged();
      const original = await runtime.store.getSale(TX);
      if (!original) throw new Error("expected original sale");
      await runtime.store.saveSale({ ...original, status });
      const salesPort = forbiddenRemote();
      expect((await run(runtime, salesPort)).ok).toBe(false);
      expect(salesPort.prepareCount).toBe(0);
      expect(salesPort.resolveCount).toBe(0);
      expect(await runtime.store.peekIdempotency("org_a", "sale.prepare", PREPARE_KEY)).toBe("acknowledged");
    },
  );

  test.each(["payment", "cash", "receipt", "finalize", "cancel"] as const)("current %s evidence blocks local replay", async (evidence) => {
    const runtime = await acknowledged();
    if (evidence === "payment") await runtime.store.savePayment({
      paymentId: PAYMENT, transactionId: TX, saleId: "sale-50104", tender: "card", status: "pending", amount: ghs(500), actorId: ACTOR.actorId,
    });
    if (evidence === "cash") await runtime.store.appendCashMovement({
      id: PAYMENT, transactionId: TX, shiftId: SHIFT, kind: "cash_sale", signedAmount: ghs(500),
      organizationId: "org_a", actorId: ACTOR.actorId, createdAt: "2026-09-18T12:00:00.000Z",
    });
    if (evidence === "receipt") await runtime.store.saveReceipt({
      id: "rcpt-existing", transactionId: TX, receiptNumber: "POS-50104", orderReference: "50104",
      issuedAt: "2026-09-18T12:00:00.000Z", locationName: "Shop", registerName: "Register", cashierName: "Cashier",
      customerLabel: "Walk-in", lines: [], subtotal: ghs(500), discount: ghs(0), tax: ghs(0), total: ghs(500), tender: "cash",
      documentKind: "operational_pos_receipt",
    });
    if (evidence === "finalize" || evidence === "cancel") await runtime.store.claimIdempotency(
      "org_a", evidence === "finalize" ? "sale.finalize" : "sale.cancel", PAYMENT, "same-request-hash", "loc_a1",
      { transactionId: TX, registerId: "reg_a1", shiftId: SHIFT },
    );
    const before = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    const salesPort = forbiddenRemote();
    expect((await run(runtime, salesPort)).ok).toBe(false);
    expect(salesPort.prepareCount).toBe(0);
    expect(salesPort.resolveCount).toBe(0);
    expect(await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY)).toEqual(before);
  });

  test("original reservation expiry prevents ready replay without modifying the acknowledged outcome", async () => {
    const runtime = await acknowledged();
    const before = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    const salesPort = forbiddenRemote();
    const result = await run(runtime, salesPort, { now: new Date("2026-09-18T12:21:00.000Z") });
    expect(!result.ok && result.error.code).toBe("REQUIRES_ATTENTION");
    expect(salesPort.prepareCount).toBe(0);
    expect(salesPort.resolveCount).toBe(0);
    expect(await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY)).toEqual(before);
  });

  test("mismatched current stored preparation cannot become ready from a historical acknowledged outcome", async () => {
    const runtime = await acknowledged();
    const original = await runtime.store.getSale(TX);
    if (!original) throw new Error("expected original sale");
    await runtime.store.saveSale({ ...original, prepared: { ...original.prepared, orderReference: "other-order" } });
    const salesPort = forbiddenRemote();
    expect((await run(runtime, salesPort)).ok).toBe(false);
    expect(await runtime.store.peekIdempotency("org_a", "sale.prepare", PREPARE_KEY)).toBe("acknowledged");
    expect(salesPort.prepareCount).toBe(0);
  });
});
