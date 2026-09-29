import type {
  ApiFailure,
  CommandContext,
  CustomerSummary,
  PaymentState,
  PreparedSale,
  Quote,
  ReceiptSnapshot,
  SaleResolution,
} from "../../../../../../docs/contracts/domain.generated";
import type {
  ApiResult,
  CheckoutUseCases,
  PaymentPort,
  PrintPort,
  ReceiptPort,
  SalesPort,
} from "../../../../../../docs/contracts/ports";
import { parseDecimalToMinorUnits } from "../../register/parseDecimalToMinorUnits";
import { cashierErrorMessage, withDoNotChargeAgain } from "../../../ui/cashier-language";
import { customerReceiptPlaceLabel } from "../../../core/receipt/customer-presentation";
import {
  canBeginNewSale,
  canReturnToPaymentChoice,
  checkoutDismissAllowed,
  idleCheckoutSession,
  type CheckoutMoneyView,
  type CheckoutSessionView,
  type PreparedSaleView,
  type ReceiptViewModel,
} from "../state/checkoutSession";
import type { CheckoutAttemptRecord, CheckoutAttemptStore } from "./checkout-attempt-store";

export type CashCheckoutScope = {
  readonly registerId: string;
  readonly shiftId: string;
  readonly deviceId: string;
};

export type CashCheckoutPorts = {
  readonly checkout: CheckoutUseCases;
  readonly payments: Pick<PaymentPort, "confirmCash" | "resolve"> & Partial<Pick<PaymentPort, "initialize">>;
  readonly sales: Pick<SalesPort, "resolve" | "cancel">;
  readonly receipts: ReceiptPort;
  readonly printer: PrintPort;
  readonly scope: CashCheckoutScope;
  readonly createUuid?: () => string;
  readonly attemptStore?: CheckoutAttemptStore;
};

type AttemptIdentities = {
  readonly quoteId: string;
  readonly quoteFingerprint: string;
  readonly quoteTotal: CheckoutMoneyView;
  readonly transactionId: string;
  readonly currency: string;
  readonly prepare: CommandContext;
  readonly cash: CommandContext;
  readonly finalize: CommandContext;
  cancel?: CommandContext;
};

type UnknownOutcome = { readonly kind: "unknown"; readonly message: string };
type KnownOutcome<T> = { readonly kind: "result"; readonly value: ApiResult<T> };
type Settled<T> = UnknownOutcome | KnownOutcome<T>;

function defaultUuid(): string {
  return crypto.randomUUID();
}

function quoteMatches(identities: AttemptIdentities, quote: Quote): boolean {
  return identities.quoteId === quote.id && identities.quoteFingerprint === quote.fingerprint;
}

function mapPrepared(sale: PreparedSale): PreparedSaleView {
  return {
    transactionId: sale.transactionId,
    saleId: sale.saleId,
    orderReference: sale.orderReference,
    quoteFingerprint: sale.quoteFingerprint,
    total: sale.total,
  };
}

export function mapReceiptSnapshot(snapshot: ReceiptSnapshot): ReceiptViewModel {
  return {
    id: snapshot.id,
    transactionId: snapshot.transactionId,
    receiptNumber: snapshot.receiptNumber,
    orderReference: snapshot.orderReference,
    issuedAt: snapshot.issuedAt,
    locationName: customerReceiptPlaceLabel(snapshot.locationName, "Store"),
    registerName: customerReceiptPlaceLabel(snapshot.registerName, "Register"),
    cashierName: snapshot.cashierName,
    customerLabel: snapshot.customerLabel,
    lines: snapshot.lines.map((line) => ({
      name: line.displayName ?? line.name,
      sku: line.sku,
      variationLabel: line.variationLabel,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      total: line.total,
    })),
    subtotal: snapshot.subtotal,
    discount: snapshot.discount,
    tax: snapshot.tax,
    total: snapshot.total,
    tender: snapshot.tender,
    cashReceived: snapshot.cashReceived,
    changeDue: snapshot.changeDue,
    documentKind: snapshot.documentKind,
  };
}

