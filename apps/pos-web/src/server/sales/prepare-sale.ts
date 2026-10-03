import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import type {
  ApiFailure,
  CommandContext,
  CustomerSummary,
  PreparedSale,
  PrepareSaleRequest,
  Quote,
  ReceiptLine,
  ReceiptSnapshot,
  SaleResolution,
  Uuid,
} from "../../../../../docs/contracts/domain.generated";
import { customerReceiptPlaceLabel } from "../../core/receipt/customer-presentation";
import { loadSalePresentation } from "../../core/receipt/build-receipt-line";
import type { CatalogPresentationLookup } from "../../core/receipt/catalog-presentation";
import {
  buildPrepareIntentSnapshot,
  prepareIntentMatchesRequest,
  type PrepareIntentSnapshot,
} from "../../core/receipt/prepare-intent";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { toIsoTimestamp } from "../auth/ids";
import { apiFailure } from "../http/api-failure";
import { moneyEqual, type CheckoutStore, type PrepareEffectCertainty, type StaffActor } from "../../core/checkout/types";
import { claimKindForExistingPrepare } from "../../core/checkout/prepare-claim";
import { isDefinitivePreEffectRejection, prepareEffectEvidence, withPreEffectSignal } from "./prepare-effect";
import { isPreparedSale, isSaleResolution } from "./schema";
import { assertBindingMatchesPrepareRequest, assertSaleMatchesPrepareRequest } from "./transaction-scope";

export async function prepareSale(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "prepare" | "resolve">;
  readonly catalogLookup: CatalogPresentationLookup;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
  /** Management recovery may only replay/repair an already claimed original order. */
  readonly requireOriginalRepair?: boolean;
}): Promise<ApiResult<PreparedSale>> {
  const { store, salesPort, actor, request, context, now } = input;
  const requestStartedAt = Date.now();
  return store.withLock(`prepare:${request.transactionId}`, async () => {
    if (input.requireOriginalRepair) {
      const original = await store.findSalePrepareOperation(request.transactionId);
      if (!original || original.organizationId !== actor.organizationId || original.transactionId !== request.transactionId ||
          original.idempotencyKey !== context.idempotencyKey || !["repair", "replay"].includes(claimKindForExistingPrepare({
            status: original.status, outcome: original.outcome, intentPresent: original.intentPresent,
          }))) {
        return apiFailure("REQUIRES_ATTENTION", "The original sale is not available for an existing-order repair. No new order was requested.", context.correlationId);
      }
    }
    const existing = await store.getSale(request.transactionId);
    if (existing) {
      const matched = assertSaleMatchesPrepareRequest({
        sale: existing,
        actor,
        request,
        correlationId: context.correlationId,
      });
      if (!matched.ok) {
        return matched;
      }
      if (existing.prepared.quoteFingerprint !== request.quoteFingerprint) {
        return apiFailure(
          "REQUIRES_ATTENTION",
          "This transaction already has a prepared sale with a different quote",
          context.correlationId,
        );
      }
    } else {
      const scoped = await assertPrepareScope({ store, actor, request, context, now });
      if (!scoped.ok) {
        // Quote expiry prevents a new order, not a repair of the already claimed
        // original order. The original hash is checked by claimIdempotency below;
        // every remaining scope check is repeated before any repair dispatch.
        if (scoped.error.code !== "QUOTE_EXPIRED" || !(await hasOriginalRepairIntent(input))) {
          return scoped;
        }
      }
      const foreign = await store.lookupCommandScope({
        transactionId: request.transactionId,
        operation: "sale.prepare",
      });
      if (foreign) {
        const bound = assertBindingMatchesPrepareRequest({
          binding: foreign,
          actor,
          request,
          correlationId: context.correlationId,
        });
        if (!bound.ok) {
          return bound;
        }
        const original = await store.findSalePrepareOperation(request.transactionId);
        if (original && original.idempotencyKey !== context.idempotencyKey) {
          return apiFailure(
            "IDEMPOTENCY_CONFLICT",
            "This transaction belongs to its original prepare key. Check or recover that same attempt.",
            context.correlationId,
          );
        }
      }
    }

    const registerForClaim = existing ?? (await store.getRegister(request.registerId));
    const hash = await sha256Hex(canonicalJson(request));
    const claim = await store.claimIdempotency(
      actor.organizationId,
      "sale.prepare",
      context.idempotencyKey,
      hash,
      registerForClaim?.locationId ?? actor.locationIds[0],
      {
        registerId: existing?.registerId ?? request.registerId,
        shiftId: existing?.shiftId ?? request.shiftId,
        ...(existing ? {} : { transactionId: request.transactionId }),
      },
    );
    if (claim.kind === "conflict") {
      return apiFailure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different PrepareSaleRequest",
        context.correlationId,
      );
    }
    if (claim.kind === "in_progress") {
      return apiFailure("OPERATION_IN_PROGRESS", "prepare is already in progress for this key", context.correlationId);
    }
    if (claim.kind === "replay") {
      const replay = replayPrepared(claim.outcome, context.correlationId);
      if (!replay.ok) return replay;
      return replayUnpaidPrepared({
        store, actor, request, context, prepared: replay.data,
        currentTime: () => new Date(now.getTime() + Math.max(0, Date.now() - requestStartedAt)),
      });
    }
    if (claim.kind === "repair") {
      return settleSentPrepare({
        store,
        salesPort,
        actor,
        request,
        context,
        now,
        failure: undefined,
        forceResolve: true,
        allowOriginalRepair: true,
        repairNow: () => new Date(now.getTime() + Math.max(0, Date.now() - requestStartedAt)),
      });
    }

    if (input.requireOriginalRepair) {
      return apiFailure(
        "REQUIRES_ATTENTION",
        "The original sale is no longer eligible for repair. No new commercial order was requested.",
        context.correlationId,
      );
    }

    try {
      const result = await completePrepare({
        store,
        salesPort,
        catalogLookup: input.catalogLookup,
        actor,
        request,
        context,
        now,
      });
      if (!result.ok) {
        return settleSentPrepare({
          store,
          salesPort,
          actor,
          request,
          context,
          now,
          failure: result,
        });
      }
      await store.acknowledgeIdempotency(actor.organizationId, "sale.prepare", context.idempotencyKey, result.data);
      return result;
    } catch {
      return settleSentPrepare({
        store,
        salesPort,
        actor,
        request,
        context,
        now,
        failure: undefined,
      });
    }
  });
}

