import "fake-indexeddb/auto";
import { describe, expect, test, vi } from "vitest";
import type {
  PaymentState,
  PreparedSale,
  Quote,
  SaleResolution,
} from "../../../../../../docs/contracts/domain.generated";
import type { ApiResult } from "../../../../../../docs/contracts/ports";
import { openPosLocalDatabase } from "../../../local";
import {
  createCashCheckoutController,
  type CashCheckoutPorts,
} from "./cashCheckoutController";
import {
  createCheckoutAttemptStore,
  discardCheckoutAttemptMemory,
  type CheckoutAttemptRecord,
  type CheckoutAttemptStore,
} from "./checkout-attempt-store";

const TX = "11111111-1111-4111-8111-111111111111";

function quote(fingerprint = "fp-live-1"): Quote {
  return {
    id: "quote-live-1",
    fingerprint,
    cartId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    cartRevision: 1,
    customer: { kind: "walkin" },
    locationId: "loc-front-1",
    currency: "GHS",
    lines: [],
    subtotal: { minor: 1500, currency: "GHS" },
    discount: { minor: 0, currency: "GHS" },
    tax: { minor: 0, currency: "GHS" },
    total: { minor: 1500, currency: "GHS" },
    calculatedAt: "2026-09-13T20:00:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    purchasable: true,
  };
}

async function whenPrepareCalled(mock: object, times = 1): Promise<void> {
  await vi.waitFor(() => {
    const calls = (mock as { mock: { calls: ReadonlyArray<unknown> } }).mock.calls.length;
    if (calls < times) {
      throw new Error("prepare has not been sent");
    }
  });
}

function prepareArgs(mock: object, index = 0): { transactionId: string; quoteFingerprint: string; idempotencyKey: string } {
  const call = (mock as { mock: { calls: ReadonlyArray<ReadonlyArray<unknown>> } }).mock.calls[index];
  const body = call?.[0];
  const context = call?.[1];
  if (!body || typeof body !== "object" || !("transactionId" in body) || typeof body.transactionId !== "string") {
    throw new Error("prepare was not called");
  }
  return {
    transactionId: body.transactionId,
    quoteFingerprint:
      "quoteFingerprint" in body && typeof body.quoteFingerprint === "string" ? body.quoteFingerprint : "",
    idempotencyKey:
      context && typeof context === "object" && "idempotencyKey" in context && typeof context.idempotencyKey === "string"
        ? context.idempotencyKey
        : "",
  };
}

function ports(
  prepare: CashCheckoutPorts["checkout"]["prepare"],
  sequenceStart: number,
  attemptStore?: CheckoutAttemptStore,
): CashCheckoutPorts {
  let n = sequenceStart;
  const next = () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
  return {
    checkout: { prepare, finalize: vi.fn() },
    payments: { confirmCash: vi.fn(), resolve: vi.fn() },
    sales: {
      resolve: vi.fn(async (transactionId: string): Promise<ApiResult<SaleResolution>> => ({
        ok: true,
        correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        data: { transactionId, status: "not_found" },
      })),
      cancel: vi.fn(),
    },
    receipts: { getByTransaction: vi.fn() },
    printer: { print: vi.fn() },
    scope: { registerId: "reg_a", shiftId: "shift-1", deviceId: "device-1" },
    createUuid: next,
    attemptStore,
  };
}

