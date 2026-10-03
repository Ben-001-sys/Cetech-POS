import type { ApiResult } from "../../../../../docs/contracts/ports";
import type {
  CashMovement,
  CashPaymentRequest,
  CommandContext,
  PaymentState,
} from "../../../../../docs/contracts/domain.generated";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { toIsoTimestamp } from "../auth/ids";
import { apiFailure } from "../http/api-failure";
import {
  moneyEqual,
  type CheckoutStore,
  type StaffActor,
  type StoredPayment,
} from "../../core/checkout/types";
import { toPaymentState } from "../payments/payment-state";
import { validateCanonicalDef } from "../quotes/canonical-schema";

export async function confirmCash(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: CashPaymentRequest;
  readonly context: CommandContext;
  readonly now: Date;
}): Promise<ApiResult<PaymentState>> {
  const { store, actor, request, context, now } = input;
  const requestStartedAt = Date.now();
  const currentNow = () => new Date(now.getTime() + Math.max(0, Date.now() - requestStartedAt));
  return store.withLock(`cash:${request.transactionId}`, async () => {
    const sale = await store.getSale(request.transactionId);
    const existingPayment = sale ? await store.getPaymentForTransaction(request.transactionId) : undefined;
    const existingMoves = sale ? await store.listCashSales(request.transactionId) : [];
    const effectful = Boolean(existingPayment) || existingMoves.length > 0;
    if (!effectful) {
      const preflight = validateCashBeforeEffect({ sale, actor, request, context });
      if (!preflight.ok) {
        return preflight;
      }
    }

    const hash = await sha256Hex(canonicalJson(request));
    const claim = await store.claimIdempotency(
      actor.organizationId,
      "payment.cash",
      context.idempotencyKey,
      hash,
      sale?.locationId ?? actor.locationIds[0],
      {
        registerId: sale?.registerId,
        shiftId: sale?.shiftId,
        transactionId: request.transactionId,
      },
    );
    if (claim.kind === "conflict") {
      return apiFailure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different cash request",
        context.correlationId,
      );
    }
    if (claim.kind === "in_progress") {
      return apiFailure("OPERATION_IN_PROGRESS", "cash confirmation is already in progress for this key", context.correlationId);
    }
    if (claim.kind === "replay") {
      return replayPayment(claim.outcome, context.correlationId);
    }

    await store.markIdempotencySent(actor.organizationId, "payment.cash", context.idempotencyKey);
    try {
      return await completeCash({ store, actor, request, context, now, currentNow });
    } catch {
      const attention = attentionPayment(request.transactionId);
      await store.enqueueOutbox({
        id: crypto.randomUUID(),
        organizationId: actor.organizationId,
        aggregateType: "sale",
        aggregateId: request.transactionId,
        eventType: "sale.cash_persist_repair",
        payload: { transactionId: request.transactionId },
        createdAt: toIsoTimestamp(now),
      });
      await store.markIdempotencyRequiresAttention(
        actor.organizationId,
        "payment.cash",
        context.idempotencyKey,
        attention,
      );
      return { ok: true, data: attention, correlationId: context.correlationId };
    }
  });
}