async function completePrepare(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "prepare" | "resolve">;
  readonly catalogLookup: CatalogPresentationLookup;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
}): Promise<ApiResult<PreparedSale>> {
  const existing = await input.store.getSale(input.request.transactionId);
  if (existing) {
    const matched = assertSaleMatchesPrepareRequest({
      sale: existing,
      actor: input.actor,
      request: input.request,
      correlationId: input.context.correlationId,
    });
    if (!matched.ok) {
      return matched;
    }
    if (existing.prepared.quoteFingerprint !== input.request.quoteFingerprint) {
      return apiFailure(
        "REQUIRES_ATTENTION",
        "This transaction already has a prepared sale with a different quote",
        input.context.correlationId,
      );
    }
    return { ok: true, data: existing.prepared, correlationId: input.context.correlationId };
  }

  const scoped = await assertPrepareScope(input);
  if (!scoped.ok) {
    return scoped;
  }
  const quote = scoped.data.quote;
  const intent = await loadOrBindPrepareIntent({
    store: input.store,
    catalogLookup: input.catalogLookup,
    actor: input.actor,
    request: input.request,
    context: input.context,
    quote,
  });
  if (!intent.ok) {
    return intent;
  }

  await notePrepareDispatch(input);

  const commercial = await input.salesPort.prepare(input.request, input.context);
  if (!commercial.ok) {
    return commercial;
  }
  if (!isPreparedSale(commercial.data)) {
    return apiFailure("INTEGRATION_UNAVAILABLE", "bridge returned an invalid PreparedSale", input.context.correlationId);
  }
  if (!moneyEqual(commercial.data.total, quote.total)) {
    return apiFailure(
      "INTEGRATION_UNAVAILABLE",
      "bridge PreparedSale total does not match the stored authoritative quote",
      input.context.correlationId,
    );
  }
  return persistPrepared({
    store: input.store,
    actor: input.actor,
    request: input.request,
    prepared: commercial.data,
    quote,
    lines: intent.data.lines,
    context: input.context,
  });
}

async function recoverPrepared(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "prepare" | "resolve">;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
  readonly knownResolution?: ApiResult<SaleResolution>;
}): Promise<ApiResult<PreparedSale>> {
  const local = await input.store.getSale(input.request.transactionId);
  if (local) {
    const matched = assertSaleMatchesPrepareRequest({
      sale: local,
      actor: input.actor,
      request: input.request,
      correlationId: input.context.correlationId,
    });
    if (!matched.ok) {
      return matched;
    }
    return { ok: true, data: local.prepared, correlationId: input.context.correlationId };
  }
  const binding = await input.store.lookupCommandScope({
    transactionId: input.request.transactionId,
    operation: "sale.prepare",
  });
  if (!binding) {
    return apiFailure("NOT_FOUND", "prepared sale was not found", input.context.correlationId);
  }
  const bound = assertBindingMatchesPrepareRequest({
    binding,
    actor: input.actor,
    request: input.request,
    correlationId: input.context.correlationId,
  });
  if (!bound.ok) {
    return bound;
  }
  const resolved = input.knownResolution ?? (await input.salesPort.resolve(input.request.transactionId));
  if (!resolved.ok) {
    return resolved;
  }
  if (resolved.data.status !== "prepared") {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "This sale is not an unpaid prepared sale. Do not take payment for this attempt.",
      input.context.correlationId,
    );
  }
  return materializeRemotePrepared({
    store: input.store,
    actor: input.actor,
    transactionId: input.request.transactionId,
    correlationId: input.context.correlationId,
    now: input.now,
    resolution: resolved.data,
  });
}

export const RECEIPT_MISSING =
  "This sale is complete, but the official receipt is not on this register. Do not take payment again. Contact a manager.";
export const CANCELLED_ATTEMPT = "This sale was cancelled. The cart is unchanged.";
export const PAYMENT_ALREADY_SUBMITTED = "Completing the sale. Payment has been submitted; do not charge again.";
export const PAYMENT_ALREADY_PENDING = "A payment is already pending for this sale. Do not confirm cash again.";

