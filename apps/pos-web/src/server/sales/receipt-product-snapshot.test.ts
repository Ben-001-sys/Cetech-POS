import { describe, expect, test } from "vitest";
import type { Quote, ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import { createInMemoryCheckoutStore } from "../../core/checkout/in-memory-store";
import type { CatalogPresentationItem } from "../../core/receipt/catalog-presentation";
import { createMemoryCatalogPresentationLookup } from "../../core/receipt/catalog-presentation";
import { RECEIPT_DISPLAY_NAME_ELLIPSIS } from "../../core/receipt/display-name";
import { DEFAULT_RECEIPT_SETTINGS } from "../../core/receipt/settings";
import { createMemoryReceiptSettingsStore } from "../../core/receipt/settings-store";
import { apiFailure } from "../http/api-failure";
import { validateCanonicalDef } from "../quotes/canonical-schema";
import { confirmCash } from "./confirm-cash";
import { finalizeSale } from "./finalize-sale";
import { getReceiptByTransaction } from "./get-receipt";
import { createQuoteSnapshotSalesPort } from "./mock-sales-port";
import { prepareSale } from "./prepare-sale";

const CORRELATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee" as const;
const TX = "11111111-1111-4111-8111-111111111111" as const;
const DEVICE = "44444444-4444-4444-8444-444444444444";
const SHIFT = "55555555-5555-4555-8555-555555555555";
const PREPARE_KEY = "22222222-2222-4222-8222-222222222222";
const CASH_KEY = "33333333-3333-4333-8333-333333333333";
const FINALIZE_KEY = "66666666-6666-4666-8666-666666666666";
const FINALIZE_KEY_2 = "77777777-7777-4777-8777-777777777777";
const FINGERPRINT = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-09-18T12:00:00.000Z");
const FULL_NAME = "Armoured Cable 4-Core 25mm Copper Conductor";

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
  const total = ghs(2900);
  const zero = ghs(0);
  return {
    id: "quote-receipt-1",
    fingerprint: FINGERPRINT,
    cartId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    cartRevision: 1,
    customer: { kind: "walkin" },
    locationId: "loc_a1",
    currency: "GHS",
    lines: [
      {
        lineId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        productId: "p-cable",
        variationId: "v-cable-red",
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

function catalogItems(overrides?: Partial<CatalogPresentationItem>): readonly CatalogPresentationItem[] {
  return [
    {
      id: "p-cable",
      name: FULL_NAME,
      sku: "CBL-ARM",
      kind: "variable",
      ...overrides,
    },
    {
      id: "v-cable-red",
      name: FULL_NAME,
      sku: "CBL-ARM-RED",
      kind: "variation",
      parentId: "p-cable",
      variationLabel: "Red",
    },
  ];
}

async function seedRuntime(settings: ReceiptSettings = {
  shortenProductNames: true,
  productNameMaxCharacters: 18,
  showSku: true,
}) {
  const store = createInMemoryCheckoutStore();
  await store.seedRegister({
    id: "reg_a1",
    name: "Front Counter",
    locationId: "loc_a1",
    locationName: "Accra Main Store",
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
  const catalogLookup = createMemoryCatalogPresentationLookup({ org_a: catalogItems() });
  const receiptSettings = createMemoryReceiptSettingsStore([
    { organizationId: "org_a", locationId: "loc_a1", settings },
  ]);
  return { store, catalogLookup, receiptSettings, salesPort: createQuoteSnapshotSalesPort(store) };
}

describe("receipt product-name snapshot", () => {
  test("prepare captures full name without shortening; finalize freezes displayName; reprint ignores later settings and catalog changes", async () => {
    const runtime = await seedRuntime();
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(true);
    expect(runtime.salesPort.prepareCount).toBe(1);
    const sale = await runtime.store.getSale(TX);
    expect(sale?.lines[0]?.name).toBe(FULL_NAME);
    expect(sale?.lines[0]?.displayName).toBeUndefined();
    expect("displayName" in (sale?.lines[0] ?? {})).toBe(false);
    expect(sale?.lines[0]?.sku).toBe("CBL-ARM-RED");
    expect(sale?.lines[0]?.variationLabel).toBe("Red");
    expect(sale?.lines[0]?.name).not.toBe("p-cable");
    expect(validateCanonicalDef("ReceiptLine", sale?.lines[0])).toBe(true);

    const replay = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(replay.ok).toBe(true);
    expect(runtime.salesPort.prepareCount).toBe(1);

    const cash = await confirmCash({
      store: runtime.store,
      actor: ACTOR,
      request: { transactionId: TX, cashReceived: ghs(4000) },
      context: { idempotencyKey: CASH_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(cash.ok).toBe(true);
    if (!cash.ok) {
      throw new Error("expected cash");
    }

    const firstFinalize = await finalizeSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      receiptSettings: runtime.receiptSettings,
      actor: ACTOR,
      request: { transactionId: TX, paymentId: cash.data.paymentId },
      context: { idempotencyKey: FINALIZE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(firstFinalize.ok).toBe(true);
    if (!firstFinalize.ok || firstFinalize.data.status !== "completed") {
      throw new Error("expected completed finalize");
    }

    const firstReceipt = await getReceiptByTransaction({
      store: runtime.store,
      actor: ACTOR,
      transactionId: TX,
      context: { correlationId: CORRELATION },
    });
    expect(firstReceipt.ok).toBe(true);
    if (!firstReceipt.ok) {
      throw new Error("expected receipt");
    }
    expect(validateCanonicalDef("ReceiptSnapshot", firstReceipt.data)).toBe(true);
    expect(firstReceipt.data.lines[0]?.name).toBe(FULL_NAME);
    expect(firstReceipt.data.lines[0]?.displayName).toBe(`Armoured Cable 4-${RECEIPT_DISPLAY_NAME_ELLIPSIS}`);
    expect(firstReceipt.data.lines[0]?.sku).toBe("CBL-ARM-RED");
    const frozen = structuredClone(firstReceipt.data);

    runtime.catalogLookup.seed("org_a", catalogItems({ name: "CHANGED CATALOG NAME", sku: "CHANGED-SKU" }));
    await runtime.receiptSettings.upsert("org_a", "loc_a1", {
      ...DEFAULT_RECEIPT_SETTINGS,
      shortenProductNames: false,
      showSku: false,
      productNameMaxCharacters: 8,
    });

    const reprint = await getReceiptByTransaction({
      store: runtime.store,
      actor: ACTOR,
      transactionId: TX,
      context: { correlationId: CORRELATION },
    });
    expect(reprint.ok).toBe(true);
    if (!reprint.ok) {
      throw new Error("expected reprint");
    }
    expect(reprint.data).toEqual(frozen);
    expect(reprint.data.lines[0]?.name).toBe(FULL_NAME);
    expect(reprint.data.lines[0]?.displayName).toBe(frozen.lines[0]?.displayName);
    expect(reprint.data.lines[0]?.sku).toBe("CBL-ARM-RED");

    const secondFinalize = await finalizeSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      receiptSettings: runtime.receiptSettings,
      actor: ACTOR,
      request: { transactionId: TX, paymentId: cash.data.paymentId },
      context: { idempotencyKey: FINALIZE_KEY_2, correlationId: CORRELATION },
      now: NOW,
    });
    expect(secondFinalize.ok).toBe(true);
    if (secondFinalize.ok && secondFinalize.data.status === "completed") {
      expect(secondFinalize.data.receiptId).toBe(firstFinalize.data.receiptId);
    }

    const foreign = await getReceiptByTransaction({
      store: runtime.store,
      actor: { ...ACTOR, organizationId: "org_b", locationIds: ["loc_b1"] },
      transactionId: TX,
      context: { correlationId: CORRELATION },
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.error.code).toBe("FORBIDDEN");
    }

    const otherLocation = await getReceiptByTransaction({
      store: runtime.store,
      actor: { ...ACTOR, locationIds: ["loc_a2"] },
      transactionId: TX,
      context: { correlationId: CORRELATION },
    });
    expect(otherLocation.ok).toBe(false);
    if (!otherLocation.ok) {
      expect(otherLocation.error.code).toBe("FORBIDDEN");
    }
  });

  test("missing catalog presentation fails closed instead of storing productId as the name", async () => {
    const runtime = await seedRuntime();
    expect(runtime.salesPort.prepareCount).toBe(0);
    const emptyCatalog = createMemoryCatalogPresentationLookup();
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: emptyCatalog,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.error.code).toBe("INTEGRATION_UNAVAILABLE");
    }
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    expect(runtime.salesPort.prepareCount).toBe(0);
  });

  test("lost-response recovery persists presentation without a second commercial prepare", async () => {
    const runtime = await seedRuntime();
    const inner = runtime.salesPort;
    const dropping = {
      get prepareCount() {
        return inner.prepareCount;
      },
      prepare: async (
        request: Parameters<typeof inner.prepare>[0],
        context: Parameters<typeof inner.prepare>[1],
      ) => {
        await inner.prepare(request, context);
        throw new Error("injected lost prepare response");
      },
      resolve: inner.resolve.bind(inner),
    };
    const recovered = await prepareSale({
      store: runtime.store,
      salesPort: dropping,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) {
      throw new Error("expected recovered prepare");
    }
    expect(inner.prepareCount).toBe(1);
    const sale = await runtime.store.getSale(TX);
    expect(sale?.prepared.saleId).toBe(recovered.data.saleId);
    expect(sale?.lines[0]?.name).toBe(FULL_NAME);
    expect(sale?.lines[0]?.displayName).toBeUndefined();
    expect(sale?.lines[0]?.sku).toBe("CBL-ARM-RED");

    const replay = await prepareSale({
      store: runtime.store,
      salesPort: inner,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(replay.ok).toBe(true);
    expect(inner.prepareCount).toBe(1);
  });

  test("receipt shortening and showSku apply at finalize, not prepare", async () => {
    const runtime = await seedRuntime(DEFAULT_RECEIPT_SETTINGS);
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(true);
    const sale = await runtime.store.getSale(TX);
    expect(sale?.lines[0]?.name).toBe(FULL_NAME);
    expect(sale?.lines[0]?.displayName).toBeUndefined();
    expect(sale?.lines[0]?.sku).toBe("CBL-ARM-RED");

    await runtime.receiptSettings.upsert("org_a", "loc_a1", {
      shortenProductNames: true,
      productNameMaxCharacters: 18,
      showSku: true,
    });

    const cash = await confirmCash({
      store: runtime.store,
      actor: ACTOR,
      request: { transactionId: TX, cashReceived: ghs(4000) },
      context: { idempotencyKey: CASH_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(cash.ok).toBe(true);
    if (!cash.ok) {
      throw new Error("expected cash");
    }

    const finalized = await finalizeSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      receiptSettings: runtime.receiptSettings,
      actor: ACTOR,
      request: { transactionId: TX, paymentId: cash.data.paymentId },
      context: { idempotencyKey: FINALIZE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(finalized.ok).toBe(true);
    const receipt = await getReceiptByTransaction({
      store: runtime.store,
      actor: ACTOR,
      transactionId: TX,
      context: { correlationId: CORRELATION },
    });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) {
      throw new Error("expected receipt");
    }
    expect(receipt.data.lines[0]?.name).toBe(FULL_NAME);
    expect(receipt.data.lines[0]?.displayName).toBe(`Armoured Cable 4-${RECEIPT_DISPLAY_NAME_ELLIPSIS}`);
    expect(receipt.data.lines[0]?.sku).toBe("CBL-ARM-RED");
    expect(receipt.data.locationName).toBe("Accra Main Store");
    expect(receipt.data.registerName).toBe("Front Counter");
    expect(receipt.data.locationName).not.toContain("loc_");
    expect(sale?.lines[0]?.displayName).toBeUndefined();
    await runtime.store.seedRegister({
      id: "reg_a1",
      name: "Renamed Counter",
      locationId: "loc_a1",
      locationName: "Renamed Store",
      currency: "GHS",
      status: "active",
      organizationId: "org_a",
    });
    const historic = await getReceiptByTransaction({
      store: runtime.store,
      actor: ACTOR,
      transactionId: TX,
      context: { correlationId: CORRELATION },
    });
    expect(historic.ok).toBe(true);
    if (!historic.ok) throw new Error("expected historic receipt");
    expect(historic.data).toEqual(receipt.data);
    expect(historic.data.locationName).toBe("Accra Main Store");
  });

  test("legacy receipt without displayName still deserializes", () => {
    const legacy = {
      id: "rcpt-legacy",
      transactionId: TX,
      receiptNumber: "POS-woo-1",
      orderReference: "woo-1",
      issuedAt: "2026-09-15T12:02:00.000Z",
      locationName: "loc_a1",
      registerName: "Register 1",
      cashierName: "Cashier A",
      customerLabel: "Walk-in",
      lines: [
        {
          name: "p-hardener",
          quantity: "1",
          unitPrice: ghs(1500),
          subtotal: ghs(1500),
          discount: ghs(0),
          tax: ghs(0),
          total: ghs(1500),
        },
      ],
      subtotal: ghs(1500),
      discount: ghs(0),
      tax: ghs(0),
      total: ghs(1500),
      tender: "cash",
      documentKind: "operational_pos_receipt",
    };
    expect(validateCanonicalDef("ReceiptSnapshot", legacy)).toBe(true);
  });

  test("lost-response recovery reuses durable presentation A after catalog mutates to B", async () => {
    const runtime = await seedRuntime();
    const inner = runtime.salesPort;
    const dropping = {
      get prepareCount() {
        return inner.prepareCount;
      },
      prepare: async (
        request: Parameters<typeof inner.prepare>[0],
        context: Parameters<typeof inner.prepare>[1],
      ) => {
        await inner.prepare(request, context);
        runtime.catalogLookup.seed("org_a", [
          { id: "p-cable", name: "CHANGED PARENT NAME", sku: "CHANGED-PARENT-SKU", kind: "variable" },
          {
            id: "v-cable-red",
            name: "CHANGED VARIATION NAME",
            sku: "CHANGED-VAR-SKU",
            kind: "variation",
            parentId: "p-cable",
            variationLabel: "Changed",
          },
        ]);
        throw new Error("injected lost prepare response");
      },
      resolve: inner.resolve.bind(inner),
    };
    const recovered = await prepareSale({
      store: runtime.store,
      salesPort: dropping,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) {
      throw new Error("expected recovered prepare from durable intent A");
    }
    expect(inner.prepareCount).toBe(1);
    const sale = await runtime.store.getSale(TX);
    expect(sale?.lines[0]?.name).toBe(FULL_NAME);
    expect(sale?.lines[0]?.sku).toBe("CBL-ARM-RED");
    expect(sale?.lines[0]?.variationLabel).toBe("Red");
    expect(sale?.lines[0]?.name).not.toBe("CHANGED VARIATION NAME");
    expect(sale?.lines[0]?.sku).not.toBe("CHANGED-VAR-SKU");
    expect(sale?.lines[0]?.displayName).toBeUndefined();
    const intent = await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY);
    expect(intent?.lines[0]?.name).toBe(FULL_NAME);
    expect(intent?.lines[0]?.sku).toBe("CBL-ARM-RED");
    const replay = await prepareSale({
      store: runtime.store,
      salesPort: inner,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(replay.ok).toBe(true);
    expect(inner.prepareCount).toBe(1);
  });

  test("durable intent write failure occurs before SalesPort.prepare", async () => {
    const runtime = await seedRuntime();
    runtime.store.failNextIntentWrite = true;
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.error.code).toBe("INTEGRATION_UNAVAILABLE");
    }
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    expect(runtime.salesPort.prepareCount).toBe(0);
    expect(await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY)).toBeUndefined();
  });

  test("variation without SKU and missing parent fails closed with no commercial prepare", async () => {
    const runtime = await seedRuntime();
    const catalogLookup = createMemoryCatalogPresentationLookup({
      org_a: [
        {
          id: "v-cable-red",
          name: FULL_NAME,
          kind: "variation",
          parentId: "p-cable",
          variationLabel: "Red",
        },
      ],
    });
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(false);
    if (!prepared.ok) {
      expect(prepared.error.code).toBe("INTEGRATION_UNAVAILABLE");
    }
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    expect(runtime.salesPort.prepareCount).toBe(0);
  });

  test("variation SKU absent uses parent SKU when parent presentation exists", async () => {
    const runtime = await seedRuntime();
    runtime.catalogLookup.seed("org_a", [
      { id: "p-cable", name: FULL_NAME, sku: "CBL-ARM", kind: "variable" },
      {
        id: "v-cable-red",
        name: FULL_NAME,
        kind: "variation",
        parentId: "p-cable",
        variationLabel: "Red",
      },
    ]);
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(true);
    expect(runtime.salesPort.prepareCount).toBe(1);
    const sale = await runtime.store.getSale(TX);
    expect(sale?.lines[0]?.sku).toBe("CBL-ARM");
  });

  test("variation SKU absent and parent without SKU omits SKU without failing prepare", async () => {
    const runtime = await seedRuntime();
    runtime.catalogLookup.seed("org_a", [
      { id: "p-cable", name: FULL_NAME, kind: "variable" },
      {
        id: "v-cable-red",
        name: FULL_NAME,
        kind: "variation",
        parentId: "p-cable",
        variationLabel: "Red",
      },
    ]);
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(true);
    const sale = await runtime.store.getSale(TX);
    expect(sale?.lines[0]?.sku).toBeUndefined();
    expect("sku" in (sale?.lines[0] ?? {})).toBe(false);
    expect(runtime.salesPort.prepareCount).toBe(1);
  });

  test("same-key different request hash cannot reuse durable presentation", async () => {
    const runtime = await seedRuntime();
    const failingPort = {
      prepareCount: 0,
      prepare: async () => {
        failingPort.prepareCount += 1;
        return apiFailure("INTEGRATION_UNAVAILABLE", "woo down", CORRELATION);
      },
      resolve: runtime.salesPort.resolve.bind(runtime.salesPort),
    };
    const first = await prepareSale({
      store: runtime.store,
      salesPort: failingPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(first.ok).toBe(false);
    expect(failingPort.prepareCount).toBe(1);
    const intent = await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY);
    expect(intent?.lines[0]?.name).toBe(FULL_NAME);
    const conflict = await prepareSale({
      store: runtime.store,
      salesPort: failingPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: "11111111-1111-4111-8111-111111111112",
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("IDEMPOTENCY_CONFLICT");
    }
    expect(failingPort.prepareCount).toBe(1);
    expect(await runtime.store.getSale(TX)).toBeUndefined();
    expect((await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY))?.lines[0]?.name).toBe(FULL_NAME);
  });

  test("cross-organization actors cannot read another operation intent", async () => {
    const runtime = await seedRuntime();
    const prepared = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(prepared.ok).toBe(true);
    expect(await runtime.store.getPrepareIntent("org_b", "sale.prepare", PREPARE_KEY)).toBeUndefined();
    expect(await runtime.store.getPrepareIntent("org_a", "sale.prepare", PREPARE_KEY)).toMatchObject({
      quoteId: "quote-receipt-1",
      lines: [{ name: FULL_NAME, sku: "CBL-ARM-RED" }],
    });
    const foreign = await prepareSale({
      store: runtime.store,
      salesPort: runtime.salesPort,
      catalogLookup: runtime.catalogLookup,
      actor: { ...ACTOR, organizationId: "org_b", locationIds: ["loc_b1"] },
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) {
      expect(foreign.error.code).toBe("FORBIDDEN");
    }
    expect(runtime.salesPort.prepareCount).toBe(1);
  });

  test("lost-response recovery without durable intent fails closed instead of refreshing the catalog", async () => {
    const runtime = await seedRuntime();
    const innerStore = runtime.store;
    let hideIntent = false;
    const store = new Proxy(innerStore, {
      get(target, prop, receiver) {
        if (prop === "getPrepareIntent") {
          return async (
            organizationId: Parameters<typeof innerStore.getPrepareIntent>[0],
            operation: Parameters<typeof innerStore.getPrepareIntent>[1],
            idempotencyKey: Parameters<typeof innerStore.getPrepareIntent>[2],
          ) => {
            if (hideIntent) {
              return undefined;
            }
            return target.getPrepareIntent(organizationId, operation, idempotencyKey);
          };
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const inner = runtime.salesPort;
    const dropping = {
      get prepareCount() {
        return inner.prepareCount;
      },
      prepare: async (
        request: Parameters<typeof inner.prepare>[0],
        context: Parameters<typeof inner.prepare>[1],
      ) => {
        await inner.prepare(request, context);
        hideIntent = true;
        runtime.catalogLookup.seed("org_a", catalogItems({ name: "CHANGED CATALOG NAME", sku: "CHANGED-SKU" }));
        throw new Error("injected lost prepare response");
      },
      resolve: inner.resolve.bind(inner),
    };
    const recovered = await prepareSale({
      store,
      salesPort: dropping,
      catalogLookup: runtime.catalogLookup,
      actor: ACTOR,
      request: {
        transactionId: TX,
        registerId: "reg_a1",
        shiftId: SHIFT,
        deviceId: DEVICE,
        quoteId: "quote-receipt-1",
        quoteFingerprint: FINGERPRINT,
      },
      context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(recovered.ok).toBe(false);
    if (!recovered.ok) {
      expect(recovered.error.code).toBe("REQUIRES_ATTENTION");
    }
    expect(inner.prepareCount).toBe(1);
    expect(await innerStore.getSale(TX)).toBeUndefined();
  });
});

async function preparePaidReceiptRuntime(settings: ReceiptSettings, phone?: string) {
  const runtime = await seedRuntime(settings);
  const customerSnapshot = phone === undefined ? undefined : {
    id: "customer_1", kind: "retail" as const, displayName: "Customer Original", phoneMasked: phone,
  };
  if (customerSnapshot) {
    await runtime.store.saveQuote({ ...quote(), customer: { kind: "retail", customerId: customerSnapshot.id } });
  }
  const prepared = await prepareSale({
    store: runtime.store, salesPort: runtime.salesPort, catalogLookup: runtime.catalogLookup, actor: ACTOR,
    request: { transactionId: TX, registerId: "reg_a1", shiftId: SHIFT, deviceId: DEVICE,
      quoteId: "quote-receipt-1", quoteFingerprint: FINGERPRINT,
      ...(customerSnapshot ? { customerSnapshot } : {}),
    },
    context: { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION }, now: NOW,
  });
  if (!prepared.ok) throw new Error("expected prepare");
  const cash = await confirmCash({
    store: runtime.store, actor: ACTOR, request: { transactionId: TX, cashReceived: ghs(4000) },
    context: { idempotencyKey: CASH_KEY, correlationId: CORRELATION }, now: NOW,
  });
  if (!cash.ok) throw new Error("expected cash");
  return { ...runtime, paymentId: cash.data.paymentId, customerSnapshot };
}

describe("versioned reference receipt snapshot", () => {
  test("freezes configured presentation and existing masked customer phone without a later live lookup", async () => {
    const presentation = { templateVersion: 1 as const, businessName: "CETECH Tema", footerMessage: "Original footer", showCashier: false };
    const settings = { ...DEFAULT_RECEIPT_SETTINGS, presentation };
    const runtime = await preparePaidReceiptRuntime(settings, "024 *** 1234");
    const result = await finalizeSale({
      ...runtime, actor: ACTOR,
      receiptSettings: { ...runtime.receiptSettings, async get() { return settings; } },
      request: { transactionId: TX, paymentId: runtime.paymentId },
      context: { idempotencyKey: FINALIZE_KEY, correlationId: CORRELATION }, now: NOW,
    });
    expect(result.ok && result.data.status).toBe("completed");
    const stored = await runtime.store.getReceipt(TX);
    expect(stored?.presentation).toMatchObject({ templateVersion: 1, businessName: "CETECH Tema", footerMessage: "Original footer", showCashier: false, showCustomerPhone: true });
    expect(stored?.presentation).not.toBe(presentation);
    expect(stored?.customerPhone).toBe("024 *** 1234");
    expect(stored?.customerLabel).toBe("Customer Original");
    expect(validateCanonicalDef("ReceiptSnapshot", stored)).toBe(true);
    const frozen = structuredClone(stored);
    presentation.businessName = "Changed business";
    presentation.footerMessage = "Changed footer";
    Object.assign(runtime.customerSnapshot!, { phoneMasked: "Changed phone", displayName: "Changed customer" });
    await runtime.receiptSettings.upsert("org_a", "loc_a1", { ...DEFAULT_RECEIPT_SETTINGS, presentation });
    const reprint = await getReceiptByTransaction({ store: runtime.store, actor: ACTOR, transactionId: TX, context: { correlationId: CORRELATION } });
    expect(reprint.ok && reprint.data).toEqual(frozen);
    const finalizedAgain = await finalizeSale({
      ...runtime, actor: ACTOR,
      receiptSettings: { ...runtime.receiptSettings, async get() { throw new Error("must not read live settings"); } },
      request: { transactionId: TX, paymentId: runtime.paymentId },
      context: { idempotencyKey: FINALIZE_KEY_2, correlationId: CORRELATION }, now: NOW,
    });
    expect(finalizedAgain.ok && finalizedAgain.data.status).toBe("completed");
    expect(await runtime.store.getReceipt(TX)).toEqual(frozen);
  });

  test("new sales without configured branding freeze defaults and omit unavailable phone", async () => {
    const runtime = await preparePaidReceiptRuntime(DEFAULT_RECEIPT_SETTINGS);
    const result = await finalizeSale({ ...runtime, actor: ACTOR,
      request: { transactionId: TX, paymentId: runtime.paymentId },
      context: { idempotencyKey: FINALIZE_KEY, correlationId: CORRELATION }, now: NOW,
    });
    expect(result.ok && result.data.status).toBe("completed");
    const stored = await runtime.store.getReceipt(TX);
    expect(stored?.presentation).toEqual({ templateVersion: 1, businessName: "CETECH", footerMessage: "Thank You For Purchasing", showCustomerName: true, showCustomerPhone: true, showCashier: true });
    expect(stored).not.toHaveProperty("customerPhone");
  });

  test("available phone presentation is bounded to eighty characters", async () => {
    const runtime = await preparePaidReceiptRuntime(DEFAULT_RECEIPT_SETTINGS, "0".repeat(100));
    const result = await finalizeSale({ ...runtime, actor: ACTOR,
      request: { transactionId: TX, paymentId: runtime.paymentId },
      context: { idempotencyKey: FINALIZE_KEY, correlationId: CORRELATION }, now: NOW,
    });
    expect(result.ok && result.data.status).toBe("completed");
    expect((await runtime.store.getReceipt(TX))?.customerPhone).toBe("0".repeat(80));
  });
});

test("a stored legacy receipt stays versionless during finalize recovery and reprint", async () => {
  const runtime = await preparePaidReceiptRuntime(DEFAULT_RECEIPT_SETTINGS);
  const sale = await runtime.store.getSale(TX);
  if (!sale) throw new Error("expected sale");
  const legacy = {
    id: "rcpt-legacy-frozen", transactionId: TX, receiptNumber: "POS-legacy", orderReference: sale.prepared.orderReference,
    issuedAt: NOW.toISOString(), locationName: sale.locationName, registerName: sale.registerName,
    cashierName: sale.cashierName, customerLabel: sale.customerLabel, lines: sale.lines,
    subtotal: sale.subtotal, discount: sale.discount, tax: sale.tax, total: sale.prepared.total,
    tender: "cash" as const, documentKind: "operational_pos_receipt" as const,
  };
  await runtime.store.saveReceipt(legacy);
  const result = await finalizeSale({ ...runtime, actor: ACTOR,
    receiptSettings: { ...runtime.receiptSettings, async get() { throw new Error("legacy receipt must not read current settings"); } },
    request: { transactionId: TX, paymentId: runtime.paymentId },
    context: { idempotencyKey: FINALIZE_KEY, correlationId: CORRELATION }, now: NOW,
  });
  expect(result.ok && result.data.status).toBe("completed");
  const reprint = await getReceiptByTransaction({ store: runtime.store, actor: ACTOR, transactionId: TX, context: { correlationId: CORRELATION } });
  expect(reprint.ok && reprint.data).toEqual(legacy);
  expect(reprint.ok && reprint.data).not.toHaveProperty("presentation");
  expect(reprint.ok && reprint.data).not.toHaveProperty("customerPhone");
});
