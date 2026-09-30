import "fake-indexeddb/auto";
import { describe, expect, test, vi } from "vitest";
import type { Quote, ReceiptSnapshot, SaleResolution } from "../../../../../../docs/contracts/domain.generated";
import type { ApiResult } from "../../../../../../docs/contracts/ports";
import { openPosLocalDatabase } from "../../../local";
import { createCashCheckoutController, type CashCheckoutPorts } from "./cashCheckoutController";
import { createCheckoutAttemptStore } from "./checkout-attempt-store";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function quote(): Quote {
  return {
    id: "quote-live-1",
    fingerprint: "fp-live-1",
    cartId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    cartRevision: 1,
    customer: { kind: "walkin" },
    locationId: "loc-front-1",
    currency: "GHS",
    lines: [],
    subtotal: { minor: 500, currency: "GHS" },
    discount: { minor: 0, currency: "GHS" },
    tax: { minor: 0, currency: "GHS" },
    total: { minor: 500, currency: "GHS" },
    calculatedAt: "2026-09-29T22:39:00.000Z",
    expiresAt: "2099-01-01T00:00:00.000Z",
    purchasable: true,
  };
}

function harness(prepare: CashCheckoutPorts["checkout"]["prepare"], sequenceStart = 0) {
  let n = sequenceStart;
  const next = () => {
    n += 1;
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
  const db = openPosLocalDatabase(`cetech-pos-local-${crypto.randomUUID()}`);
  const confirmCash = vi.fn<CashCheckoutPorts["payments"]["confirmCash"]>();
  const resolveSale = vi.fn<CashCheckoutPorts["sales"]["resolve"]>();
  const getByTransaction = vi.fn<CashCheckoutPorts["receipts"]["getByTransaction"]>();
  const ports: CashCheckoutPorts = {
    checkout: { prepare, finalize: vi.fn() },
    payments: { confirmCash, resolve: vi.fn() },
    sales: { resolve: resolveSale, cancel: vi.fn() },
    receipts: { getByTransaction },
    printer: { print: vi.fn() },
    scope: { registerId: "reg_a", shiftId: "shift-1", deviceId: "device-1" },
    createUuid: next,
    attemptStore: createCheckoutAttemptStore(db),
  };
  return { ports, confirmCash, resolveSale, getByTransaction };
}

function failure(
  code: "STOCK_CHANGED" | "REQUIRES_ATTENTION" | "NOT_FOUND" | "OPERATION_IN_PROGRESS",
  field?: string,
): ApiResult<never> {
  const nextAction =
    code === "STOCK_CHANGED"
      ? "review_quote"
      : code === "REQUIRES_ATTENTION"
        ? "contact_manager"
        : code === "NOT_FOUND"
          ? "none"
          : "resolve";
  return {
    ok: false,
    correlationId: CORRELATION,
    error: {
      code,
      message: code,
      retryable: nextAction === "resolve",
      nextAction,
      ...(field ? { details: { field } } : {}),
    },
  };
}

describe("cashier prepare recovery", () => {
  test("a definitive rejection does not enter sale resolution", async () => {
    const { ports, confirmCash, resolveSale } = harness(async () => failure("STOCK_CHANGED"));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    expect(resolveSale).not.toHaveBeenCalled();
    expect(controller.getSession().stage).toBe("prepare_failed");
    await controller.confirmCash("10.00");
    expect(confirmCash).not.toHaveBeenCalled();
  });

  test("requires_attention keeps the same attempt and blocks another Pay and cash confirmation", async () => {
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase");
    const { ports, confirmCash, resolveSale } = harness(async () => failure("REQUIRES_ATTENTION"));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    const first = ports.attemptStore?.readSync();
    expect(controller.getSession().stage).toBe("finalize_failed");
    expect(first?.transactionId).toBeTruthy();
    expect(resolveSale).not.toHaveBeenCalled();
    const again = vi.fn();
    controller.replacePorts({ ...ports, checkout: { prepare: again, finalize: vi.fn() } });
    await controller.startPrepare(quote());
    expect(again).not.toHaveBeenCalled();
    expect(ports.attemptStore?.readSync()?.transactionId).toBe(first?.transactionId);
    expect(ports.attemptStore?.readSync()?.prepareKey).toBe(first?.prepareKey);
    await controller.confirmCash("10.00");
    expect(confirmCash).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    deleteDatabase.mockRestore();
  });

  test("remote not_found retires the attempt, keeps the cart, and allows one later sale", async () => {
    const prepare = vi.fn(async () => failure("NOT_FOUND", "remote_sale"));
    const { ports } = harness(prepare);
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    const firstCall = prepare.mock.calls as unknown as ReadonlyArray<readonly [{ readonly transactionId?: string }]>;
    const firstBody = firstCall[0]?.[0];
    expect(controller.getSession().stage).toBe("prepare_failed");
    expect(controller.getSession().message).toContain("cart is unchanged");
    expect(ports.attemptStore?.readSync()).toBeNull();
    const next = vi.fn(async () => failure("STOCK_CHANGED"));
    controller.replacePorts({ ...ports, checkout: { prepare: next, finalize: vi.fn() } });
    await controller.startPrepare(quote());
    const secondCall = next.mock.calls as unknown as ReadonlyArray<readonly [{ readonly transactionId?: string }]>;
    const secondBody = secondCall[0]?.[0];
    expect(secondBody?.transactionId).toBeTruthy();
    expect(secondBody?.transactionId).not.toBe(firstBody?.transactionId);
  });

  test("a completed resolution loads the official receipt and does not take payment", async () => {
    const receipt: ReceiptSnapshot = {
      id: "rcpt-1",
      transactionId: "00000000-0000-4000-8000-000000000001",
      receiptNumber: "POS-50104",
      orderReference: "50104",
      issuedAt: "2026-09-29T22:40:00.000Z",
      locationName: "B2 Shop",
      registerName: "B2 Register",
      cashierName: "Cashier",
      customerLabel: "Walk-in",
      lines: [],
      subtotal: { minor: 500, currency: "GHS" },
      discount: { minor: 0, currency: "GHS" },
      tax: { minor: 0, currency: "GHS" },
      total: { minor: 500, currency: "GHS" },
      tender: "cash",
      documentKind: "operational_pos_receipt",
    };
    const { ports, confirmCash, resolveSale, getByTransaction } = harness(async () => failure("OPERATION_IN_PROGRESS"));
    resolveSale.mockImplementation(async (transactionId: string): Promise<ApiResult<SaleResolution>> => ({
      ok: true,
      correlationId: CORRELATION,
      data: { transactionId, status: "completed", saleId: "sale-50104", orderReference: "50104", receiptId: "rcpt-1" },
    }));
    getByTransaction.mockImplementation(async (transactionId: string): Promise<ApiResult<ReceiptSnapshot>> => ({
      ok: true,
      correlationId: CORRELATION,
      data: { ...receipt, transactionId },
    }));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    expect(resolveSale).toHaveBeenCalledTimes(1);
    expect(getByTransaction).toHaveBeenCalledTimes(1);
    expect(controller.getSession().stage).toBe("receipt_ready");
    expect(confirmCash).not.toHaveBeenCalled();
  });

  test("remount after attention keeps the same transaction and command keys", async () => {
    const { ports } = harness(async () => failure("REQUIRES_ATTENTION"));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    const saved = ports.attemptStore?.readSync();
    const reopened = createCashCheckoutController(ports);
    expect(reopened.getSession().transactionId).toBe(saved?.transactionId);
    expect(reopened.getSession().stage).toBe("finalize_failed");
    const prepare = vi.fn();
    reopened.replacePorts({ ...ports, checkout: { prepare, finalize: vi.fn() } });
    await reopened.startPrepare(quote());
    expect(prepare).not.toHaveBeenCalled();
    expect(reopened.getSession().transactionId).toBe(saved?.transactionId);
  });

  test("payment is not confirmed when prepare never returns a sale", async () => {
    const { ports, confirmCash } = harness(async () => failure("REQUIRES_ATTENTION"));
    const controller = createCashCheckoutController(ports);
    await controller.confirmCash("5.00");
    expect(confirmCash).not.toHaveBeenCalled();
  });

  test("remote finalizing with a payment id does not choose payment or confirm cash", async () => {
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase");
    const { ports, confirmCash, resolveSale } = harness(async () => failure("OPERATION_IN_PROGRESS"));
    const finalize = vi.fn();
    ports.checkout.finalize = finalize;
    resolveSale.mockImplementation(async (transactionId: string): Promise<ApiResult<SaleResolution>> => ({
      ok: true,
      correlationId: CORRELATION,
      data: {
        transactionId,
        status: "finalizing",
        paymentId: "66666666-6666-4666-8666-666666666666",
        saleId: "sale-50104",
        orderReference: "50104",
        message: "Completing the sale. Payment has been submitted; do not charge again.",
      },
    }));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    const saved = ports.attemptStore?.readSync();
    expect(controller.getSession().stage).toBe("finalizing");
    expect(controller.getSession().stage).not.toBe("choose_payment");
    expect(controller.getSession().transactionId).toBe(saved?.transactionId);
    expect(confirmCash).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
    await controller.confirmCash("5.00");
    expect(confirmCash).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
    deleteDatabase.mockRestore();
  });

  test("payment_pending does not confirm cash again", async () => {
    const { ports, confirmCash, resolveSale } = harness(async () => failure("OPERATION_IN_PROGRESS"));
    resolveSale.mockImplementation(async (transactionId: string): Promise<ApiResult<SaleResolution>> => ({
      ok: true,
      correlationId: CORRELATION,
      data: {
        transactionId,
        status: "payment_pending",
        paymentId: "66666666-6666-4666-8666-666666666666",
        message: "A payment is already pending for this sale. Do not confirm cash again.",
      },
    }));
    ports.payments.resolve = vi.fn(async () => ({
      ok: true as const,
      correlationId: CORRELATION,
      data: {
        paymentId: "66666666-6666-4666-8666-666666666666",
        transactionId: "00000000-0000-4000-8000-000000000001",
        saleId: "sale-50104",
        tender: "cash" as const,
        status: "pending" as const,
        amount: { minor: 500, currency: "GHS" as const },
        nextAction: "resolve" as const,
      },
    }));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    expect(controller.getSession().stage).not.toBe("choose_payment");
    expect(controller.getSession().stage).toBe("resolving_payment");
    expect(confirmCash).not.toHaveBeenCalled();
    await controller.confirmCash("5.00");
    expect(confirmCash).not.toHaveBeenCalled();
    expect(controller.getSession().transactionId).toBeTruthy();
  });

  test("cancelled retires the attempt and keeps the cart available", async () => {
    const prepare = vi.fn(async () => ({
      ok: false as const,
      correlationId: CORRELATION,
      error: {
        code: "NOT_FOUND" as const,
        message: "This sale was cancelled. The cart is unchanged.",
        retryable: false,
        nextAction: "none" as const,
        details: { field: "sale_cancelled" },
      },
    }));
    const { ports } = harness(prepare);
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    expect(controller.getSession().stage).toBe("prepare_failed");
    expect(controller.getSession().message).toContain("cart is unchanged");
    expect(ports.attemptStore?.readSync()).toBeNull();
    const next = vi.fn(async () => failure("STOCK_CHANGED"));
    controller.replacePorts({ ...ports, checkout: { prepare: next, finalize: vi.fn() } });
    await controller.startPrepare(quote());
    expect(next).toHaveBeenCalledTimes(1);
  });

  test("proven pre-effect INTEGRATION_UNAVAILABLE retries the same transaction without resolving", async () => {
    const prepare = vi.fn(async () => ({
      ok: false as const,
      correlationId: CORRELATION,
      error: {
        code: "INTEGRATION_UNAVAILABLE" as const,
        message: "catalog presentation is unavailable",
        retryable: true,
        nextAction: "resolve" as const,
        details: { field: "pre_effect" },
      },
    }));
    const { ports, resolveSale, confirmCash } = harness(prepare);
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    const first = ports.attemptStore?.readSync();
    expect(resolveSale).not.toHaveBeenCalled();
    expect(controller.getSession().stage).toBe("prepare_failed");
    expect(controller.getSession().message).toContain("was not sent");
    const retry = vi.fn(async () => failure("STOCK_CHANGED"));
    controller.replacePorts({ ...ports, checkout: { prepare: retry, finalize: vi.fn() } });
    await controller.startPrepare(quote());
    const second = retry.mock.calls as unknown as ReadonlyArray<
      readonly [{ readonly transactionId?: string }, { readonly idempotencyKey?: string }]
    >;
    expect(second[0]?.[0]?.transactionId).toBe(first?.transactionId);
    expect(second[0]?.[1]?.idempotencyKey).toBe(first?.prepareKey);
    expect(resolveSale).not.toHaveBeenCalled();
    expect(confirmCash).not.toHaveBeenCalled();
  });

  test("completed without an official receipt does not claim receipt-ready or take payment", async () => {
    const deleteDatabase = vi.spyOn(indexedDB, "deleteDatabase");
    const { ports, confirmCash, resolveSale, getByTransaction } = harness(async () => ({
      ok: false as const,
      correlationId: CORRELATION,
      error: {
        code: "REQUIRES_ATTENTION" as const,
        message: "This sale is complete, but the official receipt is not on this register. Do not take payment again. Contact a manager.",
        retryable: false,
        nextAction: "contact_manager" as const,
        details: { field: "receipt_missing" },
      },
    }));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    expect(controller.getSession().stage).toBe("finalize_failed");
    expect(controller.getSession().stage).not.toBe("receipt_ready");
    expect(controller.getSession().message).toContain("official receipt");
    expect(getByTransaction).not.toHaveBeenCalled();
    expect(resolveSale).not.toHaveBeenCalled();
    expect(confirmCash).not.toHaveBeenCalled();
    expect(controller.getSession().transactionId).toBe(ports.attemptStore?.readSync()?.transactionId);
    expect(deleteDatabase).not.toHaveBeenCalled();
    deleteDatabase.mockRestore();
  });

  test("a prepared resolution can reach payment choice without confirming cash or minting another attempt", async () => {
    const { ports, confirmCash, resolveSale } = harness(async () => failure("OPERATION_IN_PROGRESS"));
    resolveSale.mockImplementation(async (transactionId: string): Promise<ApiResult<SaleResolution>> => ({
      ok: true,
      correlationId: CORRELATION,
      data: { transactionId, status: "prepared", saleId: "sale-50104", orderReference: "50104" },
    }));
    const controller = createCashCheckoutController(ports);
    await controller.startPrepare(quote());
    const saved = ports.attemptStore?.readSync();
    expect(controller.getSession().stage).toBe("choose_payment");
    expect(confirmCash).not.toHaveBeenCalled();
    const again = vi.fn();
    controller.replacePorts({ ...ports, checkout: { prepare: again, finalize: vi.fn() } });
    await controller.startPrepare(quote());
    expect(again).not.toHaveBeenCalled();
    expect(ports.attemptStore?.readSync()?.transactionId).toBe(saved?.transactionId);
    expect(ports.attemptStore?.readSync()?.prepareKey).toBe(saved?.prepareKey);
  });
});