export function isCashCheckoutReady(ports: CashCheckoutPorts | undefined | null): boolean {
  return Boolean(
    ports?.checkout &&
      ports.payments &&
      ports.sales &&
      ports.receipts &&
      ports.printer &&
      ports.scope.registerId &&
      ports.scope.shiftId &&
      ports.scope.deviceId,
  );
}

async function settle<T>(run: () => Promise<ApiResult<T>>): Promise<Settled<T>> {
  try {
    return { kind: "result", value: await run() };
  } catch (error) {
    return {
      kind: "unknown",
      message: cashierErrorMessage(
        { message: error instanceof Error ? error.message : undefined },
        "generic",
      ),
    };
  }
}

function shouldResolveFailure(failure: ApiFailure): boolean {
  return failure.error.nextAction === "resolve";
}

function paymentVerified(state: PaymentState): boolean {
  return state.status === "verified";
}

function paymentNeedsResolve(state: PaymentState): boolean {
  return (
    state.nextAction === "resolve" ||
    state.nextAction === "wait" ||
    state.status === "pending" ||
    state.status === "reconciling" ||
    state.status === "initializing" ||
    state.status === "awaiting_customer"
  );
}

function paymentAllowsCashRetry(state: PaymentState): boolean {
  return state.status === "failed" || state.status === "cancelled";
}

