import "fake-indexeddb/auto";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { PreparedSale, PrepareSaleRequest } from "../../../../docs/contracts/domain.generated";
import { createCheckoutAttemptStore, type CheckoutAttemptRecord } from "../features/sell/runtime/checkout-attempt-store";
import { createOperationJournal, deletePosLocalDatabase, openPosLocalDatabase } from "../local";
import { createBrowserCheckoutUseCases, createBrowserSalesResolvePort } from "./checkout-client";
import { loadLocalJournalAttentionItems, recoverAttentionItem, type LocalRecoveryContext } from "./attention-recovery";
import { canOfferOriginalPrepareRepair, loadOriginalPrepareRepair, repairOriginalPrepare, shouldDeferOriginalPrepareAcknowledgement } from "./attention-prepare-repair";

const TX = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const CORR = "33333333-3333-4333-8333-333333333333";
const SHIFT = "44444444-4444-4444-8444-444444444444";
const DEVICE = "55555555-5555-4555-8555-555555555555";
const context: LocalRecoveryContext = { organizationId: "org-a", actorId: "cashier-a", registerId: "reg-a", deviceId: DEVICE };
const request: PrepareSaleRequest = {
  transactionId: TX, registerId: context.registerId, shiftId: SHIFT, deviceId: DEVICE,
  quoteId: "original-quote", quoteFingerprint: "0123456789abcdef0123456789abcdef",
  customerSnapshot: { id: "customer-a", kind: "retail", displayName: "Original customer", phoneMasked: "***1234" },
};
const attempt: CheckoutAttemptRecord = {
  transactionId: TX, registerId: context.registerId, shiftId: SHIFT, deviceId: DEVICE,
  quoteId: request.quoteId, quoteFingerprint: request.quoteFingerprint, quoteTotalMinor: 1000, currency: "GHS",
  prepareKey: KEY, prepareCorrelationId: CORR,
  cashKey: "66666666-6666-4666-8666-666666666666", cashCorrelationId: CORR,
  finalizeKey: "77777777-7777-4777-8777-777777777777", finalizeCorrelationId: CORR,
  stage: "finalize_failed", saleCompleted: false, message: "Original sale needs recovery",
};
const prepared: PreparedSale = {
  transactionId: TX, saleId: "sale-existing", orderReference: "original-order",
  quoteFingerprint: request.quoteFingerprint, total: { minor: 1000, currency: "GHS" },
  status: "prepared", stockCommitment: "reserved", preparedAt: "2026-10-03T03:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
};
const names: string[] = [];
afterEach(async () => { await Promise.all(names.splice(0).map(deletePosLocalDatabase)); });

async function setup() {
  const name = `attention-original-prepare-${crypto.randomUUID()}`;
  names.push(name);
  const db = openPosLocalDatabase(name);
  const journal = createOperationJournal(db, { createdByActorId: context.actorId, organizationId: context.organizationId, registerId: context.registerId, deviceId: DEVICE });
  await createBrowserCheckoutUseCases({ journal, fetchImpl: async () => { throw new TypeError("lost original response"); } })
    .prepare(request, { idempotencyKey: KEY, correlationId: CORR });
  const store = createCheckoutAttemptStore(db);
  await store.write(attempt);
  const [item] = await loadLocalJournalAttentionItems(journal, context, db);
  const input = { db, journal, item: item!, context, shiftId: SHIFT };
  return { ...input, store };
}

