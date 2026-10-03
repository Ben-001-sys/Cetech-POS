import type {
  CashMovement,
  CustomerContext,
  CustomerSummary,
  Id,
  Money,
  PaymentTender,
  PendingOperation,
  PreparedSale,
  Quantity,
  ReceiptLine,
  ReceiptSnapshot,
  Register,
  SaleStatus,
  Quote,
  Session,
  Shift,
  ShiftReport,
  Timestamp,
  Uuid,
  VerifiedPaymentEvidence,
} from "../../../../../docs/contracts/domain.generated";
import type { PrepareIntentSnapshot } from "../receipt/prepare-intent";

export type StaffActor = Pick<Session, "actorId" | "displayName" | "organizationId" | "locationIds">;

export type StoredRegister = Register & {
  readonly organizationId: Id;
  /** Human location label captured for new receipts. Absent on older register rows. */
  readonly locationName?: string;
  /** Durable parent lifecycle for new work. Absent only on legacy/local fixtures. */
  readonly locationStatus?: "active" | "inactive";
};

export type StoredDevice = {
  readonly id: Uuid;
  readonly organizationId: Id;
  readonly locationId: Id;
  readonly status: "active" | "inactive";
};

export type StoredShift = Shift & {
  readonly organizationId: Id;
  readonly locationId: Id;
};

export type StoredCashMovement = CashMovement & {
  readonly organizationId: Id;
  readonly refundId?: Uuid;
};

export type StoredPaymentStatus =
  | "initializing"
  | "awaiting_customer"
  | "pending"
  | "cancelled"
  | "failed"
  | "reconciling"
  | "requires_attention"
  | "verified";

export type PaymentVerificationSource =
  | "cash_ledger"
  | "provider_server_verification"
  | "approved_external_attestation";

export type StoredPayment = {
  readonly paymentId: Uuid;
  readonly transactionId: Uuid;
  readonly saleId: Id;
  readonly evidenceId?: Uuid;
  readonly tender: PaymentTender;
  readonly status: StoredPaymentStatus;
  readonly amount: Money;
  readonly cashReceived?: Money;
  readonly verifiedAt?: Timestamp;
  readonly verificationSource?: PaymentVerificationSource;
  readonly actorId: Id;
  readonly provider?: string;
  readonly providerReference?: string;
  readonly providerTransactionId?: string;
  readonly displayReference?: string;
  readonly accessCode?: string;
  readonly initializeStatus?: "pending_remote" | "initialized" | "lost_response";
  readonly lastVerifiedAt?: Timestamp;
  readonly attentionReason?: string;
};

export type StoredProviderEvent = {
  readonly id: Uuid;
  readonly organizationId?: Id;
  readonly locationId?: Id;
  readonly provider: string;
  readonly providerReference?: string;
  readonly providerTransactionId?: string;
  readonly eventType: string;
  readonly eventFingerprint: string;
  readonly rawBodyHash: string;
  readonly receivedAt: Timestamp;
  readonly processingStatus: "ingested" | "processed" | "ignored" | "requires_attention";
  readonly normalizedStatus?: string;
  readonly paymentId?: Uuid;
  readonly transactionId?: Uuid;
};

export type StoredSaleOrderLine = {
  readonly orderLineId: Id;
  readonly quantity: Quantity;
  readonly subtotal: Money;
  readonly discount: Money;
  readonly tax: Money;
  readonly total: Money;
};

export type PosSaleRecord = {
  readonly organizationId: Id;
  readonly locationId: Id;
  readonly locationName: string;
  readonly registerId: Id;
  readonly registerName: string;
  readonly deviceId: Uuid;
  readonly shiftId: Uuid;
  readonly cashierId: Id;
  readonly cashierName: string;
  readonly customer: CustomerContext;
  readonly customerLabel: string;
  readonly customerSnapshot?: CustomerSummary;
  readonly prepared: PreparedSale;
  readonly lines: readonly ReceiptLine[];
  readonly orderLines?: readonly StoredSaleOrderLine[];
  readonly quoteId?: Id;
  readonly subtotal: Money;
  readonly discount: Money;
  readonly tax: Money;
  status: SaleStatus;
  assignedPaymentId?: Uuid;
  commercialConfirmed: boolean;
  receipt?: ReceiptSnapshot;
};

export type OutboxEvent = {
  readonly id: Uuid;
  readonly organizationId: Id;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: Readonly<Record<string, string>>;
  readonly createdAt: Timestamp;
  publishedAt?: Timestamp;
};

export type IdempotencyClaim =
  | { readonly kind: "acquired" }
  | { readonly kind: "in_progress" }
  | { readonly kind: "conflict" }
  | { readonly kind: "replay"; readonly outcome: unknown }
  | { readonly kind: "repair"; readonly outcome: unknown };