export function createCashCheckoutController(ports: CashCheckoutPorts) {
  let currentPorts = ports;
  const createUuid = () => currentPorts.createUuid?.() ?? defaultUuid();
  let session: CheckoutSessionView = idleCheckoutSession();
  let identities: AttemptIdentities | null = null;
  let paymentId: string | undefined;
  let commandLock = false;
  let printAttempted = false;
  const listeners = new Set<() => void>();

  function scopeMatches(record: CheckoutAttemptRecord): boolean {
    return (
      record.registerId === currentPorts.scope.registerId &&
      record.shiftId === currentPorts.scope.shiftId &&
      record.deviceId === currentPorts.scope.deviceId
    );
  }

  function attemptRecord(): CheckoutAttemptRecord | null {
    if (!identities) {
      return null;
    }
    return {
      transactionId: identities.transactionId,
      quoteId: identities.quoteId,
      quoteFingerprint: identities.quoteFingerprint,
      quoteTotalMinor: identities.quoteTotal.minor,
      currency: identities.currency,
      registerId: currentPorts.scope.registerId,
      shiftId: currentPorts.scope.shiftId,
      deviceId: currentPorts.scope.deviceId,
      prepareKey: identities.prepare.idempotencyKey,
      prepareCorrelationId: identities.prepare.correlationId,
      cashKey: identities.cash.idempotencyKey,
      cashCorrelationId: identities.cash.correlationId,
      finalizeKey: identities.finalize.idempotencyKey,
      finalizeCorrelationId: identities.finalize.correlationId,
      cancelKey: identities.cancel?.idempotencyKey,
      cancelCorrelationId: identities.cancel?.correlationId,
      paymentId,
      prepared: session.prepared,
      stage: session.stage,
      saleCompleted: session.saleCompleted,
      message: session.message,
    };
  }

  function persistAttempt(): void {
    const record = attemptRecord();
    if (!currentPorts.attemptStore || !record) {
      return;
    }
    void currentPorts.attemptStore.write(record).catch(() => undefined);
  }

  async function persistAttemptDurable(): Promise<void> {
    const record = attemptRecord();
    if (!currentPorts.attemptStore || !record) {
      return;
    }
    await currentPorts.attemptStore.write(record);
  }

  function restoreAttempt(record: CheckoutAttemptRecord): void {
    identities = {
      quoteId: record.quoteId,
      quoteFingerprint: record.quoteFingerprint,
      quoteTotal: { minor: record.quoteTotalMinor, currency: record.currency },
      transactionId: record.transactionId,
      currency: record.currency,
      prepare: { idempotencyKey: record.prepareKey, correlationId: record.prepareCorrelationId },
      cash: { idempotencyKey: record.cashKey, correlationId: record.cashCorrelationId },
      finalize: { idempotencyKey: record.finalizeKey, correlationId: record.finalizeCorrelationId },
      ...(record.cancelKey && record.cancelCorrelationId
        ? { cancel: { idempotencyKey: record.cancelKey, correlationId: record.cancelCorrelationId } }
        : {}),
    };
    paymentId = record.paymentId;
    const inFlight =
      record.stage === "preparing" ||
      record.stage === "confirming_cash" ||
      record.stage === "finalizing" ||
      record.stage === "resolving_sale" ||
      record.stage === "resolving_payment" ||
      record.stage === "cancelling" ||
      record.stage === "printing";
    session = {
      ...idleCheckoutSession(),
      stage: inFlight ? "resolving_sale" : record.stage,
      message: inFlight
        ? "Sale status is uncertain. Do not start another sale."
        : record.message,
      prepared: record.prepared,
      transactionId: record.transactionId,
      saleCompleted: record.saleCompleted,
    };
  }

  const restored = currentPorts.attemptStore?.readSync() ?? null;
  if (restored && scopeMatches(restored)) {
    restoreAttempt(restored);
  }

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSession(next: CheckoutSessionView): void {
    session = next;
    persistAttempt();
    notify();
  }

  function patch(partial: Partial<CheckoutSessionView>): void {
    setSession({ ...session, ...partial });
  }

  function commandContext(): CommandContext {
    return { idempotencyKey: createUuid(), correlationId: createUuid() };
  }

  function retireAttempt(): void {
    identities = null;
    paymentId = undefined;
    currentPorts.attemptStore?.clear();
  }

  function identitiesFor(quote: Quote): AttemptIdentities {
    if (identities && !session.saleCompleted) {
      return identities;
    }
    if (identities && quoteMatches(identities, quote)) {
      return identities;
    }
    identities = {
      quoteId: quote.id,
      quoteFingerprint: quote.fingerprint,
      quoteTotal: quote.total,
      transactionId: createUuid(),
      currency: quote.currency,
      prepare: commandContext(),
      cash: commandContext(),
      finalize: commandContext(),
    };
    paymentId = undefined;
    printAttempted = false;
    return identities;
  }

  function cancelContextFor(attempt: AttemptIdentities): CommandContext {
    if (!attempt.cancel) {
      attempt.cancel = commandContext();
    }
    return attempt.cancel;
  }

  function preparedViewForResolution(resolution: SaleResolution): PreparedSaleView | undefined {
    if (session.prepared && session.prepared.transactionId === resolution.transactionId) {
      return session.prepared;
    }
    if (
      identities &&
      identities.transactionId === resolution.transactionId &&
      identities.quoteTotal &&
      resolution.orderReference
    ) {
      return {
        transactionId: resolution.transactionId,
        saleId: resolution.saleId ?? session.prepared?.saleId ?? "",
        orderReference: resolution.orderReference,
        quoteFingerprint: identities.quoteFingerprint,
        total: identities.quoteTotal,
      };
    }
    return undefined;
  }

  async function resolveSaleUnlocked(): Promise<void> {
    if (!identities) {
      return;
    }
    patch({
      stage: "resolving_sale",
      message: "Sale status is uncertain. Do not start another sale.",
      inputError: undefined,
    });
    const outcome = await settle(() => currentPorts.sales.resolve(identities!.transactionId));
    if (outcome.kind === "unknown") {
      patch({
        stage: "resolving_sale",
        message: outcome.message,
      });
      return;
    }
    if (!outcome.value.ok) {
      if (shouldResolveFailure(outcome.value)) {
        patch({
          stage: "resolving_sale",
          message: cashierErrorMessage(outcome.value.error, "generic"),
        });
        return;
      }
      patch({
        stage: session.saleCompleted ? "receipt_failed" : "prepare_failed",
        message: cashierErrorMessage(outcome.value.error, "quote"),
      });
      return;
    }
    await applySaleResolution(outcome.value.data);
  }

  async function applySaleResolution(resolution: SaleResolution): Promise<void> {
    paymentId = resolution.paymentId ?? paymentId;
    if (resolution.status === "completed") {
      patch({
        stage: "complete",
        saleCompleted: true,
        transactionId: resolution.transactionId,
        message: "The sale is complete. Loading the official receipt.",
      });
      await loadReceiptUnlocked();
      return;
    }
    if (resolution.status === "prepared") {
      const prepared = preparedViewForResolution(resolution);
      if (!prepared) {
        patch({
          stage: "resolving_sale",
          message: "This sale is ready for payment, but the total could not be recovered. Do not start another sale.",
          transactionId: resolution.transactionId,
        });
        return;
      }
      patch({
        stage: "choose_payment",
        prepared,
        message: "",
        inputError: undefined,
        transactionId: resolution.transactionId,
      });
      return;
    }
    if (resolution.status === "payment_pending") {
      patch({
        stage: "resolving_payment",
        message: "A payment is already pending for this sale. Do not confirm cash again.",
        transactionId: resolution.transactionId,
      });
      await resolvePaymentUnlocked();
      return;
    }
    if (resolution.status === "finalizing") {
      patch({
        stage: "finalizing",
        saleCompleted: false,
        transactionId: resolution.transactionId,
        message: "Completing the sale. Payment has been submitted; do not charge again.",
      });
      if (paymentId) {
        await finalizeUnlocked();
      }
      return;
    }
    if (resolution.status === "requires_attention") {
      patch({
        stage: "finalize_failed",
        message: resolution.message ?? "This transaction needs manager review. Do not start another sale.",
        transactionId: resolution.transactionId,
      });
      return;
    }
      if (resolution.status === "cancelled" || resolution.status === "not_found") {
      if (session.stage === "cancelling" || session.stage === "cancel_failed") {
        retireAttempt();
        setSession(idleCheckoutSession());
        return;
      }
      retireAttempt();
      patch({
        stage: "prepare_failed",
        message: resolution.message ?? "The previous sale attempt was not found. The cart is unchanged.",
        prepared: undefined,
      });
      return;
    }
    patch({
      stage: "resolving_sale",
      message: resolution.message ?? "Sale status is still uncertain. Do not start another sale.",
      transactionId: resolution.transactionId,
    });
  }

  async function resolvePaymentUnlocked(): Promise<void> {
    if (!identities) {
      return;
    }
    patch({
      stage: "resolving_payment",
      message: "Payment status is uncertain. Do not confirm cash again.",
      inputError: undefined,
    });
    const outcome = await settle(() =>
      currentPorts.payments.resolve({
        transactionId: identities!.transactionId,
        paymentId,
      }),
    );
    if (outcome.kind === "unknown") {
      patch({
        stage: "resolving_payment",
        message: outcome.message,
      });
      return;
    }
    if (!outcome.value.ok) {
      patch({
        stage: "resolving_payment",
        message: withDoNotChargeAgain(cashierErrorMessage(outcome.value.error, "payment")),
      });
      return;
    }
    await applyPaymentState(outcome.value.data);
  }

  async function applyPaymentState(state: PaymentState): Promise<void> {
    paymentId = state.paymentId;
    if (paymentVerified(state)) {
      patch({
        stage: "finalizing",
        message: "Completing the sale. Payment has been submitted; do not charge again.",
        inputError: undefined,
      });
      await finalizeUnlocked();
      return;
    }
    if (paymentAllowsCashRetry(state)) {
      patch({
        stage: "cash_failed",
        message: "Cash was not confirmed. The cart is unchanged. Retry uses the same payment attempt.",
      });
      return;
    }
    if (paymentNeedsResolve(state) || state.nextAction === "present_payment") {
      patch({
        stage: "resolving_payment",
        message:
          state.nextAction === "present_payment"
            ? "A payment is already in progress. Do not confirm cash again. Check payment status."
            : "Payment status is uncertain. Do not confirm cash again.",
      });
      return;
    }
    patch({
      stage: "resolving_payment",
      message: "This payment needs review. Do not confirm cash again.",
    });
  }

  async function finalizeUnlocked(): Promise<void> {
    const attempt = identities;
    const verifiedPaymentId = paymentId;
    if (!attempt || !verifiedPaymentId) {
      patch({
        stage: "finalize_failed",
        message: "A verified payment is required before the sale can be finalized.",
      });
      return;
    }
    patch({
      stage: "finalizing",
      message: "Completing the sale. Payment has been submitted; do not charge again.",
    });
    const outcome = await settle(() =>
      currentPorts.checkout.finalize(
        { transactionId: attempt.transactionId, paymentId: verifiedPaymentId },
        attempt.finalize,
      ),
    );
    if (outcome.kind === "unknown" || (outcome.kind === "result" && !outcome.value.ok && shouldResolveFailure(outcome.value))) {
      await resolveSaleUnlocked();
      return;
    }
    if (outcome.kind === "result" && outcome.value.ok) {
      await applySaleResolution(outcome.value.data);
      return;
    }
    if (outcome.kind === "result" && !outcome.value.ok) {
      patch({
        stage: "finalize_failed",
        message: cashierErrorMessage(outcome.value.error, "generic"),
      });
    }
  }

  async function loadReceiptUnlocked(): Promise<void> {
    if (!identities) {
      return;
    }
    const outcome = await settle(() => currentPorts.receipts.getByTransaction(identities!.transactionId));
    if (outcome.kind === "unknown") {
      patch({
        stage: "receipt_failed",
        saleCompleted: true,
        receipt: undefined,
        message: outcome.message,
      });
      return;
    }
    if (!outcome.value.ok) {
      patch({
        stage: "receipt_failed",
        saleCompleted: true,
        receipt: undefined,
        message: cashierErrorMessage(outcome.value.error, "generic"),
      });
      return;
    }
    patch({
      stage: "receipt_ready",
      saleCompleted: true,
      receipt: mapReceiptSnapshot(outcome.value.data),
      message: "The sale is complete.",
      printStatus: "idle",
    });
  }

  async function printUnlocked(reason: "initial" | "reprint"): Promise<void> {
    const receipt = session.receipt;
    if (!receipt) {
      return;
    }
    patch({
      stage: "printing",
      printStatus: "printing",
      printMessage: undefined,
      message: "Sending the receipt to the printer.",
    });
    try {
      const result = await currentPorts.printer.print({ receiptId: receipt.id, reason });
      printAttempted = true;
      if (result.status === "dialog_opened") {
        patch({
          stage: "receipt_ready",
          printStatus: "dialog_opened",
          printMessage: "Print dialog opened.",
          message: "The sale is complete.",
        });
        return;
      }
      patch({
        stage: "print_failed",
        printStatus: result.status,
        printMessage: "Printing failed. The sale remains complete.",
        message: "Printing failed. The sale remains complete.",
      });
    } catch {
      printAttempted = true;
      patch({
        stage: "print_failed",
        printStatus: "failed",
        printMessage: "Printing failed. The sale remains complete.",
        message: "Printing failed. The sale remains complete.",
      });
    }
  }

  return {
    getSession(): CheckoutSessionView {
      return session;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isLocked(): boolean {
      return commandLock;
    },
    replacePorts(next: CashCheckoutPorts): void {
      currentPorts = {
        ...next,
        attemptStore: currentPorts.attemptStore ?? next.attemptStore,
      };
    },
    async startPrepare(quote: Quote | undefined, customerSnapshot?: CustomerSummary): Promise<void> {
      if (commandLock || session.saleCompleted) {
        return;
      }
      const stored = currentPorts.attemptStore?.readSync() ?? null;
      if (stored && !stored.saleCompleted && !scopeMatches(stored)) {
        patch({
          stage: "resolving_sale",
          message: "A sale is already in progress on this device. Do not start another sale.",
        });
        return;
      }
      if (identities && quote && !session.saleCompleted && !quoteMatches(identities, quote)) {
        if (!session.prepared) {
          patch({
            stage: "resolving_sale",
            message: "This checkout already has a sale in progress. Check that sale before starting another.",
            transactionId: identities.transactionId,
          });
        }
        return;
      }
      if (!quote || !quote.purchasable) {
        return;
      }
      if (session.prepared && !session.saleCompleted) {
        if (
          identities &&
          quoteMatches(identities, quote) &&
          (session.stage === "idle" ||
            session.stage === "choose_payment" ||
            session.stage === "cash" ||
            session.stage === "cash_failed")
        ) {
          patch({
            stage: session.stage === "cash" || session.stage === "cash_failed" ? session.stage : "choose_payment",
            message: session.stage === "cash_failed" ? session.message : "",
            inputError: undefined,
          });
        }
        return;
      }
      if (session.stage !== "idle" && session.stage !== "prepare_failed") {
        return;
      }
      commandLock = true;
      const attempt = identitiesFor(quote);
      patch({
        stage: "preparing",
        message: "Checking price and stock…",
        inputError: undefined,
        receipt: undefined,
        transactionId: attempt.transactionId,
        saleCompleted: false,
      });
      try {
        try {
          await persistAttemptDurable();
        } catch {
          patch({
            stage: "prepare_failed",
            message: "This sale could not be saved on this device. Retry before taking payment.",
            transactionId: attempt.transactionId,
            saleCompleted: false,
          });
          return;
        }
        const outcome = await settle(() =>
          currentPorts.checkout.prepare(
            {
              transactionId: attempt.transactionId,
              registerId: currentPorts.scope.registerId,
              shiftId: currentPorts.scope.shiftId,
              deviceId: currentPorts.scope.deviceId,
              quoteId: quote.id,
              quoteFingerprint: quote.fingerprint,
              ...(customerSnapshot ? { customerSnapshot } : {}),
            },
            attempt.prepare,
          ),
        );
        if (outcome.kind === "unknown" || (outcome.kind === "result" && !outcome.value.ok && shouldResolveFailure(outcome.value))) {
          await resolveSaleUnlocked();
          return;
        }
        if (outcome.kind === "result" && outcome.value.ok) {
          patch({
            stage: "choose_payment",
            prepared: mapPrepared(outcome.value.data),
            transactionId: outcome.value.data.transactionId,
            message: "",
          });
          return;
        }
        if (outcome.kind === "result" && !outcome.value.ok) {
          patch({
            stage: "prepare_failed",
            message: cashierErrorMessage(outcome.value.error, "quote"),
            prepared: undefined,
          });
        }
      } finally {
        commandLock = false;
        notify();
      }
    },
    async resolveSale(): Promise<void> {
      if (commandLock) {
        return;
      }
      commandLock = true;
      try {
        await resolveSaleUnlocked();
      } finally {
        commandLock = false;
        notify();
      }
    },
    async confirmCash(cashReceivedText: string): Promise<void> {
      if (commandLock || session.saleCompleted) {
        return;
      }
      if (session.stage !== "cash" && session.stage !== "cash_failed") {
        return;
      }
      if (!identities) {
        return;
      }
      const attempt = identities;
      const parsed = parseDecimalToMinorUnits(cashReceivedText, { emptyMessage: "Enter the cash received." });
      if (!parsed.ok) {
        patch({ inputError: parsed.message });
        return;
      }
      commandLock = true;
      patch({
        stage: "confirming_cash",
        message: "Confirming cash payment. Do not start another payment.",
        inputError: undefined,
      });
      try {
        const outcome = await settle(() =>
          currentPorts.payments.confirmCash(
            {
              transactionId: attempt.transactionId,
              cashReceived: {
                minor: parsed.minor,
                currency: session.prepared?.total.currency ?? attempt.currency,
              },
            },
            attempt.cash,
          ),
        );
        if (outcome.kind === "unknown" || (outcome.kind === "result" && !outcome.value.ok && shouldResolveFailure(outcome.value))) {
          await resolvePaymentUnlocked();
          return;
        }
        if (outcome.kind === "result" && outcome.value.ok) {
          await applyPaymentState(outcome.value.data);
          return;
        }
        if (outcome.kind === "result" && !outcome.value.ok) {
          patch({
            stage: "cash_failed",
            message: cashierErrorMessage(outcome.value.error, "payment"),
          });
        }
      } finally {
        commandLock = false;
        notify();
      }
    },
    async resolvePayment(): Promise<void> {
      if (commandLock) {
        return;
      }
      commandLock = true;
      try {
        await resolvePaymentUnlocked();
      } finally {
        commandLock = false;
        notify();
      }
    },
    selectCash(): void {
      if (commandLock || session.saleCompleted || !session.prepared) {
        return;
      }
      if (session.stage !== "choose_payment" && session.stage !== "cash" && session.stage !== "cash_failed") {
        return;
      }
      patch({
        stage: session.stage === "cash_failed" ? "cash_failed" : "cash",
        message: session.stage === "cash_failed" ? session.message : "",
        inputError: undefined,
      });
    },
    backToPaymentChoice(): void {
      if (commandLock || session.saleCompleted || !session.prepared) {
        return;
      }
      if (!canReturnToPaymentChoice(session.stage)) {
        return;
      }
      patch({
        stage: "choose_payment",
        message: "",
        inputError: undefined,
      });
    },
    async cancelPreparedSale(reason = "cashier_cancelled_prepared_sale"): Promise<void> {
      if (commandLock || session.saleCompleted || !identities || !session.prepared) {
        return;
      }
      if (
        session.stage !== "choose_payment" &&
        session.stage !== "cash" &&
        session.stage !== "cash_failed" &&
        session.stage !== "cancel_failed"
      ) {
        return;
      }
      const attempt = identities;
      commandLock = true;
      patch({
        stage: "cancelling",
        message: "Checking sale status…",
        inputError: undefined,
      });
      try {
        const outcome = await settle(() =>
          currentPorts.sales.cancel({ transactionId: attempt.transactionId, reason }, cancelContextFor(attempt)),
        );
        if (outcome.kind === "unknown" || (outcome.kind === "result" && !outcome.value.ok && shouldResolveFailure(outcome.value))) {
          await resolveSaleUnlocked();
          return;
        }
        if (outcome.kind === "result" && outcome.value.ok) {
          await applySaleResolution(outcome.value.data);
          return;
        }
        if (outcome.kind === "result" && !outcome.value.ok) {
          patch({
            stage: "cancel_failed",
            message: cashierErrorMessage(outcome.value.error, "generic"),
          });
        }
      } finally {
        commandLock = false;
        notify();
      }
    },
    async retryFinalize(): Promise<void> {
      if (commandLock || !paymentId) {
        return;
      }
      commandLock = true;
      try {
        await finalizeUnlocked();
      } finally {
        commandLock = false;
        notify();
      }
    },
    async loadReceipt(): Promise<void> {
      if (commandLock || !session.saleCompleted) {
        return;
      }
      commandLock = true;
      try {
        await loadReceiptUnlocked();
      } finally {
        commandLock = false;
        notify();
      }
    },
    async printReceipt(): Promise<void> {
      if (commandLock || !session.receipt) {
        return;
      }
      commandLock = true;
      try {
        await printUnlocked(printAttempted ? "reprint" : "initial");
      } finally {
        commandLock = false;
        notify();
      }
    },
    dismiss(): void {
      if (commandLock) {
        return;
      }
      if (!checkoutDismissAllowed(session)) {
        return;
      }
      retireAttempt();
      patch({
        stage: "idle",
        message: "",
        inputError: undefined,
        prepared: undefined,
        transactionId: undefined,
      });
    },
    resetForNewSale(): void {
      if (!canBeginNewSale(session)) {
        return;
      }
      retireAttempt();
      printAttempted = false;
      commandLock = false;
      setSession(idleCheckoutSession());
    },
  };
}

export type CashCheckoutController = ReturnType<typeof createCashCheckoutController>;
