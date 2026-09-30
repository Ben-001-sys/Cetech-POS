import type { ApiResult } from "../../../../../docs/contracts/ports";
import type {
  HistoricSaleLineEconomics,
  HistoricTenderEconomics,
  ReturnPreview,
  ReturnPreviewLine,
  ReturnPreviewRequest,
  Uuid,
} from "../../../../../docs/contracts/domain.generated";
import { toIsoTimestamp } from "../auth/ids";
import { apiFailure } from "../http/api-failure";
import type { CheckoutStore, StaffActor } from "../../core/checkout/types";
import { mapConditionDisposition } from "../../core/returns/disposition";
import {
  allocateHistoricMinor,
  formatNonNegativeQuantity,
  formatQuantity,
  parseQuantity,
} from "../../core/returns/quantities";
import type { ReturnStore, StoredRequestedReturnLine, StoredReturnRecord } from "../../core/returns/types";
import { economicsVersionFromPreparedSale, returnFingerprintFor } from "./fingerprint";
import { getUnresolvedReturnForSale } from "./unresolved-return-store";

const PREVIEW_TTL_MS = 30 * 60 * 1000;

export async function previewReturn(input: {
  readonly checkoutStore: CheckoutStore;
  readonly returnStore: ReturnStore;
  readonly actor: StaffActor;
  readonly request: ReturnPreviewRequest;
  readonly correlationId: Uuid;
  readonly now: Date;
  readonly requireApproval?: boolean;
}): Promise<ApiResult<ReturnPreview>> {
  const sale = await input.checkoutStore.getSaleBySaleId(input.actor.organizationId, input.request.saleId);
  if (!sale || sale.status !== "completed") {
    return apiFailure("NOT_FOUND", "completed sale was not found", input.correlationId);
  }
  if (sale.organizationId !== input.actor.organizationId || !input.actor.locationIds.includes(sale.locationId)) {
    return apiFailure("FORBIDDEN", "sale is outside staff scope", input.correlationId);
  }

  let unresolvedReturn;
  try {
    unresolvedReturn = await getUnresolvedReturnForSale(
      input.returnStore,
      sale.organizationId,
      sale.prepared.saleId,
      input.now.toISOString(),
    );
  } catch {
    return apiFailure(
      "INTEGRATION_UNAVAILABLE",
      "existing return status is unavailable",
      input.correlationId,
    );
  }
  if (unresolvedReturn) {
    return apiFailure(
      "OPERATION_IN_PROGRESS",
      "This sale already has an unresolved return. Check the existing return before starting another.",
      input.correlationId,
      { operationId: unresolvedReturn.returnId },
    );
  }

  const orderLines = sale.orderLines;
  if (!orderLines || orderLines.length === 0) {
    return apiFailure("REQUIRES_ATTENTION", "sale is missing immutable order line identities", input.correlationId);
  }
  const payment = await input.checkoutStore.getPaymentForTransaction(sale.prepared.transactionId);
  if (!payment || payment.status !== "verified") {
    return apiFailure("PAYMENT_NOT_VERIFIED", "original tender is not verified", input.correlationId);
  }

  const requestedByLine = new Map(input.request.lines.map((line) => [line.orderLineId, line]));
  if (requestedByLine.size !== input.request.lines.length) {
    return apiFailure("VALIDATION_ERROR", "duplicate return lines are not allowed", input.correlationId);
  }

  const historicLines: HistoricSaleLineEconomics[] = [];
  const previewLines: ReturnPreviewLine[] = [];
  const requestedLines: StoredRequestedReturnLine[] = [];
  let refundMinor = 0;

  for (const requested of input.request.lines) {
    const sold = orderLines.find((line) => line.orderLineId === requested.orderLineId);
    if (!sold) {
      return apiFailure("VALIDATION_ERROR", "order line is not part of the historic sale", input.correlationId, {
        field: "orderLineId",
      });
    }
    let requestedQty: number;
    let originalQty: number;
    try {
      requestedQty = parseQuantity(requested.quantity);
      originalQty = parseQuantity(sold.quantity);
    } catch {
      return apiFailure("VALIDATION_ERROR", "return quantity is invalid", input.correlationId);
    }
    const previously = await input.returnStore.acceptedReturnedQuantity(
      sale.organizationId,
      sale.prepared.saleId,
      requested.orderLineId,
    );
    const remaining = originalQty - previously;
    if (remaining <= 0 || requestedQty > remaining) {
      return apiFailure("VALIDATION_ERROR", "requested quantity exceeds remaining returnable quantity", input.correlationId);
    }
    const lineRefund = allocateHistoricMinor({
      historicalTotal: sold.total,
      originalSold: originalQty,
      previouslyReturned: previously,
      requested: requestedQty,
    });
    if (lineRefund < 0) {
      return apiFailure("VALIDATION_ERROR", "requested quantity exceeds remaining returnable quantity", input.correlationId);
    }
    refundMinor += lineRefund;
    const mapped = mapConditionDisposition(requested.condition);
    const remainingText = formatNonNegativeQuantity(remaining);
    historicLines.push({
      orderLineId: requested.orderLineId,
      originalSoldQuantity: sold.quantity,
      previouslyReturnedQuantity: formatNonNegativeQuantity(previously),
      remainingReturnableQuantity: remainingText,
      historicalSubtotal: sold.subtotal,
      historicalDiscount: sold.discount,
      historicalTax: sold.tax,
      historicalTotal: sold.total,
    });
    previewLines.push({
      orderLineId: requested.orderLineId,
      requestedQuantity: formatQuantity(requestedQty),
      remainingReturnableQuantity: remainingText,
      condition: requested.condition,
      intendedDisposition: mapped.intendedDisposition,
      dispositionPolicy: mapped.dispositionPolicy,
    });
    requestedLines.push({
      ...previewLines[previewLines.length - 1]!,
      quantity: requested.quantity,
      reason: requested.reason,
      condition: requested.condition,
      allocatedHistoricAmount: { minor: lineRefund, currency: payment.amount.currency },
    });
  }

  const alreadyRefunded = await input.returnStore.acceptedRefundedMinor(payment.paymentId);
  const remainingRefundable = payment.amount.minor - alreadyRefunded;
  if (refundMinor > remainingRefundable) {
    return apiFailure("VALIDATION_ERROR", "requested refund exceeds remaining refundable tender", input.correlationId);
  }
  const historicTenders: HistoricTenderEconomics[] = [
    {
      paymentId: payment.paymentId,
      tender: payment.tender,
      originalAmount: payment.amount,
      alreadyRefundedAmount: { minor: alreadyRefunded, currency: payment.amount.currency },
      remainingRefundableAmount: { minor: remainingRefundable, currency: payment.amount.currency },
    },
  ];
  const economicsVersion = economicsVersionFromPreparedSale(sale.prepared.quoteFingerprint);
  const approvalRequired = Boolean(input.requireApproval);
  const returnId = crypto.randomUUID();
  const fingerprint = await returnFingerprintFor({
    returnId,
    saleId: sale.prepared.saleId,
    economicsVersion,
    refundTotal: { minor: refundMinor, currency: payment.amount.currency },
    approvalRequired,
    lines: previewLines,
  });
  const preview: ReturnPreview = {
    returnId,
    saleId: sale.prepared.saleId,
    economicsVersion,
    refundTotal: { minor: refundMinor, currency: payment.amount.currency },
    approvalRequired,
    fingerprint,
    expiresAt: toIsoTimestamp(new Date(input.now.getTime() + PREVIEW_TTL_MS)),
    lines: previewLines,
  };
  const record: StoredReturnRecord = {
    returnId,
    organizationId: sale.organizationId,
    locationId: sale.locationId,
    registerId: sale.registerId,
    shiftId: sale.shiftId,
    actorId: input.actor.actorId,
    transactionId: sale.prepared.transactionId,
    saleId: sale.prepared.saleId,
    economicsVersion,
    fingerprint,
    previewExpiresAt: preview.expiresAt,
    approvalRequired,
    refundTotal: preview.refundTotal,
    status: approvalRequired ? "approval_required" : "previewed",
    historicLines,
    historicTenders,
    requestedLines,
  };
  await input.returnStore.insertPreview(record);
  await input.returnStore.appendAudit({
    id: crypto.randomUUID(),
    returnId,
    organizationId: sale.organizationId,
    eventType: "return.previewed",
    payload: { saleId: sale.prepared.saleId, fingerprint },
    createdAt: toIsoTimestamp(input.now),
  });
  return { ok: true, data: preview, correlationId: input.correlationId };
}
