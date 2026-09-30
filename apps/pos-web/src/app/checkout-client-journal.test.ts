import "fake-indexeddb/auto";
import { afterEach, describe, expect, test } from "vitest";
import {
  createOperationJournal,
  deletePosLocalDatabase,
  inspectLocalRecoveryState,
  openPosLocalDatabase,
} from "../local";
import { createBrowserCashCheckoutPorts } from "./checkout-client";

const LOCAL_CHECKOUT_SCOPE = {
  registerId: "reg-test",
  shiftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;

const TX = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const CORR = "33333333-3333-4333-8333-333333333333";
const DBS: string[] = [];

afterEach(async () => {
  await Promise.all(DBS.splice(0).map((name) => deletePosLocalDatabase(name)));
});

function uniqueDb() {
  const name = `cetech-pos-r9-journal-${crypto.randomUUID()}`;
  DBS.push(name);
  return openPosLocalDatabase(name);
}

function prepareInput() {
  return {
    transactionId: TX,
    registerId: LOCAL_CHECKOUT_SCOPE.registerId,
    shiftId: LOCAL_CHECKOUT_SCOPE.shiftId,
    deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
    quoteId: "quote-1",
    quoteFingerprint: "0123456789abcdef0123456789abcdef",
  };
}

function preparedSale() {
  return {
    transactionId: TX,
    saleId: "sale-1",
    orderReference: "ORDER-1",
    quoteFingerprint: "0123456789abcdef0123456789abcdef",
    total: { minor: 1000, currency: "GHS" as const },
    status: "prepared" as const,
    stockCommitment: "reserved" as const,
    preparedAt: "2026-09-20T19:30:00.000Z",
    expiresAt: "2026-09-20T19:45:00.000Z",
  };
}

describe("R9 mounted checkout OperationJournal", () => {
  test("sale.prepare is durable before send and transport ambiguity remains pending", async () => {
    const db = uniqueDb();
    const journal = createOperationJournal(db);
    let statusObservedInsideFetch: string | undefined;

    const fetchImpl: typeof fetch = async () => {
      statusObservedInsideFetch = (await journal.pending())[0]?.status;
      throw new TypeError("simulated response loss");
    };

    const ports = createBrowserCashCheckoutPorts({
      fetchImpl,
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
      now: () => new Date("2026-09-20T19:30:00.000Z"),
    });

    const result = await ports.checkout.prepare(
      prepareInput(),
      { idempotencyKey: KEY, correlationId: CORR },
    );

    expect(result.ok).toBe(false);
    expect(statusObservedInsideFetch).toBe("sent");

    const pending = await journal.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      id: KEY,
      transactionId: TX,
      operation: "sale.prepare",
      idempotencyKey: KEY,
      payloadVersion: "1.0.0",
      status: "response_unknown",
      attempts: 1,
    });

    const diagnostics = await inspectLocalRecoveryState(db);
    expect(diagnostics.pendingOperationCount).toBe(1);
    expect(diagnostics.recommendedActions).toContain("RESOLVE_PENDING_OPERATIONS");
  });

  test("recovered prepared resolution acknowledges the prepare journal row", async () => {
    const db = uniqueDb();
    const journal = createOperationJournal(db);

    const ambiguousPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        throw new TypeError("simulated response loss");
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
      now: () => new Date("2026-09-20T19:30:00.000Z"),
    });

    await ambiguousPorts.checkout.prepare(
      prepareInput(),
      { idempotencyKey: KEY, correlationId: CORR },
    );
    expect((await journal.pending())[0]?.status).toBe("response_unknown");

    const recoveryPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async (input) => {
        const url = String(input);
        if (!url.endsWith(`/sales/${TX}`)) {
          throw new Error(`unexpected recovery request: ${url}`);
        }
        return new Response(
          JSON.stringify({
            ok: true,
            correlationId: CORR,
            data: {
              transactionId: TX,
              status: "prepared",
              saleId: "sale-1",
              orderReference: "ORDER-1",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
    });

    const resolution = await recoveryPorts.sales.resolve(TX);
    expect(resolution.ok).toBe(true);
    expect(await journal.pending()).toHaveLength(0);
    expect((await db.journal.get(KEY))?.status).toBe("acknowledged");
  });

  test("a proven pre-effect failure does not leave the journal response-unknown", async () => {
    const db = uniqueDb();
    const journal = createOperationJournal(db);
    const ports = createBrowserCashCheckoutPorts({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: false,
            correlationId: CORR,
            error: {
              code: "INTEGRATION_UNAVAILABLE",
              message: "catalog presentation is unavailable",
              retryable: true,
              nextAction: "resolve",
              details: { field: "pre_effect" },
            },
          }),
          { status: 503, headers: { "content-type": "application/json" } },
        ),
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
    });
    const result = await ports.checkout.prepare(prepareInput(), { idempotencyKey: KEY, correlationId: CORR });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected pre-effect failure");
    expect(result.error.details?.field).toBe("pre_effect");
    expect(await journal.pending()).toHaveLength(0);
    expect((await db.journal.get(KEY))?.status).toBe("acknowledged");
  });

  test("finalizing and payment_pending resolutions keep blocking journal evidence", async () => {
    const db = uniqueDb();
    const journal = createOperationJournal(db);
    const ambiguousPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        throw new TypeError("simulated response loss");
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
    });
    await ambiguousPorts.checkout.prepare(prepareInput(), { idempotencyKey: KEY, correlationId: CORR });
    const recoveryPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            correlationId: CORR,
            data: {
              transactionId: TX,
              status: "finalizing",
              paymentId: "66666666-6666-4666-8666-666666666666",
              message: "Completing the sale. Payment has been submitted; do not charge again.",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
    });
    await recoveryPorts.sales.resolve(TX);
    expect((await db.journal.get(KEY))?.status).toBe("requires_attention");
    expect(await journal.pending()).toHaveLength(1);
  });

  test("resolved not-found sale acknowledges prepare and clears the tender lease", async () => {
    const db = uniqueDb();
    const journal = createOperationJournal(db);
    let active = false;
    const tenderActivity = {
      async markActive() {
        active = true;
      },
      async clear() {
        active = false;
      },
    };

    const ambiguousPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        throw new TypeError("simulated response loss");
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
      tenderActivity,
    });

    await ambiguousPorts.checkout.prepare(
      prepareInput(),
      { idempotencyKey: KEY, correlationId: CORR },
    );
    expect(active).toBe(true);
    expect((await journal.pending())[0]?.status).toBe("response_unknown");

    const recoveryPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            correlationId: CORR,
            data: { transactionId: TX, status: "not_found" },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
      tenderActivity,
    });

    const resolution = await recoveryPorts.sales.resolve(TX);
    expect(resolution.ok).toBe(true);
    expect(await journal.pending()).toHaveLength(0);
    expect((await db.journal.get(KEY))?.status).toBe("acknowledged");
    expect(active).toBe(false);
  });

  test("known prepare success is acknowledged and does not leave false pending work", async () => {
    const db = uniqueDb();
    const journal = createOperationJournal(db);
    let statusObservedInsideFetch: string | undefined;

    const ports = createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        statusObservedInsideFetch = (await journal.pending())[0]?.status;
        return new Response(
          JSON.stringify({ ok: true, correlationId: CORR, data: preparedSale() }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal,
    });

    const result = await ports.checkout.prepare(
      prepareInput(),
      { idempotencyKey: KEY, correlationId: CORR },
    );

    expect(result.ok).toBe(true);
    expect(statusObservedInsideFetch).toBe("sent");
    expect(await journal.pending()).toHaveLength(0);
    expect((await db.journal.get(KEY))?.status).toBe("acknowledged");
  });
});
