import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import type {
  CommandContext,
  FinalizeSaleRequest,
  ReceiptSettings,
  ReceiptSnapshot,
  SaleResolution,
} from "../../../../../docs/contracts/domain.generated";
import { resolveReceiptPresentation } from "../../core/receipt/settings";
import { freezeReceiptLines } from "../../core/receipt/build-receipt-line";
import type { ReceiptSettingsStore } from "../../core/receipt/settings-store";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { toIsoTimestamp } from "../auth/ids";
import { apiFailure } from "../http/api-failure";
import {
  evidenceFromPayment,
  moneyEqual,
  type CheckoutStore,
  type PosSaleRecord,
  type StaffActor,
  type StoredPayment,
} from "../../core/checkout/types";
import { validateCanonicalDef } from "../quotes/canonical-schema";
import { isSaleResolution } from "./schema";

export async function finalizeSale(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "confirmPayment">;
  readonly receiptSettings: ReceiptSettingsStore;
  readonly actor: StaffActor;
  readonly request: FinalizeSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
}): Promise<ApiResult<SaleResolution>> {
  const { store, salesPort, actor, request, context, now } = input;
  return store.withLock(`finalize:${request.transactionId}`, async () => {
    const saleForClaim = await store.getSale(request.transactionId);
    const hash = await sha256Hex(canonicalJson(request));
    const claim = await store.claimIdempotency(
      actor.organizationId,
      "sale.finalize",
      context.idempotencyKey,
      hash,
      saleForClaim?.locationId ?? actor.locationIds[0],
      {
        registerId: saleForClaim?.registerId,
        shiftId: saleForClaim?.shiftId,
        transactionId: request.transactionId,
      },
    );
    if (claim.kind === "conflict") {
      return apiFailure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different finalize request",
        context.correlationId,
      );
    }
    if (claim.kind === "in_progress") {
      return apiFailure("OPERATION_IN_PROGRESS", "finalize is already in progress for this key", context.correlationId);
    }
    if (claim.kind === "replay") {
      return replayResolution(claim.outcome, context.correlationId);
    }

    await store.markIdempotencySent(actor.organizationId, "sale.finalize", context.idempotencyKey);
    try {
      const result = await completeFinalize({
        store,
        salesPort,
        receiptSettings: input.receiptSettings,
        actor,
        request,
        context,
        now,
      });
      if (!result.ok) {
        await store.releaseIdempotency(actor.organizationId, "sale.finalize", context.idempotencyKey);
        return result;
      }
      if (result.data.status === "completed") {
        await store.acknowledgeIdempotency(actor.organizationId, "sale.finalize", context.idempotencyKey, result.data);
      } else {
        await store.markIdempotencyRequiresAttention(
          actor.organizationId,
          "sale.finalize",
          context.idempotencyKey,
          result.data,
        );
      }
      return result;
    } catch {
      const attention = {
        transactionId: request.transactionId,
        status: "requires_attention" as const,
        paymentId: request.paymentId,
        message: "POS persistence failed after commercial finalization; retry without creating a second sale",
      };
      await store.enqueueOutbox({
        id: crypto.randomUUID(),
        organizationId: actor.organizationId,
        aggregateType: "sale",
        aggregateId: request.transactionId,
        eventType: "sale.commercial_persist_repair",
        payload: { transactionId: request.transactionId, paymentId: request.paymentId },
        createdAt: toIsoTimestamp(now),
      });
      await store.markIdempotencyRequiresAttention(
        actor.organizationId,
        "sale.finalize",
        context.idempotencyKey,
        attention,
      );
      return { ok: true, data: attention, correlationId: context.correlationId };
    }
  });
}