export type CommandScopeBinding = {
  readonly organizationId: Id;
  readonly locationId: Id;
  readonly registerId?: Id;
  readonly shiftId?: Uuid;
  readonly transactionId?: Uuid;
  readonly operation: PendingOperation["operation"];
};

/** Known commercial effect of one sale.prepare attempt. Stored inside outcome, not a second intent. */
export type PrepareEffectCertainty =
  | "none"
  | "unknown"
  | "not_found"
  | "prepared"
  | "payment_pending"
  | "finalizing"
  | "completed"
  | "cancelled";

export type PrepareOperationDiagnostic = {
  readonly organizationId: Id;
  readonly idempotencyKey: Uuid;
  readonly transactionId?: Uuid;
  readonly status: PendingOperation["status"];
  readonly attempts: number;
  readonly lastAttemptAt?: Timestamp;
  readonly lastErrorCode?: string;
  readonly outcome?: unknown;
  readonly intentPresent: boolean;
};

export type CommandScopeFields = {
  readonly registerId?: Id;
  readonly shiftId?: Uuid;
  readonly transactionId?: Uuid;
};

export type SeedPreparedSaleInput = {
  readonly organizationId: Id;
  readonly locationId: Id;
  readonly locationName: string;
  readonly registerId: Id;
  readonly registerName: string;
  readonly deviceId: Uuid;
  readonly shiftId: Uuid;
  readonly cashierId: Id;
  readonly cashierName: string;
  readonly customer: CustomerContext;
  readonly customerLabel: string;
  readonly customerSnapshot?: CustomerSummary;
  readonly prepared: PreparedSale;
  readonly lines: readonly ReceiptLine[];
  readonly orderLines?: readonly StoredSaleOrderLine[];
  readonly quoteId?: Id;
  readonly subtotal: Money;
  readonly discount: Money;
  readonly tax: Money;
};