async function completeCash(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: CashPaymentRequest;
  readonly context: CommandContext;
  readonly now: Date;
  readonly currentNow: () => Date;
}): Promise<ApiResult<PaymentState>> {
  const { store, actor, request, context, now } = input;
  const sale = await store.getSale(request.transactionId);
  if (!sale) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("NOT_FOUND", "prepared sale was not found", context.correlationId);
  }
  if (sale.organizationId !== actor.organizationId) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("FORBIDDEN", "sale organization is out of staff scope", context.correlationId);
  }
  if (!actor.locationIds.includes(sale.locationId)) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("FORBIDDEN", "sale location is out of staff scope", context.correlationId);
  }
  if (sale.status === "cancelled") {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("VALIDATION_ERROR", "sale cannot accept cash in its current state", context.correlationId);
  }
  if (sale.prepared.total.minor <= 0) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("VALIDATION_ERROR", "prepared sale total must be positive for cash", context.correlationId);
  }
  if (request.cashReceived.currency !== sale.prepared.total.currency) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("VALIDATION_ERROR", "cash received currency does not match the prepared sale", context.correlationId);
  }
  if (request.cashReceived.minor < sale.prepared.total.minor) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("VALIDATION_ERROR", "cash received is less than the prepared sale total", context.correlationId);
  }

  const existing = await store.getPaymentForTransaction(request.transactionId);
  if (existing) {
    if (existing.tender !== "cash") {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure(
        "VALIDATION_ERROR",
        "an electronic payment intent already exists for this sale",
        context.correlationId,
      );
    }
    if (!existing.cashReceived) {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure("REQUIRES_ATTENTION", "recorded cash payment is missing cash received", context.correlationId);
    }
    if (
      existing.transactionId !== request.transactionId ||
      existing.saleId !== sale.prepared.saleId ||
      !moneyEqual(existing.amount, sale.prepared.total)
    ) {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure(
        "REQUIRES_ATTENTION",
        "recorded cash payment does not match the prepared sale",
        context.correlationId,
      );
    }
    if (!moneyEqual(existing.cashReceived, request.cashReceived)) {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure(
        "VALIDATION_ERROR",
        "cash received does not match the recorded cash payment",
        context.correlationId,
      );
    }
    if (sale.assignedPaymentId && sale.assignedPaymentId !== existing.paymentId) {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure(
        "REQUIRES_ATTENTION",
        "a different payment is already assigned to this sale",
        context.correlationId,
      );
    }
    if (sale.status !== "completed") {
      await store.saveSale({
        ...sale,
        status: sale.status === "prepared" ? "finalizing" : sale.status,
        assignedPaymentId: existing.paymentId,
      });
    }
    const state = toPaymentState(existing);
    await store.acknowledgeIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey, state);
    return { ok: true, data: state, correlationId: context.correlationId };
  }

  if (sale.status === "completed") {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("VALIDATION_ERROR", "sale cannot accept cash in its current state", context.correlationId);
  }

  const shift = await store.getShift(sale.shiftId);
  if (!shift || shift.status !== "open") {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("SHIFT_REQUIRED", "cash confirmation requires an open shift", context.correlationId);
  }
  if (shift.registerId !== sale.registerId || shift.locationId !== sale.locationId) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("SHIFT_CONFLICT", "prepared sale is not bound to the open register shift", context.correlationId);
  }
  if (shift.openingFloat.currency !== sale.prepared.total.currency) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("VALIDATION_ERROR", "shift currency does not match the prepared sale", context.correlationId);
  }

  const movements = await store.listCashSales(request.transactionId);
  if (movements.length === 0) {
    const expiresAt = Date.parse(sale.prepared.expiresAt);
    const observedAt = input.currentNow().getTime();
    if (!Number.isFinite(expiresAt) || !Number.isFinite(observedAt) || expiresAt <= observedAt) {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure(
        "REQUIRES_ATTENTION",
        "the prepared sale reservation has expired or cannot be verified; check this sale before taking payment",
        context.correlationId,
        { field: "pre_effect" },
      );
    }
  }

  const verifiedAt = toIsoTimestamp(now);
  const payment: StoredPayment = {
    paymentId: crypto.randomUUID(),
    transactionId: request.transactionId,
    saleId: sale.prepared.saleId,
    evidenceId: crypto.randomUUID(),
    tender: "cash",
    status: "verified",
    amount: sale.prepared.total,
    cashReceived: request.cashReceived,
    verifiedAt,
    verificationSource: "cash_ledger",
    actorId: actor.actorId,
  };
  if (movements.length === 0) {
    const movement: CashMovement = {
      id: crypto.randomUUID(),
      shiftId: sale.shiftId,
      kind: "cash_sale",
      signedAmount: { minor: sale.prepared.total.minor, currency: sale.prepared.total.currency },
      actorId: actor.actorId,
      createdAt: verifiedAt,
      transactionId: request.transactionId,
      reason: "cash sale",
    };
    const appended = await store.appendCashMovement({ ...movement, organizationId: sale.organizationId });
    if (appended === "duplicate_sale") {
      /* Unique ledger already exists; continue POS persist repair. */
    } else if (appended === "shift_required") {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure("SHIFT_REQUIRED", "cash confirmation requires an open shift", context.correlationId);
    } else if (appended !== "ok") {
      await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
      return apiFailure("REQUIRES_ATTENTION", "cash ledger could not record the sale movement", context.correlationId);
    }
  }

  try {
    await store.savePayment(payment);
    await store.saveSale({
      ...sale,
      status: "finalizing",
      assignedPaymentId: payment.paymentId,
    });
  } catch {
    await store.enqueueOutbox({
      id: crypto.randomUUID(),
      organizationId: sale.organizationId,
      aggregateType: "sale",
      aggregateId: request.transactionId,
      eventType: "sale.cash_persist_repair",
      payload: { transactionId: request.transactionId },
      createdAt: verifiedAt,
    });
    const attention = attentionPayment(request.transactionId, payment.paymentId, payment.amount);
    await store.markIdempotencyRequiresAttention(
      actor.organizationId,
      "payment.cash",
      context.idempotencyKey,
      attention,
    );
    return { ok: true, data: attention, correlationId: context.correlationId };
  }

  const state = toPaymentState(payment);
  if (!validateCanonicalDef("PaymentState", state)) {
    await store.releaseIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey);
    return apiFailure("INTEGRATION_UNAVAILABLE", "cash confirmation produced an invalid PaymentState", context.correlationId);
  }
  await store.acknowledgeIdempotency(actor.organizationId, "payment.cash", context.idempotencyKey, state);
  return { ok: true, data: state, correlationId: context.correlationId };
}