export async function findOfficialReceipt(
  store: CheckoutStore,
  transactionId: Uuid,
): Promise<ReceiptSnapshot | undefined> {
  const sale = await store.getSale(transactionId);
  if (sale?.receipt && sale.receipt.transactionId === transactionId && sale.receipt.id.length > 0) {
    return sale.receipt;
  }
  const stored = await store.getReceipt(transactionId);
  if (stored && stored.transactionId === transactionId && stored.id.length > 0) {
    return stored;
  }
  return undefined;
}

/**
 * Persist a payment-ready prepared sale only from the durable intent, the stored quote,
 * and the remote sale identity. Never from the current catalog.
 */
export async function materializeRemotePrepared(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly transactionId: Uuid;
  readonly correlationId: Uuid;
  readonly now: Date;
  readonly resolution: SaleResolution;
}): Promise<ApiResult<PreparedSale>> {
  const local = await input.store.getSale(input.transactionId);
  if (local) {
    if (local.organizationId !== input.actor.organizationId || !input.actor.locationIds.includes(local.locationId)) {
      return apiFailure("FORBIDDEN", "sale location is out of staff scope", input.correlationId);
    }
    const operation = await input.store.findSalePrepareOperation(input.transactionId);
    if (operation && operation.status !== "acknowledged") {
      await input.store.acknowledgeIdempotency(
        input.actor.organizationId,
        "sale.prepare",
        operation.idempotencyKey,
        local.prepared,
      );
    }
    return { ok: true, data: local.prepared, correlationId: input.correlationId };
  }
  if (input.resolution.status !== "prepared" || !input.resolution.saleId || !input.resolution.orderReference) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "The remote prepared sale is missing a sale id or order reference, so payment stays closed.",
      input.correlationId,
    );
  }
  const operation = await input.store.findSalePrepareOperation(input.transactionId);
  const intent = operation
    ? await input.store.getPrepareIntent(operation.organizationId, "sale.prepare", operation.idempotencyKey)
    : undefined;
  if (!operation || !intent || intent.transactionId !== input.transactionId || intent.lines.length === 0) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "Durable sale-time presentation is missing, so this prepared sale cannot be opened for payment.",
      input.correlationId,
    );
  }
  const quote = await input.store.getQuote(intent.quoteId);
  if (
    !quote ||
    quote.fingerprint !== intent.quoteFingerprint ||
    Date.parse(quote.expiresAt) <= input.now.getTime() ||
    !quote.purchasable
  ) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "The stored quote is no longer valid, so this prepared sale cannot be opened for payment. Current catalog data was not used.",
      input.correlationId,
    );
  }
  const quoteLineIds = quote.lines.map((line) => line.lineId);
  if (
    quoteLineIds.length !== intent.lineIds.length ||
    quoteLineIds.some((lineId, index) => lineId !== intent.lineIds[index])
  ) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "Durable sale-time presentation does not match the stored quote, so payment stays closed.",
      input.correlationId,
    );
  }
  const binding = await input.store.lookupCommandScope({
    transactionId: input.transactionId,
    operation: "sale.prepare",
  });
  const shift = binding?.shiftId ? await input.store.getShift(binding.shiftId) : undefined;
  if (!binding?.registerId || !shift) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "The register or shift for this prepared sale is missing, so payment stays closed.",
      input.correlationId,
    );
  }
  const request: PrepareSaleRequest = {
    transactionId: input.transactionId,
    registerId: binding.registerId,
    shiftId: shift.id,
    deviceId: shift.deviceId,
    quoteId: intent.quoteId,
    quoteFingerprint: intent.quoteFingerprint,
  };
  const context: CommandContext = {
    idempotencyKey: operation.idempotencyKey,
    correlationId: input.correlationId,
  };
  const scoped = await assertPrepareScope({
    store: input.store,
    actor: input.actor,
    request,
    context,
    now: input.now,
  });
  if (!scoped.ok) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "This prepared sale cannot be opened for payment from the stored quote and register. Current catalog data was not used.",
      input.correlationId,
    );
  }
  const prepared: PreparedSale = {
    transactionId: input.transactionId,
    saleId: input.resolution.saleId,
    orderReference: input.resolution.orderReference,
    quoteFingerprint: intent.quoteFingerprint,
    total: quote.total,
    status: "prepared",
    stockCommitment: "reserved",
    preparedAt: toIsoTimestamp(input.now),
    expiresAt: quote.expiresAt,
  };
  if (!isPreparedSale(prepared)) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "The recovered prepared sale is not valid, so payment stays closed.",
      input.correlationId,
    );
  }
  const persisted = await persistPrepared({
    store: input.store,
    actor: input.actor,
    request,
    prepared,
    quote,
    lines: intent.lines,
    context,
  });
  if (!persisted.ok) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "The prepared sale could not be saved on this register, so payment stays closed.",
      input.correlationId,
    );
  }
  const saved = await input.store.getSale(input.transactionId);
  if (!saved || saved.prepared.transactionId !== input.transactionId) {
    return apiFailure(
      "REQUIRES_ATTENTION",
      "The prepared sale was not stored, so payment stays closed.",
      input.correlationId,
    );
  }
  await input.store.acknowledgeIdempotency(
    input.actor.organizationId,
    "sale.prepare",
    operation.idempotencyKey,
    persisted.data,
  );
  return persisted;
}