describe("explicit repair of the original durable prepare", () => {
  test("a delayed prepared GET cannot acknowledge the old actor's journal after the sign-in and active attempt change", async () => {
    const { journal, store, ...input } = await setup();
    let current = true;
    let release!: () => void;
    let started!: () => void;
    const inFlight = new Promise<void>((resolve) => { started = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const port = createBrowserSalesResolvePort({
      journal,
      fetchImpl: async () => {
        started();
        await gate;
        return new Response(JSON.stringify({ ok: true, correlationId: CORR, data: { transactionId: TX, status: "prepared", saleId: prepared.saleId, orderReference: prepared.orderReference } }));
      },
      shouldDeferPreparedAcknowledgement: (transactionId) => shouldDeferOriginalPrepareAcknowledgement({ ...input, transactionId, isCurrent: () => current }),
    });
    const pendingRead = port.resolve(TX);
    await inFlight;
    current = false;
    const replacement = { ...attempt, transactionId: SHIFT, prepareKey: attempt.cashKey };
    await store.write(replacement);
    release();
    expect((await pendingRead).ok).toBe(true);
    expect((await journal.pending())[0]?.status).toBe("response_unknown");
    expect((await journal.pending())[0]?.idempotencyKey).toBe(KEY);
    expect(store.readSync()).toEqual(replacement);
  });

  test("stale context does not change generic reconciliation for a non-prepare local row", async () => {
    const { journal: _journal, store: _store, ...input } = await setup();
    void _journal; void _store;
    await input.db.journal.update(KEY, { operation: "sale.finalize" });
    expect(await shouldDeferOriginalPrepareAcknowledgement({ ...input, transactionId: TX, isCurrent: () => false })).toBe(false);
    expect(await shouldDeferOriginalPrepareAcknowledgement({ ...input, item: { ...input.item, id: `sale:${TX}` }, transactionId: TX, isCurrent: () => false })).toBe(false);
  });

  test("a fully persisted prepare with a lost HTTP response resumes only after explicit original-key replay", async () => {
    const { journal, store, ...input } = await setup();
    const calls: { url: string; method: string; body?: unknown; key: string | null }[] = [];
    let persisted: PreparedSale | undefined;
    const fetchImpl: typeof fetch = async (url, options) => {
      const method = options?.method ?? "GET";
      calls.push({ url: String(url), method, ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}), key: new Headers(options?.headers).get("idempotency-key") });
      if (method === "GET" && String(url) === `/api/pos/v1/sales/${TX}` && persisted) return new Response(JSON.stringify({
        ok: true, correlationId: CORR, data: { transactionId: TX, status: "prepared", saleId: persisted.saleId, orderReference: persisted.orderReference },
      }));
      if (method !== "POST" || String(url) !== "/api/pos/v1/sales/prepare") throw new Error("unexpected effect");
      if (!persisted) {
        persisted = prepared;
        throw new TypeError("HTTP response lost after POS persistence");
      }
      return new Response(JSON.stringify({ ok: true, correlationId: CORR, data: persisted }));
    };
    const checkout = createBrowserCheckoutUseCases({ journal, fetchImpl, preserveUnresolvedOnFailure: true, deferSuccessfulAcknowledgement: true });
    expect((await repairOriginalPrepare({ ...input, checkout, isCurrent: () => true })).status).toBe("failed");
    expect(store.readSync()).toEqual(attempt);
    const check = await recoverAttentionItem(input.item, { payments: { resolve: vi.fn() }, sales: createBrowserSalesResolvePort({
      journal, fetchImpl,
      shouldDeferPreparedAcknowledgement: async (transactionId) => transactionId === TX && Boolean(await loadOriginalPrepareRepair(input)),
    }) });
    expect(canOfferOriginalPrepareRepair(check, TX)).toBe(true);
    expect((await journal.pending())[0]?.status).toBe("response_unknown");
    expect(store.readSync()).toEqual(attempt); // Status lookup alone does not open payment.
    expect(calls).toHaveLength(2);
    expect((await repairOriginalPrepare({ ...input, checkout, isCurrent: () => true })).status).toBe("ready");
    expect(calls).toEqual([
      { url: "/api/pos/v1/sales/prepare", method: "POST", body: request, key: KEY },
      { url: `/api/pos/v1/sales/${TX}`, method: "GET", key: null },
      { url: "/api/pos/v1/sales/prepare", method: "POST", body: request, key: KEY },
    ]);
    expect(store.readSync()).toMatchObject({ ...attempt, stage: "choose_payment", message: "", prepared: { transactionId: TX, total: prepared.total } });
    expect(await journal.pending()).toHaveLength(0);
    expect(await input.db.journal.count()).toBe(1);
  });

  test("prepared status with payment/receipt evidence or a different identity never offers an original resume", () => {
    const data = { transactionId: TX, status: "prepared" as const, saleId: prepared.saleId, orderReference: prepared.orderReference };
    const outcome = (extra: Record<string, string>) => ({ status: "attempted" as const, kind: "sale" as const, result: { ok: true as const, correlationId: CORR, data: { ...data, ...extra } } });
    expect(canOfferOriginalPrepareRepair(outcome({ paymentId: attempt.cashKey }), TX)).toBe(false);
    expect(canOfferOriginalPrepareRepair(outcome({ receiptId: "existing-receipt" }), TX)).toBe(false);
    expect(canOfferOriginalPrepareRepair(outcome({ transactionId: SHIFT }), TX)).toBe(false);
    expect(canOfferOriginalPrepareRepair(outcome({ saleId: "" }), TX)).toBe(false);
  });

  test.each([
    "The stored quote is no longer valid, so this prepared sale cannot be opened for payment. Current catalog data was not used.",
    "The remote sale is prepared, but it could not be stored for payment.",
  ])("a lost original repair response can be checked and explicitly replayed with the same key: %s", async (message) => {
    const { journal, store, ...input } = await setup();
    const commands: { url: string; method: string; body?: unknown; key: string | null }[] = [];
    let prepareCount = 0;
    const fetchImpl: typeof fetch = async (url, options) => {
      const method = options?.method ?? "GET";
      commands.push({ url: String(url), method, ...(options?.body ? { body: JSON.parse(String(options.body)) } : {}), key: new Headers(options?.headers).get("idempotency-key") });
      if (method === "GET" && String(url) === `/api/pos/v1/sales/${TX}`) return new Response(JSON.stringify({ ok: true, correlationId: CORR, data: { transactionId: TX, status: "requires_attention", message } }));
      if (method !== "POST" || String(url) !== "/api/pos/v1/sales/prepare") throw new Error("unexpected effect");
      prepareCount += 1;
      if (prepareCount === 1) throw new TypeError("original repair response lost");
      return new Response(JSON.stringify({ ok: true, correlationId: CORR, data: prepared }));
    };
    const checkout = createBrowserCheckoutUseCases({ journal, fetchImpl, preserveUnresolvedOnFailure: true, deferSuccessfulAcknowledgement: true });
    expect((await repairOriginalPrepare({ ...input, checkout, isCurrent: () => true })).status).toBe("failed");
    expect(store.readSync()).toEqual(attempt);
    const check = await recoverAttentionItem(input.item, { payments: { resolve: vi.fn() }, sales: createBrowserSalesResolvePort({ journal, fetchImpl }) });
    expect(canOfferOriginalPrepareRepair(check)).toBe(true);
    expect(await loadOriginalPrepareRepair(input)).toMatchObject({ request, idempotencyKey: KEY });
    expect(prepareCount).toBe(1); // A status check never silently retries the mutation.
    expect((await repairOriginalPrepare({ ...input, checkout, isCurrent: () => true })).status).toBe("ready");
    expect(commands).toEqual([
      { url: "/api/pos/v1/sales/prepare", method: "POST", body: request, key: KEY },
      { url: `/api/pos/v1/sales/${TX}`, method: "GET", key: null },
      { url: "/api/pos/v1/sales/prepare", method: "POST", body: request, key: KEY },
    ]);
    expect(store.readSync()).toMatchObject({ ...attempt, stage: "choose_payment", message: "", prepared: { transactionId: TX, total: prepared.total } });
    expect(await journal.pending()).toHaveLength(0);
    expect(await input.db.journal.count()).toBe(1);
  });

  test.each([
    "This transaction needs manager review. Do not start another sale.",
    "Durable sale-time presentation is missing, so this prepared sale cannot be opened for payment.",
    "Durable sale-time presentation does not match the stored quote, so payment stays closed.",
    "This prepared sale cannot be opened for payment from the stored quote and register. Current catalog data was not used.",
  ])("does not offer a retry for unrelated or unsafe diagnostics: %s", (message) => {
    expect(canOfferOriginalPrepareRepair({ status: "attempted", kind: "sale", result: { ok: true, correlationId: CORR, data: { transactionId: TX, status: "requires_attention", message } } })).toBe(false);
  });

  test("replays the original body/key and resumes the original attempt without any payment or finalization request", async () => {
    const { journal, store, ...input } = await setup();
    const before = await input.db.journal.get(KEY);
    const calls: { url: string; body: unknown; key: string | null }[] = [];
    const checkout = createBrowserCheckoutUseCases({ journal, preserveUnresolvedOnFailure: true, deferSuccessfulAcknowledgement: true, fetchImpl: async (url, options) => {
      calls.push({ url: String(url), body: JSON.parse(String(options?.body)), key: new Headers(options?.headers).get("idempotency-key") });
      return new Response(JSON.stringify({ ok: true, data: prepared, correlationId: CORR }));
    } });
    const outcome = await repairOriginalPrepare({ ...input, checkout, isCurrent: () => true });
    expect(outcome.status).toBe("ready");
    expect(calls).toEqual([{ url: "/api/pos/v1/sales/prepare", body: request, key: KEY }]);
    expect(store.readSync()).toMatchObject({ ...attempt, prepared: { total: prepared.total, transactionId: TX }, stage: "choose_payment", message: "" });
    const after = await input.db.journal.get(KEY);
    expect(after?.payload).toBe(before?.payload);
    expect(after?.requestHash).toBe(before?.requestHash);
    expect(after?.idempotencyKey).toBe(KEY);
    expect(after?.status).toBe("acknowledged");
    expect(await input.db.journal.count()).toBe(1);
  });

  test.each(["unknown organization", "another cashier", "another register", "changed shift", "wrong attempt", "altered payload", "payment evidence"])("blocks %s without a request or deleting evidence", async (variant) => {
    const { journal: _journal, store, ...input } = await setup();
    void _journal;
    if (variant === "unknown organization") await input.db.journal.update(KEY, { recoveryScope: { createdByActorId: context.actorId, registerId: context.registerId, deviceId: DEVICE } });
    if (variant === "another cashier") input.context = { ...context, actorId: "another-cashier" };
    if (variant === "another register") input.context = { ...context, registerId: "another-register" };
    if (variant === "changed shift") input.shiftId = "88888888-8888-4888-8888-888888888888";
    if (variant === "wrong attempt") await store.write({ ...attempt, prepareKey: "88888888-8888-4888-8888-888888888888" });
    if (variant === "altered payload") await input.db.journal.update(KEY, { payload: JSON.stringify({ payloadVersion: "1.0.0", operation: "sale.prepare", transactionId: TX, request: { ...request, quoteId: "different" } }) });
    if (variant === "payment evidence") await store.write({ ...attempt, paymentId: "88888888-8888-4888-8888-888888888888" });
    const prepare = vi.fn();
    expect((await repairOriginalPrepare({ ...input, checkout: { prepare }, isCurrent: () => true })).status).toBe("blocked");
    expect(prepare).not.toHaveBeenCalled();
    expect((await input.db.journal.get(KEY))?.status).toBe("response_unknown");
    expect(await input.db.journal.count()).toBe(1);
  });

  test("authentication failure retains the earlier ambiguous original row and all command keys", async () => {
    const { journal, store, ...input } = await setup();
    const checkout = createBrowserCheckoutUseCases({ journal, preserveUnresolvedOnFailure: true, fetchImpl: async () => new Response(JSON.stringify({
      ok: false, correlationId: CORR, error: { code: "AUTH_REQUIRED", nextAction: "reauthenticate", retryable: false, message: "session is required" },
    }), { status: 401 }) });
    const outcome = await repairOriginalPrepare({ ...input, checkout, isCurrent: () => true });
    expect(outcome.status).toBe("failed");
    expect((await journal.pending())[0]?.idempotencyKey).toBe(KEY);
    expect((await journal.pending())[0]?.status).toBe("requires_attention");
    expect(store.readSync()).toEqual(attempt);
  });

  test("a changed actor while the request is in flight cannot overwrite the original checkout", async () => {
    const { store, journal: _journal, ...input } = await setup();
    void _journal;
    let current = true;
    const prepare = vi.fn(async () => { current = false; return { ok: true as const, data: prepared, correlationId: CORR }; });
    expect((await repairOriginalPrepare({ ...input, checkout: { prepare }, isCurrent: () => current })).status).toBe("stale");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(store.readSync()).toEqual(attempt);
  });

  test("a different saved attempt created during recovery is never overwritten", async () => {
    const { store, journal: _journal, ...input } = await setup();
    void _journal;
    const next = { ...attempt, transactionId: "88888888-8888-4888-8888-888888888888" };
    const prepare = vi.fn(async () => { await store.write(next); return { ok: true as const, data: prepared, correlationId: CORR }; });
    expect((await repairOriginalPrepare({ ...input, checkout: { prepare }, isCurrent: () => true })).status).toBe("stale");
    expect(await store.hydrate()).toEqual(next);
  });

  test("a lost replay response retains original evidence and does not issue a second request", async () => {
    const { journal, store, ...input } = await setup();
    const fetchImpl = vi.fn(async () => { throw new TypeError("response lost again"); });
    const outcome = await repairOriginalPrepare({ ...input, checkout: createBrowserCheckoutUseCases({ journal, preserveUnresolvedOnFailure: true, fetchImpl }), isCurrent: () => true });
    expect(outcome.status).toBe("failed");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect((await journal.pending())[0]?.status).toBe("response_unknown");
    expect(store.readSync()).toEqual(attempt);
  });

  test("even acknowledged payment history blocks repair of a supposedly unpaid prepare", async () => {
    const { journal: _journal, store: _store, ...input } = await setup();
    void _journal; void _store;
    const row = (await input.db.journal.get(KEY))!;
    await input.db.journal.add({ ...row, id: attempt.cashKey, idempotencyKey: attempt.cashKey, operation: "payment.cash", status: "acknowledged" });
    const prepare = vi.fn();
    expect((await repairOriginalPrepare({ ...input, checkout: { prepare }, isCurrent: () => true })).status).toBe("blocked");
    expect(prepare).not.toHaveBeenCalled();
    expect(await input.db.journal.count()).toBe(2);
  });

  test.each(["different transaction", "different total", "expired reservation"])("does not open payment for %s", async (variant) => {
    const { journal, store, ...input } = await setup();
    const unsafe: PreparedSale = {
      ...prepared,
      ...(variant === "different transaction" ? { transactionId: "88888888-8888-4888-8888-888888888888" } : {}),
      ...(variant === "different total" ? { total: { minor: 2000, currency: "GHS" as const } } : {}),
      ...(variant === "expired reservation" ? { expiresAt: "2000-01-01T00:00:00.000Z" } : {}),
    };
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: unsafe, correlationId: CORR })));
    const checkout = createBrowserCheckoutUseCases({ journal, preserveUnresolvedOnFailure: true, deferSuccessfulAcknowledgement: true, fetchImpl });
    expect((await repairOriginalPrepare({ ...input, checkout, isCurrent: () => true })).status).toBe("failed");
    expect(store.readSync()).toEqual(attempt);
    expect((await journal.pending())[0]?.status).toBe("sent");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test("only the original durable row can offer a repair plan", async () => {
    const { journal: _journal, store: _store, ...input } = await setup();
    void _journal; void _store;
    expect(await loadOriginalPrepareRepair(input)).toMatchObject({ request, idempotencyKey: KEY });
    expect(await loadOriginalPrepareRepair({ ...input, item: { ...input.item, id: `operation:sale.prepare:${TX}` } })).toBeNull();
  });
});