function validateCashBeforeEffect(input: {
  readonly sale: Awaited<ReturnType<CheckoutStore["getSale"]>>;
  readonly actor: StaffActor;
  readonly request: CashPaymentRequest;
  readonly context: CommandContext;
}): ApiResult<NonNullable<Awaited<ReturnType<CheckoutStore["getSale"]>>>> {
  const { sale, actor, request, context } = input;
  if (!sale) {
    return apiFailure("NOT_FOUND", "prepared sale was not found", context.correlationId);
  }
  if (sale.organizationId !== actor.organizationId) {
    return apiFailure("FORBIDDEN", "sale organization is out of staff scope", context.correlationId);
  }
  if (!actor.locationIds.includes(sale.locationId)) {
    return apiFailure("FORBIDDEN", "sale location is out of staff scope", context.correlationId);
  }
  if (sale.status === "cancelled" || sale.status === "completed") {
    return apiFailure("VALIDATION_ERROR", "sale cannot accept cash in its current state", context.correlationId);
  }
  if (sale.prepared.total.minor <= 0) {
    return apiFailure("VALIDATION_ERROR", "prepared sale total must be positive for cash", context.correlationId);
  }
  if (request.cashReceived.currency !== sale.prepared.total.currency) {
    return apiFailure("VALIDATION_ERROR", "cash received currency does not match the prepared sale", context.correlationId);
  }
  if (request.cashReceived.minor < sale.prepared.total.minor) {
    return apiFailure("VALIDATION_ERROR", "cash received is less than the prepared sale total", context.correlationId);
  }
  return { ok: true, data: sale, correlationId: context.correlationId };
}

function attentionPayment(
  transactionId: CashPaymentRequest["transactionId"],
  paymentId: StoredPayment["paymentId"] = "00000000-0000-4000-8000-000000000000",
  amount: StoredPayment["amount"] = { minor: 0, currency: "GHS" },
): PaymentState {
  return {
    transactionId,
    paymentId,
    tender: "cash",
    status: "requires_attention",
    amount,
    nextAction: "contact_manager",
  };
}

function replayPayment(outcome: unknown, correlationId: CommandContext["correlationId"]): ApiResult<PaymentState> {
  if (!validateCanonicalDef("PaymentState", outcome)) {
    return apiFailure("INTEGRATION_UNAVAILABLE", "stored cash outcome is not a valid PaymentState", correlationId);
  }
  return { ok: true, data: outcome as PaymentState, correlationId };
}