async function assertPrepareScope(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
  readonly allowExpiredOriginalQuote?: boolean;
}): Promise<ApiResult<{ quote: Quote }>> {
  const quote = await input.store.getQuote(input.request.quoteId);
  if (!quote) {
    return apiFailure("NOT_FOUND", "quote snapshot was not found", input.context.correlationId);
  }
  if (quote.fingerprint !== input.request.quoteFingerprint) {
    return apiFailure("QUOTE_CHANGED", "quoteFingerprint does not match the stored quote", input.context.correlationId);
  }
  const quoteExpiry = Date.parse(quote.expiresAt);
  if (!Number.isFinite(quoteExpiry) || (!input.allowExpiredOriginalQuote && quoteExpiry <= input.now.getTime())) {
    return apiFailure("QUOTE_EXPIRED", "Quote has expired", input.context.correlationId);
  }
  if (!quote.purchasable) {
    return apiFailure("STOCK_CHANGED", "quoted items are not purchasable", input.context.correlationId);
  }
  if (!input.actor.locationIds.includes(quote.locationId)) {
    return apiFailure("FORBIDDEN", "quote location is out of staff scope", input.context.correlationId);
  }
  const customerPresentation = validateCustomerSnapshot(
    quote,
    input.request.customerSnapshot,
    input.context.correlationId,
  );
  if (!customerPresentation.ok) {
    return customerPresentation;
  }
  const register = await input.store.getRegister(input.request.registerId);
  if (!register || register.status !== "active") {
    return apiFailure("NOT_FOUND", "register is not available", input.context.correlationId);
  }
  if (!input.allowExpiredOriginalQuote && register.locationStatus === "inactive") {
    return apiFailure("NOT_FOUND", "location is inactive; reactivate it before starting a sale", input.context.correlationId);
  }
  if (register.organizationId !== input.actor.organizationId || register.locationId !== quote.locationId) {
    return apiFailure("FORBIDDEN", "register is out of quote location scope", input.context.correlationId);
  }
  const shift = await input.store.getShift(input.request.shiftId);
  if (!shift || shift.status !== "open") {
    return apiFailure("SHIFT_REQUIRED", "prepare requires an open shift", input.context.correlationId);
  }
  if (shift.registerId !== register.id || shift.deviceId !== input.request.deviceId) {
    return apiFailure("VALIDATION_ERROR", "shift does not match the register and device", input.context.correlationId);
  }
  const device = await input.store.getDevice(input.request.deviceId);
  if (!device || device.status !== "active" || device.locationId !== register.locationId) {
    return apiFailure("VALIDATION_ERROR", "device is not at the register location", input.context.correlationId);
  }
  return { ok: true, data: { quote }, correlationId: input.context.correlationId };
}

async function loadOrBindPrepareIntent(input: {
  readonly store: CheckoutStore;
  readonly catalogLookup: CatalogPresentationLookup;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly quote: Quote;
}): Promise<ApiResult<PrepareIntentSnapshot>> {
  const existing = await input.store.getPrepareIntent(
    input.actor.organizationId,
    "sale.prepare",
    input.context.idempotencyKey,
  );
  if (existing) {
    if (!prepareIntentMatchesRequest({
      intent: existing,
      quoteId: input.request.quoteId,
      quoteFingerprint: input.request.quoteFingerprint,
      transactionId: input.request.transactionId,
    })) {
      return apiFailure(
        "REQUIRES_ATTENTION",
        "durable prepare intent does not match this PrepareSaleRequest",
        input.context.correlationId,
      );
    }
    return { ok: true, data: existing, correlationId: input.context.correlationId };
  }
  const presentation = await loadSalePresentation({
    catalogLookup: input.catalogLookup,
    organizationId: input.actor.organizationId,
    quote: input.quote,
  });
  if (!presentation.ok) {
    return apiFailure("INTEGRATION_UNAVAILABLE", presentation.message, input.context.correlationId);
  }
  try {
    const bound = await input.store.bindPrepareIntent(
      input.actor.organizationId,
      "sale.prepare",
      input.context.idempotencyKey,
      buildPrepareIntentSnapshot({
        quote: input.quote,
        transactionId: input.request.transactionId,
        lines: presentation.lines,
      }),
    );
    return { ok: true, data: bound, correlationId: input.context.correlationId };
  } catch {
    return apiFailure(
      "INTEGRATION_UNAVAILABLE",
      "prepare intent could not be persisted before the commercial sale",
      input.context.correlationId,
    );
  }
}