async function completeFinalize(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "confirmPayment">;
  readonly receiptSettings: ReceiptSettingsStore;
  readonly actor: StaffActor;
  readonly request: FinalizeSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
}): Promise<ApiResult<SaleResolution>> {
  const { store, salesPort, actor, request, context, now } = input;
  let sale = await store.getSale(request.transactionId);
  if (!sale) {
    return apiFailure("NOT_FOUND", "prepared sale was not found", context.correlationId);
  }
  if (sale.organizationId !== actor.organizationId) {
    return apiFailure("FORBIDDEN", "sale organization is out of staff scope", context.correlationId);
  }
  if (!actor.locationIds.includes(sale.locationId)) {
    return apiFailure("FORBIDDEN", "sale location is out of staff scope", context.correlationId);
  }

  const payment = await store.getPayment(request.paymentId);
  if (!payment || payment.status !== "verified") {
    return apiFailure("PAYMENT_NOT_VERIFIED", "payment evidence is not verified", context.correlationId);
  }
  if (payment.transactionId !== request.transactionId || payment.saleId !== sale.prepared.saleId) {
    return apiFailure("PAYMENT_NOT_VERIFIED", "payment is not verified for this customer sale", context.correlationId);
  }
  if (!moneyEqual(payment.amount, sale.prepared.total)) {
    return apiFailure("VALIDATION_ERROR", "verified payment amount does not match the prepared sale", context.correlationId);
  }
  if (payment.amount.currency !== sale.prepared.total.currency) {
    return apiFailure("VALIDATION_ERROR", "verified payment currency does not match the prepared sale", context.correlationId);
  }
  if (sale.assignedPaymentId && sale.assignedPaymentId !== request.paymentId) {
    return apiFailure("REQUIRES_ATTENTION", "a different payment is already assigned to this sale", context.correlationId);
  }
  if (sale.status === "cancelled") {
    return apiFailure("VALIDATION_ERROR", "cancelled sales cannot be finalized", context.correlationId);
  }
  if (sale.status === "completed" && sale.receipt) {
    return successResolution(sale, request.paymentId, context.correlationId, sale.receipt.id);
  }

  sale = {
    ...sale,
    status: "finalizing",
    assignedPaymentId: request.paymentId,
  };
  await store.saveSale(sale);

  const evidence = evidenceFromPayment(payment);
  const commercial = await salesPort.confirmPayment(
    { transactionId: request.transactionId, payment: evidence },
    context,
  );
  if (sale.commercialConfirmed) {
    return persistReceiptOrAttention({
      store,
      receiptSettings: input.receiptSettings,
      sale,
      payment,
      request,
      context,
      now,
    });
  }
  if (!commercial.ok) {
    sale = { ...sale, status: "requires_attention" };
    await store.saveSale(sale);
    await store.enqueueOutbox({
      id: crypto.randomUUID(),
      organizationId: sale.organizationId,
      aggregateType: "sale",
      aggregateId: request.transactionId,
      eventType: "sale.commercial_finalize_repair",
      payload: { transactionId: request.transactionId, paymentId: request.paymentId },
      createdAt: toIsoTimestamp(now),
    });
    return attentionResolution(
      sale,
      request.paymentId,
      context.correlationId,
      "commercial finalization failed; repair without creating a second sale",
    );
  }
  if (!isSaleResolution(commercial.data)) {
    sale = { ...sale, status: "requires_attention", commercialConfirmed: false };
    await store.saveSale(sale);
    return attentionResolution(
      sale,
      request.paymentId,
      context.correlationId,
      "commercial finalizer returned an invalid SaleResolution",
    );
  }
  if (commercial.data.status !== "completed") {
    sale = { ...sale, status: "requires_attention", commercialConfirmed: false };
    await store.saveSale(sale);
    return attentionResolution(
      sale,
      request.paymentId,
      context.correlationId,
      commercial.data.status === "requires_attention"
        ? (commercial.data.message ?? "commercial sale requires attention; do not complete locally")
        : "commercial sale is not completed; do not fabricate a receipt",
    );
  }
  const confirmed = { ...sale, commercialConfirmed: true, status: "finalizing" as const };
  try {
    await store.saveSale(confirmed);
    sale = confirmed;
  } catch {
    await store.enqueueOutbox({
      id: crypto.randomUUID(),
      organizationId: sale.organizationId,
      aggregateType: "sale",
      aggregateId: request.transactionId,
      eventType: "sale.commercial_persist_repair",
      payload: { transactionId: request.transactionId, paymentId: request.paymentId },
      createdAt: toIsoTimestamp(now),
    });
    return attentionResolution(
      sale,
      request.paymentId,
      context.correlationId,
      "POS sale persistence failed after commercial finalization; retry without creating a second sale",
    );
  }
  return persistReceiptOrAttention({
    store,
    receiptSettings: input.receiptSettings,
    sale,
    payment,
    request,
    context,
    now,
  });
}