export interface CheckoutStore {
  seedRegister(register: StoredRegister): Promise<void>;
  seedDevice(device: StoredDevice): Promise<void>;
  getRegister(id: Id): Promise<StoredRegister | undefined>;
  getDevice(id: Uuid): Promise<StoredDevice | undefined>;
  getActiveShift(registerId: Id): Promise<StoredShift | undefined>;
  getShift(id: Uuid): Promise<StoredShift | undefined>;
  insertOpenShift(shift: StoredShift): Promise<"ok" | "conflict">;
  closeShift(input: {
    readonly shiftId: Uuid;
    readonly countedCash: Money;
    readonly status: "closed" | "requires_attention";
    readonly closedAt?: Timestamp;
    readonly zReportId?: Id;
  }): Promise<"ok" | "missing" | "not_open" | "already_closed">;
  saveShiftReport(report: ShiftReport): Promise<"ok" | "duplicate">;
  getShiftReport(shiftId: Uuid, kind: "X" | "Z"): Promise<ShiftReport | undefined>;
  appendCashMovement(movement: StoredCashMovement): Promise<"ok" | "duplicate_sale" | "duplicate_refund" | "shift_required" | "negative_expected">;
  listCashSales(transactionId: Uuid): Promise<readonly StoredCashMovement[]>;
  listCashRefunds(refundId: Uuid): Promise<readonly StoredCashMovement[]>;
  expectedCash(shiftId: Uuid): Promise<Money | undefined>;
  saveQuote(quote: Quote): Promise<void>;
  getQuote(quoteId: Id): Promise<Quote | undefined>;
  seedPreparedSale(input: SeedPreparedSaleInput): Promise<PosSaleRecord>;
  getSale(transactionId: Uuid): Promise<PosSaleRecord | undefined>;
  getSaleBySaleId(organizationId: Id, saleId: Id): Promise<PosSaleRecord | undefined>;
  listRecentSales(input: {
    readonly organizationId: Id;
    readonly locationIds?: readonly Id[];
    readonly limit?: number;
  }): Promise<readonly PosSaleRecord[]>;
  saveSale(sale: PosSaleRecord): Promise<void>;
  getPayment(paymentId: Uuid): Promise<StoredPayment | undefined>;
  getPaymentForTransaction(transactionId: Uuid): Promise<StoredPayment | undefined>;
  getPaymentByProviderReference(provider: string, reference: string): Promise<StoredPayment | undefined>;
  savePayment(payment: StoredPayment): Promise<void>;
  listUncertainPayments(input: {
    readonly organizationId: Id;
    readonly locationIds?: readonly Id[];
    readonly limit?: number;
  }): Promise<readonly StoredPayment[]>;
  listAttentionShifts(input: {
    readonly organizationId: Id;
    readonly locationIds?: readonly Id[];
    readonly limit?: number;
  }): Promise<readonly StoredShift[]>;
  listAttentionOperations(input: {
    readonly organizationId: Id;
    readonly locationIds?: readonly Id[];
    readonly limit?: number;
  }): Promise<readonly CommandScopeBinding[]>;
  saveProviderEvent(event: StoredProviderEvent): Promise<"inserted" | "duplicate">;
  getProviderEvent(provider: string, fingerprint: string): Promise<StoredProviderEvent | undefined>;
  getReceipt(transactionId: Uuid): Promise<ReceiptSnapshot | undefined>;
  saveReceipt(receipt: ReceiptSnapshot): Promise<"ok" | "duplicate">;
  enqueueOutbox(event: OutboxEvent): Promise<void>;
  listOutbox(aggregateId: string): Promise<readonly OutboxEvent[]>;
  lookupCommandScope(input: {
    readonly transactionId: Uuid;
    readonly operation: PendingOperation["operation"];
  }): Promise<CommandScopeBinding | undefined>;
  claimIdempotency(
    organizationId: Id,
    operation: PendingOperation["operation"],
    idempotencyKey: Uuid,
    requestHash: string,
    locationId?: Id,
    scope?: CommandScopeFields,
  ): Promise<IdempotencyClaim>;
  markIdempotencySent(organizationId: Id, operation: PendingOperation["operation"], idempotencyKey: Uuid): Promise<void>;
  bindPrepareIntent(
    organizationId: Id,
    operation: PendingOperation["operation"],
    idempotencyKey: Uuid,
    snapshot: PrepareIntentSnapshot,
  ): Promise<PrepareIntentSnapshot>;
  getPrepareIntent(
    organizationId: Id,
    operation: PendingOperation["operation"],
    idempotencyKey: Uuid,
  ): Promise<PrepareIntentSnapshot | undefined>;
  acknowledgeIdempotency(
    organizationId: Id,
    operation: PendingOperation["operation"],
    idempotencyKey: Uuid,
    outcome: unknown,
  ): Promise<void>;
  markIdempotencyRequiresAttention(
    organizationId: Id,
    operation: PendingOperation["operation"],
    idempotencyKey: Uuid,
    outcome: unknown,
  ): Promise<void>;
  releaseIdempotency(organizationId: Id, operation: PendingOperation["operation"], idempotencyKey: Uuid): Promise<void>;
  recordPrepareDiagnostic(input: {
    readonly organizationId: Id;
    readonly operation: PendingOperation["operation"];
    readonly idempotencyKey: Uuid;
    readonly status: PendingOperation["status"];
    readonly attemptedAt: Timestamp;
    readonly countAttempt: boolean;
    readonly errorCode?: string;
    readonly outcome?: unknown;
  }): Promise<void>;
  readPrepareDiagnostic(
    organizationId: Id,
    operation: PendingOperation["operation"],
    idempotencyKey: Uuid,
  ): Promise<PrepareOperationDiagnostic | undefined>;
  findSalePrepareOperation(transactionId: Uuid): Promise<PrepareOperationDiagnostic | undefined>;
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
  peekIdempotency(
    organizationId: Id,
    operation: PendingOperation["operation"],
    idempotencyKey: Uuid,
  ): Promise<PendingOperation["status"] | undefined>;
}

/**
 * Test-only persistence faults. Durable adapters must not carry process-local
 * fault switches as business semantics.
 */
export interface FaultInjectingCheckoutStore extends CheckoutStore {
  failNextReceiptWrite: boolean;
  failNextPaymentWrite: boolean;
  failNextSaleWrite: boolean;
  failNextCommercialConfirmedWrite: boolean;
  failNextIntentWrite: boolean;
  receiptWriteAttempts: number;
}

export function evidenceFromPayment(payment: StoredPayment): VerifiedPaymentEvidence {
  if (
    payment.status !== "verified" ||
    !payment.evidenceId ||
    !payment.verifiedAt ||
    !payment.verificationSource
  ) {
    throw new Error("payment evidence is not verified");
  }
  return {
    evidenceId: payment.evidenceId,
    transactionId: payment.transactionId,
    paymentId: payment.paymentId,
    saleId: payment.saleId,
    amount: payment.amount,
    tender: payment.tender,
    verifiedAt: payment.verifiedAt,
    verificationSource: payment.verificationSource,
  };
}

export function moneyEqual(left: Money, right: Money): boolean {
  return left.minor === right.minor && left.currency === right.currency;
}

export function customerEqual(left: CustomerContext, right: CustomerContext): boolean {
  if (left.kind === "walkin" || right.kind === "walkin") {
    return left.kind === right.kind;
  }
  return left.kind === right.kind && left.customerId === right.customerId;
}