async function persistPrepared(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly prepared: PreparedSale;
  readonly quote: Quote;
  readonly lines: readonly ReceiptLine[];
  readonly context: CommandContext;
}): Promise<ApiResult<PreparedSale>> {
  const existing = await input.store.getSale(input.request.transactionId);
  if (existing) {
    const matched = assertSaleMatchesPrepareRequest({
      sale: existing,
      actor: input.actor,
      request: input.request,
      correlationId: input.context.correlationId,
    });
    if (!matched.ok) {
      return matched;
    }
    return { ok: true, data: existing.prepared, correlationId: input.context.correlationId };
  }
  const register = await input.store.getRegister(input.request.registerId);
  if (!register) {
    return apiFailure("NOT_FOUND", "register is not available", input.context.correlationId);
  }
  await input.store.seedPreparedSale({
    organizationId: input.actor.organizationId,
    locationId: register.locationId,
    locationName: customerReceiptPlaceLabel(register.locationName, "Store"),
    registerId: register.id,
    registerName: customerReceiptPlaceLabel(register.name, "Register"),
    deviceId: input.request.deviceId,
    shiftId: input.request.shiftId,
    cashierId: input.actor.actorId,
    cashierName: input.actor.displayName,
    customer: input.quote.customer,
    customerLabel: customerLabel(input.quote, input.request.customerSnapshot),
    ...(input.request.customerSnapshot ? { customerSnapshot: input.request.customerSnapshot } : {}),
    prepared: input.prepared,
    lines: input.lines,
    orderLines: input.quote.lines.map((line) => ({
      orderLineId: line.lineId,
      quantity: line.quantity,
      subtotal: line.subtotal,
      discount: line.discount,
      tax: line.tax,
      total: line.total,
    })),
    quoteId: input.quote.id,
    subtotal: input.quote.subtotal,
    discount: input.quote.discount,
    tax: input.quote.tax,
  });
  return { ok: true, data: input.prepared, correlationId: input.context.correlationId };
}

export function customerLabel(quote: Quote, snapshot?: CustomerSummary): string {
  if (quote.customer.kind === "walkin") {
    return "Walk-in";
  }
  return snapshot?.displayName.trim() || quote.customer.customerId;
}

export function validateCustomerSnapshot(
  quote: Quote,
  snapshot: CustomerSummary | undefined,
  correlationId: CommandContext["correlationId"],
): ApiResult<{ readonly customerSnapshot?: CustomerSummary }> {
  if (quote.customer.kind === "walkin") {
    if (snapshot) {
      return apiFailure(
        "VALIDATION_ERROR",
        "Walk-in quote cannot carry a customer presentation snapshot",
        correlationId,
      );
    }
    return { ok: true, data: {}, correlationId };
  }
  if (!snapshot) {
    return { ok: true, data: {}, correlationId };
  }
  if (snapshot.id !== quote.customer.customerId || snapshot.kind !== quote.customer.kind) {
    return apiFailure(
      "VALIDATION_ERROR",
      "customerSnapshot does not match the authoritative quoted customer",
      correlationId,
    );
  }
  return { ok: true, data: { customerSnapshot: snapshot }, correlationId };
}

async function notePrepareDispatch(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
}): Promise<void> {
  await input.store.recordPrepareDiagnostic({
    organizationId: input.actor.organizationId,
    operation: "sale.prepare",
    idempotencyKey: input.context.idempotencyKey,
    status: "sent",
    attemptedAt: toIsoTimestamp(input.now),
    countAttempt: true,
    outcome: prepareEffectEvidence({
      effectCertainty: "unknown",
      transactionId: input.request.transactionId,
      idempotencyKey: input.context.idempotencyKey,
      errorCode: "INTEGRATION_UNAVAILABLE",
      message: "Prepare was sent and the commercial result is not known yet",
    }),
  });
}