async function persistReceiptOrAttention(input: {
  readonly store: CheckoutStore;
  readonly receiptSettings: ReceiptSettingsStore;
  readonly sale: PosSaleRecord;
  readonly payment: StoredPayment;
  readonly request: FinalizeSaleRequest;
  readonly context: CommandContext;
  readonly now: Date;
}): Promise<ApiResult<SaleResolution>> {
  const { store, payment, request, context, now } = input;
  let { sale } = input;
  const existing = await store.getReceipt(request.transactionId);
  if (existing) {
    sale = { ...sale, receipt: existing, status: "completed" };
    await store.saveSale(sale);
    return successResolution(sale, request.paymentId, context.correlationId, existing.id);
  }

  const settings = await input.receiptSettings.get(sale.organizationId, sale.locationId);
  const receipt = buildReceipt(sale, payment, now, settings);
  if (!validateCanonicalDef("ReceiptSnapshot", receipt)) {
    sale = { ...sale, status: "requires_attention" };
    await store.saveSale(sale);
    return attentionResolution(sale, request.paymentId, context.correlationId, "receipt snapshot failed schema validation");
  }
  try {
    const saved = await store.saveReceipt(receipt);
    if (saved === "duplicate") {
      const raced = await store.getReceipt(request.transactionId);
      if (raced) {
        sale = { ...sale, receipt: raced, status: "completed" };
        await store.saveSale(sale);
        return successResolution(sale, request.paymentId, context.correlationId, raced.id);
      }
    }
  } catch {
    sale = { ...sale, status: "requires_attention" };
    await store.saveSale(sale);
    await store.enqueueOutbox({
      id: crypto.randomUUID(),
      organizationId: sale.organizationId,
      aggregateType: "sale",
      aggregateId: request.transactionId,
      eventType: "sale.receipt_persist_repair",
      payload: { transactionId: request.transactionId, paymentId: request.paymentId },
      createdAt: toIsoTimestamp(now),
    });
    return attentionResolution(
      sale,
      request.paymentId,
      context.correlationId,
      "POS receipt persistence failed after commercial finalization; retry without creating a second sale",
    );
  }

  sale = { ...sale, receipt, status: "completed" };
  await store.saveSale(sale);
  return successResolution(sale, request.paymentId, context.correlationId, receipt.id);
}

function buildReceipt(
  sale: PosSaleRecord,
  payment: StoredPayment,
  now: Date,
  settings: ReceiptSettings,
): ReceiptSnapshot {
  const snapshot: ReceiptSnapshot = {
    id: `rcpt-${sale.prepared.transactionId.slice(0, 8)}`,
    transactionId: sale.prepared.transactionId,
    receiptNumber: `POS-${sale.prepared.orderReference}`,
    orderReference: sale.prepared.orderReference,
    issuedAt: toIsoTimestamp(now),
    locationName: sale.locationName,
    registerName: sale.registerName,
    cashierName: sale.cashierName,
    customerLabel: sale.customerLabel,
    ...(sale.customerSnapshot?.phoneMasked?.trim()
      ? { customerPhone: Array.from(sale.customerSnapshot.phoneMasked.trim()).slice(0, 80).join("") }
      : {}),
    presentation: resolveReceiptPresentation(settings.presentation),
    lines: freezeReceiptLines(sale.lines, settings),
    subtotal: sale.subtotal,
    discount: sale.discount,
    tax: sale.tax,
    total: sale.prepared.total,
    tender: payment.tender,
    documentKind: "operational_pos_receipt",
  };
  if (payment.tender === "cash" && payment.cashReceived) {
    return {
      ...snapshot,
      cashReceived: payment.cashReceived,
      changeDue: {
        minor: payment.cashReceived.minor - sale.prepared.total.minor,
        currency: payment.cashReceived.currency,
      },
    };
  }
  return snapshot;
}

function successResolution(
  sale: PosSaleRecord,
  paymentId: FinalizeSaleRequest["paymentId"],
  correlationId: CommandContext["correlationId"],
  receiptId: string,
): ApiResult<SaleResolution> {
  return {
    ok: true,
    correlationId,
    data: {
      transactionId: sale.prepared.transactionId,
      status: "completed",
      saleId: sale.prepared.saleId,
      orderReference: sale.prepared.orderReference,
      receiptId,
      paymentId,
    },
  };
}

function attentionResolution(
  sale: PosSaleRecord,
  paymentId: FinalizeSaleRequest["paymentId"],
  correlationId: CommandContext["correlationId"],
  message: string,
): ApiResult<SaleResolution> {
  return {
    ok: true,
    correlationId,
    data: {
      transactionId: sale.prepared.transactionId,
      status: "requires_attention",
      saleId: sale.prepared.saleId,
      orderReference: sale.prepared.orderReference,
      paymentId,
      message,
    },
  };
}

function replayResolution(outcome: unknown, correlationId: CommandContext["correlationId"]): ApiResult<SaleResolution> {
  if (!validateCanonicalDef("SaleResolution", outcome)) {
    return apiFailure("INTEGRATION_UNAVAILABLE", "stored finalize outcome is not a valid SaleResolution", correlationId);
  }
  return { ok: true, data: outcome as SaleResolution, correlationId };
}
