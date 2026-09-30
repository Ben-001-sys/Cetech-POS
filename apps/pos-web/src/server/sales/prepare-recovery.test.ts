import { describe, expect, test } from "vitest";
import type { Quote, ReceiptSnapshot, SaleResolution } from "../../../../../docs/contracts/domain.generated";
import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import { createInMemoryCheckoutStore } from "../../core/checkout/in-memory-store";
import { loadSalePresentation } from "../../core/receipt/build-receipt-line";
import { createMemoryCatalogPresentationLookup } from "../../core/receipt/catalog-presentation";
import { buildPrepareIntentSnapshot } from "../../core/receipt/prepare-intent";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { apiFailure } from "../http/api-failure";
import { effectCertaintyOf } from "./prepare-effect";
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

describe("sale.prepare recovery classification", () => {
  test("definitive pre-effect rejection records the attempt and does not resolve", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("STOCK_CHANGED", "Quoted stock is no longer available", CORRELATION),
      async () => resolution("preparing"),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected stock rejection");
    expect(result.error.code).toBe("STOCK_CHANGED");
    expect(result.error.nextAction).not.toBe("resolve");
    expect(salesPort.prepareCount).toBe(1);
    expect(salesPort.resolveCount).toBe(0);
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic).toMatchObject({
      status: "pending",
      attempts: 1,
      lastErrorCode: "STOCK_CHANGED",
      intentPresent: true,
    });
    expect(diagnostic?.lastAttemptAt).toBe(NOW.toISOString());
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("none");
    const intent = await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY);
    expect(intent?.lines[0]?.sku).toBe("49806");

    const retry = port(
      async () => {
        throw new Error("retry must be allowed on the same key");
      },
      async () => resolution("not_found"),
    );
    await prepareSale({
      store: runtime.store,
      salesPort: retry,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    }).catch(() => undefined);
    expect(retry.prepareCount).toBe(1);
    expect(retry.resolveCount).toBe(1);
  });

  test("unknown prepare response becomes requires_attention with evidence and does not call prepare again", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "Woo did not expose a stock reservation", CORRELATION),
      async () => resolution("preparing", "Woo order create was entered"),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected attention");
    expect(result.error.code).toBe("REQUIRES_ATTENTION");
    expect(result.error.nextAction).toBe("contact_manager");
    expect(salesPort.resolveCount).toBe(1);
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("requires_attention");
    expect(diagnostic?.attempts).toBeGreaterThanOrEqual(1);
    expect(diagnostic?.lastAttemptAt).toBeTruthy();
    expect(diagnostic?.lastErrorCode).toBe("INTEGRATION_UNAVAILABLE");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("unknown");
    expect(diagnostic?.outcome).toMatchObject({
      transactionId: TX,
      idempotencyKey: PREPARE_KEY,
      remoteStatus: "preparing",
    });
    expect(diagnostic?.intentPresent).toBe(true);

    const again = port(
      async () => {
        throw new Error("second prepare must not be sent");
      },
      async () => resolution("requires_attention", "quote snapshot is missing"),
    );
    const second = await prepareSale({
      store: runtime.store,
      salesPort: again,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(again.prepareCount).toBe(0);
    expect(again.resolveCount).toBe(1);
    expect(second.ok).toBe(false);
  });

  test("authoritative remote not_found retires the same attempt", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost response", CORRELATION),
      async () => resolution("not_found"),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not_found");
    expect(result.error.code).toBe("NOT_FOUND");
    expect(result.error.details?.field).toBe("remote_sale");
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("acknowledged");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("not_found");
    expect(diagnostic?.attempts).toBeGreaterThanOrEqual(1);
    expect(diagnostic?.lastErrorCode).toBe("NOT_FOUND");
    expect(await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY)).toBeDefined();
  });

  test("remote prepared recovers the same transaction without a second prepare", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => {
        throw new Error("response lost after prepare");
      },
      async () => resolution("prepared"),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(salesPort.prepareCount).toBe(1);
    expect(salesPort.resolveCount).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected recovered sale");
    expect(result.data.transactionId).toBe(TX);
    expect(result.data.saleId).toBe("sale-50104");
    expect((await runtime.store.getSale(TX))?.prepared.transactionId).toBe(TX);
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("acknowledged");
    expect(diagnostic?.intentPresent).toBe(true);
  });

  test("remote completed without an official receipt stays requires_attention", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost response", CORRELATION),
      async () => resolution("completed"),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected receipt attention");
    expect(result.error.code).toBe("REQUIRES_ATTENTION");
    expect(result.error.details?.field).toBe("receipt_missing");
    expect(result.error.message).toContain("official receipt");
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("requires_attention");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("completed");
    expect(await runtime.store.getSale(TX)).toBeUndefined();
  });

  test("a later status check of an inconclusive prepare records attention instead of staying blank", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost response", CORRELATION),
      async () => resolution("requires_attention", "Woo order exists but the quote snapshot is missing."),
    );
    await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    const checked = await resolveSale({
      store: runtime.store,
      salesPort: {
        async resolve() {
          return resolution("preparing");
        },
      },
      actor: ACTOR,
      transactionId: TX,
      correlationId: CORRELATION,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("expected classified resolution");
    expect(checked.data.status).toBe("requires_attention");
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("requires_attention");
    expect(diagnostic?.attempts).toBeGreaterThanOrEqual(1);
    expect(diagnostic?.lastAttemptAt).toBeTruthy();
    expect(diagnostic?.lastErrorCode).toBeTruthy();
    expect(effectCertaintyOf(diagnostic?.outcome)).not.toBeUndefined();
    expect(diagnostic?.intentPresent).toBe(true);
  });

  test("a later resolve of remote prepared stores the local sale before payment is possible", async () => {
    const runtime = await seed();
    const lost = port(
      async () => {
        throw new Error("response lost");
      },
      async () => resolution("preparing"),
    );
    await prepareSale({
      store: runtime.store,
      salesPort: lost,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    const checked = await resolveSale({
      store: runtime.store,
      salesPort: {
        async resolve() {
          return resolution("prepared");
        },
      },
      actor: ACTOR,
      transactionId: TX,
      correlationId: CORRELATION,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("expected prepared");
    expect(checked.data.status).toBe("prepared");
    const sale = await runtime.store.getSale(TX);
    expect(sale?.prepared.transactionId).toBe(TX);
    expect(sale?.prepared.saleId).toBe("sale-50104");
    expect(sale?.prepared.quoteFingerprint).toBe(FINGERPRINT);
    expect(sale?.lines[0]?.sku).toBe("49806");
    expect(sale?.lines[0]?.name).toBe("6\" Fon Exercise Book");
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("acknowledged");
    expect(diagnostic?.outcome).toMatchObject({ transactionId: TX, saleId: "sale-50104", status: "prepared" });
    expect(diagnostic?.intentPresent).toBe(true);
  });

  test("remote prepared without a sale id does not open a local payment-ready sale", async () => {
    const runtime = await seed();
    const lost = port(
      async () => {
        throw new Error("response lost");
      },
      async () => resolution("preparing"),
    );
    await prepareSale({
      store: runtime.store,
      salesPort: lost,
      catalogLookup: createMemoryCatalogPresentationLookup({ org_a: [] }),
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    const checked = await resolveSale({
      store: runtime.store,
      salesPort: {
        async resolve() {
          return {
            ok: true,
            correlationId: CORRELATION,
            data: { transactionId: TX, status: "prepared" },
          };
        },
      },
      actor: ACTOR,
      transactionId: TX,
      correlationId: CORRELATION,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("expected attention");
    expect(checked.data.status).toBe("requires_attention");
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("requires_attention");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("prepared");
  });

  test("remote finalizing is not stored as an unpaid prepared sale", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost response", CORRELATION),
      async () => ({
        ok: true as const,
        correlationId: CORRELATION,
        data: {
          transactionId: TX,
          status: "finalizing" as const,
          saleId: "sale-50104",
          orderReference: "50104",
          paymentId: PAYMENT,
        },
      }),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    expect(salesPort.prepareCount).toBe(1);
    expect(salesPort.resolveCount).toBe(1);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("requires_attention");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("finalizing");
    expect(diagnostic?.outcome).toMatchObject({ paymentId: PAYMENT, remoteStatus: "finalizing" });
  });

  test("payment_pending records the payment identity and does not create a second prepare", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost response", CORRELATION),
      async () => ({
        ok: true as const,
        correlationId: CORRELATION,
        data: { transactionId: TX, status: "payment_pending" as const, paymentId: PAYMENT, saleId: "sale-50104" },
      }),
    );
    await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    const checked = await resolveSale({
      store: runtime.store,
      salesPort: {
        async resolve() {
          return {
            ok: true as const,
            correlationId: CORRELATION,
            data: { transactionId: TX, status: "payment_pending" as const, paymentId: PAYMENT },
          };
        },
      },
      actor: ACTOR,
      transactionId: TX,
      correlationId: CORRELATION,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("expected payment_pending");
    expect(checked.data.status).toBe("payment_pending");
    expect(checked.data.paymentId).toBe(PAYMENT);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("payment_pending");
    expect(diagnostic?.outcome).toMatchObject({ paymentId: PAYMENT });
  });

  test("cancelled retires the prepare attempt and keeps the intent", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost response", CORRELATION),
      async () => resolution("cancelled", "cancelled remotely"),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected cancelled");
    expect(result.error.details?.field).toBe("sale_cancelled");
    expect(result.error.message).toContain("cart is unchanged");
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("acknowledged");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("cancelled");
    expect(diagnostic?.intentPresent).toBe(true);
    expect(await runtime.store.getQuote("quote-126")).toBeDefined();
  });

  test("proven pre-effect INTEGRATION_UNAVAILABLE does not resolve and can retry the same key", async () => {
    const runtime = await seed();
    const salesPort = port(
      async () => {
        throw new Error("prepare must not be sent");
      },
      async () => {
        throw new Error("resolve must not be called");
      },
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: createMemoryCatalogPresentationLookup({}),
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected pre-effect failure");
    expect(result.error.code).toBe("INTEGRATION_UNAVAILABLE");
    expect(result.error.nextAction).toBe("resolve");
    expect(result.error.details?.field).toBe("pre_effect");
    expect(salesPort.prepareCount).toBe(0);
    expect(salesPort.resolveCount).toBe(0);
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("pending");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("none");

    const retry = port(
      async () => preparedResult(),
      async () => resolution("not_found"),
    );
    const retried = await prepareSale({
      store: runtime.store,
      salesPort: retry,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(retried.ok).toBe(true);
    if (!retried.ok) throw new Error("expected same-key retry");
    expect(retried.data.transactionId).toBe(TX);
    expect(retry.prepareCount).toBe(1);
    expect(retry.resolveCount).toBe(0);
  });

  test("explicit effectCertainty none stays same-key retryable", async () => {
    const runtime = await seed();
    const rejected = port(
      async () => apiFailure("STOCK_CHANGED", "Quoted stock is no longer available", CORRELATION),
      async () => resolution("preparing"),
    );
    await prepareSale({
      store: runtime.store,
      salesPort: rejected,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(effectCertaintyOf((await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY))?.outcome)).toBe("none");
    const retry = port(
      async () => preparedResult(),
      async () => resolution("not_found"),
    );
    const retried = await prepareSale({
      store: runtime.store,
      salesPort: retry,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(retried.ok).toBe(true);
    expect(retry.prepareCount).toBe(1);
    expect(retry.resolveCount).toBe(0);
    expect((await runtime.store.getSale(TX))?.prepared.transactionId).toBe(TX);
  });

  test("a legacy blank pending row with intent resolves once and does not prepare again", async () => {
    const runtime = await seed();
    const presentation = await loadSalePresentation({
      catalogLookup: runtime.catalogLookup,
      organizationId: "org_a",
      quote: quote(),
    });
    expect(presentation.ok).toBe(true);
    if (!presentation.ok) throw new Error("expected presentation");
    const body = request();
    await runtime.store.claimIdempotency(
      "org_a",
      "sale.prepare",
      PREPARE_KEY,
      await sha256Hex(canonicalJson(body)),
      "loc_a1",
      { registerId: "reg_a1", shiftId: SHIFT, transactionId: TX },
    );
    await runtime.store.bindPrepareIntent(
      "org_a",
      "sale.prepare",
      PREPARE_KEY,
      buildPrepareIntentSnapshot({ quote: quote(), transactionId: TX, lines: presentation.lines }),
    );
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic).toMatchObject({
      status: "pending",
      attempts: 0,
      intentPresent: true,
    });
    expect(diagnostic?.lastAttemptAt).toBeUndefined();
    expect(diagnostic?.lastErrorCode).toBeUndefined();
    expect(diagnostic?.outcome).toBeUndefined();
    const salesPort = port(
      async () => {
        throw new Error("legacy pending intent must not resend prepare");
      },
      async () => resolution("requires_attention", "Woo order exists but the quote snapshot is missing."),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: body,
      context: context(),
      now: NOW,
    });
    expect(salesPort.prepareCount).toBe(0);
    expect(salesPort.resolveCount).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected attention");
    expect(result.error.code).toBe("REQUIRES_ATTENTION");
    const after = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(after?.status).toBe("requires_attention");
    expect(after?.attempts).toBeGreaterThanOrEqual(1);
    expect(after?.lastAttemptAt).toBeTruthy();
    expect(after?.intentPresent).toBe(true);
    expect(after?.outcome).toMatchObject({ transactionId: TX, idempotencyKey: PREPARE_KEY });
  });

  test("remote completed loads only an existing official receipt", async () => {
    const runtime = await seed();
    const receipt: ReceiptSnapshot = {
      id: "rcpt-50104",
      transactionId: TX,
      receiptNumber: "POS-50104",
      orderReference: "50104",
      issuedAt: "2026-09-29T22:40:00.000Z",
      locationName: "B2 Shop",
      registerName: "B2 Register",
      cashierName: "Cashier A",
      customerLabel: "Walk-in",
      lines: [],
      subtotal: ghs(500),
      discount: ghs(0),
      tax: ghs(0),
      total: ghs(500),
      tender: "cash",
      documentKind: "operational_pos_receipt",
    };
    expect(await runtime.store.saveReceipt(receipt)).toBe("ok");
    const salesPort = port(
      async () => apiFailure("INTEGRATION_UNAVAILABLE", "lost response", CORRELATION),
      async () => resolution("completed"),
    );
    const result = await prepareSale({
      store: runtime.store,
      salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: request(),
      context: context(),
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected receipt handoff");
    expect(result.error.code).toBe("OPERATION_IN_PROGRESS");
    const checked = await resolveSale({
      store: runtime.store,
      salesPort: {
        async resolve() {
          return resolution("completed");
        },
      },
      actor: ACTOR,
      transactionId: TX,
      correlationId: CORRELATION,
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) throw new Error("expected completed");
    expect(checked.data.status).toBe("completed");
    expect(checked.data.receiptId).toBe("rcpt-50104");
    const diagnostic = await runtime.store.readPrepareDiagnostic("org_a", "sale.prepare", PREPARE_KEY);
    expect(diagnostic?.status).toBe("acknowledged");
    expect(effectCertaintyOf(diagnostic?.outcome)).toBe("completed");
  });
});

function preparedResult(): ApiResult<import("../../../../../docs/contracts/domain.generated").PreparedSale> {
  return {
    ok: true,
    correlationId: CORRELATION,
    data: {
      transactionId: TX,
      saleId: "sale-retry",
      orderReference: "50105",
      quoteFingerprint: FINGERPRINT,
      total: ghs(500),
      status: "prepared",
      stockCommitment: "reserved",
      preparedAt: NOW.toISOString(),
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  };
}