async function settleSentPrepare(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "prepare" | "resolve">;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
  readonly failure: ApiFailure | undefined;
  readonly forceResolve?: boolean;
  readonly allowOriginalRepair?: boolean;
  readonly repairNow?: () => Date;
}): Promise<ApiResult<PreparedSale>> {
  const prior = await input.store.readPrepareDiagnostic(
    input.actor.organizationId,
    "sale.prepare",
    input.context.idempotencyKey,
  );
  const dispatched = prior?.status === "sent";
  if ((!input.forceResolve && !dispatched) || (input.failure && isDefinitivePreEffectRejection(input.failure))) {
    const errorCode = input.failure?.error.code ?? "INTEGRATION_UNAVAILABLE";
    await recordPrepareOutcome(input, {
      status: "pending",
      effectCertainty: "none",
      errorCode,
      message: input.failure?.error.message ?? "Prepare failed before any commercial request was sent",
    });
    const failure = input.failure ?? apiFailure(
      "INTEGRATION_UNAVAILABLE",
      "Prepare failed before any commercial request was sent",
      input.context.correlationId,
    );
    return withPreEffectSignal(failure);
  }

  let resolved: ApiResult<SaleResolution> | undefined;
  try {
    resolved = await input.salesPort.resolve(input.request.transactionId);
  } catch {
    resolved = undefined;
  }
  if (!resolved?.ok || !isSaleResolution(resolved.data) || resolved.data.transactionId !== input.request.transactionId) {
    await recordPrepareOutcome(input, {
      status: "requires_attention",
      effectCertainty: "unknown",
      errorCode: input.failure?.error.code ?? "INTEGRATION_UNAVAILABLE",
      message: "Prepare response is unknown and the existing transaction could not be resolved",
    });
    return apiFailure(
      "REQUIRES_ATTENTION",
      "This sale needs a manager check. Do not start another sale for this attempt.",
      input.context.correlationId,
    );
  }

  const remoteStatus = resolved.data.status;
  if (remoteStatus === "prepared") {
    if (input.allowOriginalRepair) {
      const repaired = await repairOriginalOrder({ ...input, resolution: resolved.data });
      if (repaired) return repaired;
      await recordPrepareOutcome(input, {
        status: "requires_attention", effectCertainty: "prepared", errorCode: "REQUIRES_ATTENTION",
        remoteStatus, paymentId: resolved.data.paymentId,
        message: "The original prepared sale could not be safely recovered from its frozen intent. Payment stays closed.",
      });
      return apiFailure(
        "REQUIRES_ATTENTION", "The original prepared sale could not be safely recovered from its frozen intent. Payment stays closed.",
        input.context.correlationId,
      );
    }
    let recovered: ApiResult<PreparedSale> | undefined;
    try {
      recovered = await recoverPrepared({ ...input, knownResolution: resolved });
    } catch {
      recovered = undefined;
    }
    if (recovered?.ok && (await input.store.getSale(input.request.transactionId))) {
      return recovered;
    }
    await recordPrepareOutcome(input, {
      status: "requires_attention",
      effectCertainty: "prepared",
      errorCode: recovered && !recovered.ok ? recovered.error.code : "REQUIRES_ATTENTION",
      remoteStatus,
      message: recovered && !recovered.ok
        ? recovered.error.message
        : "The remote sale is prepared, but it could not be stored for payment.",
    });
    if (recovered && !recovered.ok && recovered.error.code === "REQUIRES_ATTENTION") {
      return recovered;
    }
    return apiFailure(
      "REQUIRES_ATTENTION",
      "This sale needs a manager check. Do not start another sale for this attempt.",
      input.context.correlationId,
    );
  }

  if (remoteStatus === "finalizing") {
    await recordPrepareOutcome(input, {
      status: "requires_attention",
      effectCertainty: "finalizing",
      errorCode: "OPERATION_IN_PROGRESS",
      remoteStatus,
      paymentId: resolved.data.paymentId,
      message: PAYMENT_ALREADY_SUBMITTED,
    });
    return apiFailure(
      "OPERATION_IN_PROGRESS",
      PAYMENT_ALREADY_SUBMITTED,
      input.context.correlationId,
    );
  }

  if (remoteStatus === "payment_pending") {
    await recordPrepareOutcome(input, {
      status: "requires_attention",
      effectCertainty: "payment_pending",
      errorCode: "OPERATION_IN_PROGRESS",
      remoteStatus,
      paymentId: resolved.data.paymentId,
      message: PAYMENT_ALREADY_PENDING,
    });
    return apiFailure(
      "OPERATION_IN_PROGRESS",
      PAYMENT_ALREADY_PENDING,
      input.context.correlationId,
    );
  }

  if (remoteStatus === "completed") {
    const receipt = await findOfficialReceipt(input.store, input.request.transactionId);
    if (receipt) {
      await recordPrepareOutcome(input, {
        status: "acknowledged",
        effectCertainty: "completed",
        errorCode: "OPERATION_IN_PROGRESS",
        remoteStatus,
        paymentId: resolved.data.paymentId,
        message: resolved.data.message,
      });
      return apiFailure(
        "OPERATION_IN_PROGRESS",
        "This sale is already complete. Load the existing receipt.",
        input.context.correlationId,
      );
    }
    await recordPrepareOutcome(input, {
      status: "requires_attention",
      effectCertainty: "completed",
      errorCode: "REQUIRES_ATTENTION",
      remoteStatus,
      paymentId: resolved.data.paymentId,
      message: RECEIPT_MISSING,
    });
    return apiFailure("REQUIRES_ATTENTION", RECEIPT_MISSING, input.context.correlationId, { field: "receipt_missing" });
  }

  if (remoteStatus === "not_found") {
    await recordPrepareOutcome(input, {
      status: "acknowledged",
      effectCertainty: "not_found",
      errorCode: "NOT_FOUND",
      remoteStatus,
      message: resolved.data.message ?? "The previous sale attempt was not found",
    });
    return apiFailure(
      "NOT_FOUND",
      "The previous sale attempt was not found. The cart is unchanged.",
      input.context.correlationId,
      { field: "remote_sale" },
    );
  }

  if (remoteStatus === "cancelled") {
    await recordPrepareOutcome(input, {
      status: "acknowledged",
      effectCertainty: "cancelled",
      errorCode: "NOT_FOUND",
      remoteStatus,
      message: CANCELLED_ATTEMPT,
    });
    return apiFailure("NOT_FOUND", CANCELLED_ATTEMPT, input.context.correlationId, { field: "sale_cancelled" });
  }

  if (input.allowOriginalRepair) {
    const repaired = await repairOriginalOrder({ ...input, resolution: resolved.data });
    if (repaired) return repaired;
  }

  await recordPrepareOutcome(input, {
    status: "requires_attention",
    effectCertainty: "unknown",
    errorCode: input.failure?.error.code ?? "REQUIRES_ATTENTION",
    remoteStatus,
    paymentId: resolved.data.paymentId,
    message: resolved.data.message ?? "Prepare response is unknown",
  });
  return apiFailure(
    "REQUIRES_ATTENTION",
    resolved.data.message ?? "This sale needs a manager check. Do not start another sale for this attempt.",
    input.context.correlationId,
  );
}