describe("CAN-02 checkout business-attempt identity", () => {
  test("a delayed prepare followed by a new controller does not mint a second sale identity", async () => {
    let release: (value: ApiResult<{ transactionId: string }>) => void = () => undefined;
    const prepare = vi.fn(
      () =>
        new Promise<ApiResult<{ transactionId: string }>>((resolve) => {
          release = resolve;
        }),
    );
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const firstPorts = ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store);
    const first = createCashCheckoutController(firstPorts);
    void first.startPrepare(quote());
    const secondPorts = ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 100, store);
    const second = createCashCheckoutController(secondPorts);
    void second.startPrepare(quote());
    await whenPrepareCalled(prepare);
    const sent = prepareArgs(prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(sent.transactionId).not.toBe("");
    expect(sent.idempotencyKey).not.toBe("");
    release({
      ok: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      data: { transactionId: sent.transactionId },
    });
  });

  test("repeated Pay on one controller and a changed quote do not mint another identity", async () => {
    const prepare = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const controller = createCashCheckoutController(
      ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store),
    );
    void controller.startPrepare(quote());
    void controller.startPrepare(quote());
    await whenPrepareCalled(prepare);
    const refreshed = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    controller.replacePorts({
      ...ports(refreshed as CashCheckoutPorts["checkout"]["prepare"], 50, store),
      attemptStore: store,
    });
    void controller.startPrepare(quote());
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(refreshed).not.toHaveBeenCalled();

    const remounted = createCashCheckoutController(
      ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 80, store),
    );
    void remounted.startPrepare(quote("fp-changed"));
    expect(prepare).toHaveBeenCalledTimes(1);
    const sent = prepareArgs(prepare);
    expect(sent.quoteFingerprint).toBe("fp-live-1");
    expect(remounted.getSession().transactionId).toBe(sent.transactionId);
  });

  test("another register cannot start a second attempt while the first is unresolved", async () => {
    const prepare = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const first = createCashCheckoutController(
      ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store),
    );
    void first.startPrepare(quote());
    const otherRegister = ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 100, store);
    const second = createCashCheckoutController({
      ...otherRegister,
      scope: { ...otherRegister.scope, registerId: "reg_b" },
    });
    void second.startPrepare(quote());
    await whenPrepareCalled(prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  test("IndexedDB keeps the attempt after the in-process copy is dropped", async () => {
    const prepare = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const first = createCashCheckoutController(
      ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store),
    );
    void first.startPrepare(quote());
    await whenPrepareCalled(prepare);
    const transactionId = prepareArgs(prepare).transactionId;
    await vi.waitFor(async () => {
      expect(await db.kv.get("checkout.active-business-attempt")).toBeTruthy();
    });
    discardCheckoutAttemptMemory(db.name);
    const reloaded = createCheckoutAttemptStore(db);
    await reloaded.hydrate();
    const again = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    const second = createCashCheckoutController(
      ports(again as CashCheckoutPorts["checkout"]["prepare"], 100, reloaded),
    );
    void second.startPrepare(quote());
    expect(again).not.toHaveBeenCalled();
    expect(second.getSession().transactionId).toBe(transactionId);
  });

  test("an authoritative not-found result retires the attempt so a later sale can be new", async () => {
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const prepare = vi.fn(async () => {
      throw new TypeError("lost response");
    });
    const controller = createCashCheckoutController(
      ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store),
    );
    await controller.startPrepare(quote());
    expect(controller.getSession().stage).toBe("prepare_failed");
    expect(store.readSync()).toBeNull();
    const nextPrepare = vi.fn(async () => {
      throw new TypeError("lost response");
    });
    await controller.replacePorts({
      ...ports(nextPrepare as CashCheckoutPorts["checkout"]["prepare"], 100, store),
      attemptStore: store,
    });
    await controller.startPrepare(quote());
    const firstId = prepareArgs(prepare).transactionId;
    const secondId = prepareArgs(nextPrepare).transactionId;
    expect(secondId).not.toBe(firstId);
  });

  test("an uncertain resolution keeps the attempt so a reopened controller cannot mint", async () => {
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const prepare = vi.fn(async () => {
      throw new TypeError("lost response");
    });
    const built = ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store);
    const controller = createCashCheckoutController({
      ...built,
      sales: {
        resolve: vi.fn(async (transactionId: string): Promise<ApiResult<SaleResolution>> => ({
          ok: true,
          correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          data: { transactionId, status: "preparing" },
        })),
        cancel: vi.fn(),
      },
    });
    await controller.startPrepare(quote());
    const transactionId = prepareArgs(prepare).transactionId;
    expect(controller.getSession().stage).toBe("resolving_sale");
    expect(store.readSync()?.transactionId).toBe(transactionId);
    const again = vi.fn(async () => {
      throw new TypeError("lost response");
    });
    const second = createCashCheckoutController(
      ports(again as CashCheckoutPorts["checkout"]["prepare"], 100, store),
    );
    void second.startPrepare(quote());
    expect(again).not.toHaveBeenCalled();
    expect(second.getSession().transactionId).toBe(transactionId);
  });

  test("a completed sale keeps its identity until new sale, then the same cart may start a new one", async () => {
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const correlationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const prepared = (transactionId: string): PreparedSale => ({
      transactionId,
      saleId: "sale-1",
      orderReference: "POS-1001",
      quoteFingerprint: "fp-live-1",
      total: { minor: 1500, currency: "GHS" },
      status: "prepared",
      stockCommitment: "reserved",
      preparedAt: "2026-09-14T18:00:00.000Z",
      expiresAt: "2026-09-14T19:00:00.000Z",
    });
    const verified = (transactionId: string): PaymentState => ({
      transactionId,
      paymentId: TX,
      tender: "cash",
      status: "verified",
      amount: { minor: 1500, currency: "GHS" },
      verifiedAt: "2026-09-14T18:01:00.000Z",
      nextAction: "none",
    });
    const prepare = vi.fn(async (input: { transactionId: string }) => ({
      ok: true as const,
      correlationId,
      data: prepared(input.transactionId),
    }));
    const confirmCash = vi.fn(async (input: { transactionId: string }) => ({
      ok: true as const,
      correlationId,
      data: verified(input.transactionId),
    }));
    const finalize = vi.fn(async (input: { transactionId: string }): Promise<ApiResult<SaleResolution>> => ({
      ok: true,
      correlationId,
      data: {
        transactionId: input.transactionId,
        status: "completed",
        saleId: "sale-1",
        orderReference: "POS-1001",
        paymentId: TX,
      },
    }));
    const controller = createCashCheckoutController({
      ...ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store),
      checkout: { prepare: prepare as CashCheckoutPorts["checkout"]["prepare"], finalize },
      payments: { confirmCash, resolve: vi.fn() },
      receipts: {
        getByTransaction: vi.fn(async () => ({
          ok: false as const,
          correlationId,
          error: {
            code: "NOT_FOUND" as const,
            message: "Receipt is not ready.",
            retryable: false,
            nextAction: "none" as const,
          },
        })),
      },
    });
    await controller.startPrepare(quote());
    const firstId = prepareArgs(prepare).transactionId;
    controller.selectCash();
    await controller.confirmCash("20.00");
    expect(controller.getSession().saleCompleted).toBe(true);
    await controller.startPrepare(quote());
    expect(prepare).toHaveBeenCalledTimes(1);
    controller.resetForNewSale();
    expect(store.readSync()).toBeNull();
    const nextPrepare = vi.fn(async (input: { transactionId: string }) => ({
      ok: true as const,
      correlationId,
      data: prepared(input.transactionId),
    }));
    controller.replacePorts({
      ...ports(nextPrepare as CashCheckoutPorts["checkout"]["prepare"], 100, store),
      checkout: { prepare: nextPrepare as CashCheckoutPorts["checkout"]["prepare"], finalize },
      attemptStore: store,
    });
    await controller.startPrepare(quote());
    expect(prepareArgs(nextPrepare).transactionId).not.toBe(firstId);
  });

  test("a persisted completed sale without a receipt restores into receipt recovery instead of a dead-end complete modal", async () => {
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const transactionId = "77777777-7777-4777-8777-777777777777";
    await store.write({
      transactionId,
      quoteId: "quote-live-1",
      quoteFingerprint: "fp-live-1",
      quoteTotalMinor: 300,
      currency: "GHS",
      registerId: "reg_a",
      shiftId: "shift-1",
      deviceId: "device-1",
      prepareKey: "70000000-0000-4000-8000-000000000001",
      prepareCorrelationId: "70000000-0000-4000-8000-000000000002",
      cashKey: "70000000-0000-4000-8000-000000000003",
      cashCorrelationId: "70000000-0000-4000-8000-000000000004",
      finalizeKey: "70000000-0000-4000-8000-000000000005",
      finalizeCorrelationId: "70000000-0000-4000-8000-000000000006",
      paymentId: "70000000-0000-4000-8000-000000000007",
      stage: "complete",
      saleCompleted: true,
      message: "The sale is complete. Loading the official receipt.",
    });
    const controller = createCashCheckoutController(
      ports(vi.fn() as CashCheckoutPorts["checkout"]["prepare"], 100, store),
    );
    expect(controller.getSession().transactionId).toBe(transactionId);
    expect(controller.getSession().saleCompleted).toBe(true);
    expect(controller.getSession().stage).toBe("receipt_failed");
    expect(controller.getSession().message).toContain("Do not take payment again");
    expect(controller.getSession().receipt).toBeUndefined();
  });

  test("sale.prepare waits until the attempt is durably stored", async () => {
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const inner = createCheckoutAttemptStore(db);
    const staged: CheckoutAttemptRecord[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const store: CheckoutAttemptStore = {
      readSync: () => inner.readSync(),
      hydrate: () => inner.hydrate(),
      async write(record) {
        staged.push(record);
        await gate;
        await inner.write(record);
      },
      clear: () => inner.clear(),
    };
    const prepare = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    const built = ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store);
    const controller = createCashCheckoutController(built);
    void controller.startPrepare(quote());
    expect(prepare).not.toHaveBeenCalled();
    expect(built.payments.confirmCash).not.toHaveBeenCalled();
    expect(built.checkout.finalize).not.toHaveBeenCalled();
    expect(staged.length).toBeGreaterThan(0);
    expect(new Set(staged.map((record) => record.transactionId)).size).toBe(1);
    expect(new Set(staged.map((record) => record.prepareKey)).size).toBe(1);
    expect(controller.isLocked()).toBe(true);
    const transactionId = staged[0]?.transactionId ?? "";
    const prepareKey = staged[0]?.prepareKey ?? "";
    void controller.startPrepare(quote());
    expect(new Set(staged.map((record) => record.transactionId)).size).toBe(1);
    release();
    await whenPrepareCalled(prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepareArgs(prepare).transactionId).toBe(transactionId);
    expect(prepareArgs(prepare).idempotencyKey).toBe(prepareKey);
    expect(built.payments.confirmCash).not.toHaveBeenCalled();
    expect(built.checkout.finalize).not.toHaveBeenCalled();
  });

  test("a rejected durable write does not send prepare and a retry keeps the same identity", async () => {
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const inner = createCheckoutAttemptStore(db);
    const staged: CheckoutAttemptRecord[] = [];
    let fail = true;
    const store: CheckoutAttemptStore = {
      readSync: () => inner.readSync(),
      hydrate: () => inner.hydrate(),
      async write(record) {
        staged.push(record);
        if (fail) {
          throw new Error("durable write failed");
        }
        await inner.write(record);
      },
      clear: () => inner.clear(),
    };
    const prepare = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    const built = ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store);
    const controller = createCashCheckoutController(built);
    await controller.startPrepare(quote());
    expect(prepare).not.toHaveBeenCalled();
    expect(built.payments.confirmCash).not.toHaveBeenCalled();
    expect(built.checkout.finalize).not.toHaveBeenCalled();
    expect(controller.getSession().stage).toBe("prepare_failed");
    const transactionId = staged[0]?.transactionId ?? "";
    const prepareKey = staged[0]?.prepareKey ?? "";
    expect(transactionId).not.toBe("");
    await controller.startPrepare(quote());
    expect(prepare).not.toHaveBeenCalled();
    expect(staged.every((record) => record.transactionId === transactionId && record.prepareKey === prepareKey)).toBe(true);
    fail = false;
    void controller.startPrepare(quote());
    await whenPrepareCalled(prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepareArgs(prepare).transactionId).toBe(transactionId);
    expect(prepareArgs(prepare).idempotencyKey).toBe(prepareKey);
    expect(inner.readSync()?.transactionId).toBe(transactionId);
    expect(inner.readSync()?.prepareKey).toBe(prepareKey);
  });

  test("a reloaded controller restores the identity committed before prepare", async () => {
    const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
    const store = createCheckoutAttemptStore(db);
    const prepare = vi.fn(async (body: { transactionId: string }, context: { idempotencyKey: string }) => {
      const row = await db.kv.get("checkout.active-business-attempt");
      const stored = JSON.parse(row?.value ?? "{}") as CheckoutAttemptRecord;
      expect(stored.transactionId).toBe(body.transactionId);
      expect(stored.prepareKey).toBe(context.idempotencyKey);
      return new Promise<ApiResult<{ transactionId: string }>>(() => undefined);
    });
    const controller = createCashCheckoutController(
      ports(prepare as CashCheckoutPorts["checkout"]["prepare"], 0, store),
    );
    void controller.startPrepare(quote());
    await whenPrepareCalled(prepare);
    const sent = prepareArgs(prepare);
    discardCheckoutAttemptMemory(db.name);
    const reloaded = createCheckoutAttemptStore(db);
    await reloaded.hydrate();
    expect(reloaded.readSync()?.transactionId).toBe(sent.transactionId);
    expect(reloaded.readSync()?.prepareKey).toBe(sent.idempotencyKey);
    const again = vi.fn(() => new Promise<ApiResult<{ transactionId: string }>>(() => undefined));
    const second = createCashCheckoutController(
      ports(again as CashCheckoutPorts["checkout"]["prepare"], 100, reloaded),
    );
    void second.startPrepare(quote());
    expect(again).not.toHaveBeenCalled();
    expect(second.getSession().transactionId).toBe(sent.transactionId);
  });
});