async function hasOriginalRepairIntent(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
}): Promise<boolean> {
  const operation = await input.store.findSalePrepareOperation(input.request.transactionId);
  if (
    !operation || operation.organizationId !== input.actor.organizationId ||
    operation.transactionId !== input.request.transactionId ||
    operation.idempotencyKey !== input.context.idempotencyKey
  ) return false;
  const intent = await input.store.getPrepareIntent(input.actor.organizationId, "sale.prepare", input.context.idempotencyKey);
  return !!intent && prepareIntentMatchesRequest({
    intent,
    quoteId: input.request.quoteId,
    quoteFingerprint: input.request.quoteFingerprint,
    transactionId: input.request.transactionId,
  }) && claimKindForExistingPrepare({
    status: operation.status,
    outcome: operation.outcome,
    intentPresent: true,
  }) === "repair";
}

const EXISTING_ORDER_NOT_PAYABLE = "This existing order cannot yet be safely opened for payment.";

/** Only the explicit original POST retry may ask Woo to repair/replay its own order. */
async function repairOriginalOrder(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "prepare" | "resolve">;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
  readonly resolution: SaleResolution;
  readonly repairNow?: () => Date;
}): Promise<ApiResult<PreparedSale> | undefined> {
  const remote = input.resolution;
  if (
    remote.transactionId !== input.request.transactionId || !remote.saleId || !remote.orderReference ||
    remote.paymentId || remote.receiptId ||
    !(remote.status === "prepared" ||
      (remote.status === "requires_attention" && remote.message === EXISTING_ORDER_NOT_PAYABLE))
  ) return undefined;
  if (!(await hasOriginalRepairIntent(input))) return undefined;
  const binding = await input.store.lookupCommandScope({ transactionId: input.request.transactionId, operation: "sale.prepare" });
  if (!binding || !assertBindingMatchesPrepareRequest({
    binding, actor: input.actor, request: input.request, correlationId: input.context.correlationId,
  }).ok) return undefined;
  const scoped = await assertPrepareScope({ ...input, allowExpiredOriginalQuote: true });
  if (!scoped.ok) return undefined;
  const quote = scoped.data.quote;
  const intent = await input.store.getPrepareIntent(input.actor.organizationId, "sale.prepare", input.context.idempotencyKey);
  if (!intent || quote.lines.length === 0 || quote.lines.length !== intent.lines.length || quote.lines.some((line, index) => {
    const frozen = intent.lines[index];
    return line.lineId !== intent.lineIds[index] || !frozen || line.quantity !== frozen.quantity ||
      !(["unitPrice", "subtotal", "discount", "tax", "total"] as const).every((field) => moneyEqual(line[field], frozen[field]));
  })) return undefined;
  if (await hasOtherSaleEffects(input.store, input.request.transactionId)) return undefined;

  const attention = async (message: string): Promise<ApiResult<PreparedSale>> => {
    await recordPrepareOutcome(input, {
      status: "requires_attention", effectCertainty: "unknown", errorCode: "REQUIRES_ATTENTION",
      remoteStatus: remote.status, message,
    });
    return apiFailure("REQUIRES_ATTENTION", message, input.context.correlationId);
  };
  await notePrepareDispatch(input);
  let commercial: ApiResult<PreparedSale>;
  try {
    commercial = await input.salesPort.prepare(input.request, input.context);
  } catch {
    return attention("The original-order repair response is unknown. Check this same sale again; do not start another sale or take payment.");
  }
  if (!commercial.ok) return attention(commercial.error.message);
  const prepared = commercial.data;
  const reservationIsCurrent = () => Number.isFinite(Date.parse(prepared.expiresAt)) &&
    Date.parse(prepared.expiresAt) > (input.repairNow?.() ?? input.now).getTime();
  if (
    !isPreparedSale(prepared) || prepared.transactionId !== input.request.transactionId ||
    prepared.saleId !== remote.saleId || prepared.orderReference !== remote.orderReference ||
    prepared.quoteFingerprint !== input.request.quoteFingerprint || !moneyEqual(prepared.total, quote.total) ||
    !reservationIsCurrent()
  ) return attention("The original-order repair did not prove the same sale, frozen total and current reservation. Payment stays closed.");
  let checked: ApiResult<SaleResolution>;
  try {
    checked = await input.salesPort.resolve(input.request.transactionId);
  } catch {
    return attention("The repaired original order could not be checked. Check this same sale again before taking payment.");
  }
  if (
    !checked.ok || !isSaleResolution(checked.data) || checked.data.status !== "prepared" ||
    checked.data.transactionId !== prepared.transactionId || checked.data.saleId !== prepared.saleId ||
    checked.data.orderReference !== prepared.orderReference || checked.data.paymentId || checked.data.receiptId ||
    !reservationIsCurrent() || await hasOtherSaleEffects(input.store, input.request.transactionId)
  ) return attention("The original sale has not been proven unpaid and prepared. Payment stays closed.");
  try {
    const persisted = await persistPrepared({ ...input, prepared, quote, lines: intent.lines });
    const saved = persisted.ok ? await input.store.getSale(input.request.transactionId) : undefined;
    if (
      !persisted.ok || !saved || saved.status !== "prepared" || saved.assignedPaymentId || saved.receipt ||
      canonicalJson(saved.prepared) !== canonicalJson(prepared) || !reservationIsCurrent()
    ) return attention("The repaired original sale could not be saved safely. Payment stays closed.");
    await input.store.acknowledgeIdempotency(input.actor.organizationId, "sale.prepare", input.context.idempotencyKey, saved.prepared);
    return { ok: true, data: saved.prepared, correlationId: input.context.correlationId };
  } catch {
    return attention("The repaired original sale could not be saved. Check this same sale again before taking payment.");
  }
}

async function hasOtherSaleEffects(store: CheckoutStore, transactionId: Uuid): Promise<boolean> {
  const [payment, receipt, cash, finalize, cancel, local] = await Promise.all([
    store.getPaymentForTransaction(transactionId), store.getReceipt(transactionId), store.listCashSales(transactionId),
    store.lookupCommandScope({ transactionId, operation: "sale.finalize" }),
    store.lookupCommandScope({ transactionId, operation: "sale.cancel" }), store.getSale(transactionId),
  ]);
  return !!payment || !!receipt || cash.length > 0 || !!finalize || !!cancel || !!local;
}

async function recordPrepareOutcome(
  input: {
    readonly store: CheckoutStore;
    readonly actor: StaffActor;
    readonly request: PrepareSaleRequest;
    readonly context: CommandContext;
    readonly now: Date;
  },
  evidence: {
    readonly status: "pending" | "requires_attention" | "acknowledged";
    readonly effectCertainty: PrepareEffectCertainty;
    readonly errorCode: string;
    readonly remoteStatus?: string;
    readonly paymentId?: Uuid;
    readonly message?: string;
  },
): Promise<void> {
  const prior = await input.store.readPrepareDiagnostic(
    input.actor.organizationId,
    "sale.prepare",
    input.context.idempotencyKey,
  );
  await input.store.recordPrepareDiagnostic({
    organizationId: input.actor.organizationId,
    operation: "sale.prepare",
    idempotencyKey: input.context.idempotencyKey,
    status: evidence.status,
    attemptedAt: prior?.lastAttemptAt ?? toIsoTimestamp(input.now),
    countAttempt: !prior?.lastAttemptAt,
    errorCode: evidence.errorCode,
    outcome: prepareEffectEvidence({
      effectCertainty: evidence.effectCertainty,
      transactionId: input.request.transactionId,
      idempotencyKey: input.context.idempotencyKey,
      errorCode: evidence.errorCode,
      remoteStatus: evidence.remoteStatus,
      paymentId: evidence.paymentId,
      message: evidence.message,
    }),
  });
}

function replayPrepared(outcome: unknown, correlationId: CommandContext["correlationId"]): ApiResult<PreparedSale> {
  if (!isPreparedSale(outcome)) {
    return apiFailure("INTEGRATION_UNAVAILABLE", "stored prepare outcome is not a valid PreparedSale", correlationId);
  }
  return { ok: true, data: outcome, correlationId };
}

/** An acknowledged prepare is historical evidence, not permission to collect money again. */
async function replayUnpaidPrepared(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: PrepareSaleRequest;
  readonly context: CommandContext;
  readonly prepared: PreparedSale;
  readonly currentTime: () => Date;
}): Promise<ApiResult<PreparedSale>> {
  const attention = () => apiFailure(
    "REQUIRES_ATTENTION",
    "This existing sale is not currently proven unpaid and ready for payment. Check this same sale; do not take payment again.",
    input.context.correlationId,
  );
  const [payment, receipt, cash, finalize, cancel] = await Promise.all([
    input.store.getPaymentForTransaction(input.request.transactionId),
    input.store.getReceipt(input.request.transactionId),
    input.store.listCashSales(input.request.transactionId),
    input.store.lookupCommandScope({ transactionId: input.request.transactionId, operation: "sale.finalize" }),
    input.store.lookupCommandScope({ transactionId: input.request.transactionId, operation: "sale.cancel" }),
  ]);
  if (payment || receipt || cash.length > 0 || finalize || cancel) return attention();
  // Read after the evidence checks, rather than reuse the sale captured before
  // the idempotency lookup; another tab may have started payment in between.
  const latest = await input.store.getSale(input.request.transactionId);
  if (
    !latest || latest.status !== "prepared" || latest.assignedPaymentId || latest.receipt || latest.commercialConfirmed ||
    !isPreparedSale(latest.prepared) || canonicalJson(latest.prepared) !== canonicalJson(input.prepared) ||
    latest.prepared.transactionId !== input.request.transactionId || latest.prepared.quoteFingerprint !== input.request.quoteFingerprint ||
    !Number.isFinite(Date.parse(latest.prepared.expiresAt)) || Date.parse(latest.prepared.expiresAt) <= input.currentTime().getTime()
  ) return attention();
  const matched = assertSaleMatchesPrepareRequest({
    sale: latest, actor: input.actor, request: input.request, correlationId: input.context.correlationId,
  });
  if (!matched.ok) return matched;
  return { ok: true, data: latest.prepared, correlationId: input.context.correlationId };
}
