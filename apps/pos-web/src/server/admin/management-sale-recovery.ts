import type { Money, PreparedSale, PrepareSaleRequest, SaleResolution } from "../../../../../docs/contracts/domain.generated";
import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import { claimKindForExistingPrepare, effectCertaintyOf } from "../../core/checkout/prepare-claim";
import { moneyEqual, type CheckoutStore } from "../../core/checkout/types";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { isUuid } from "../auth/ids";
import { validateCanonicalDef } from "../quotes/canonical-schema";
import { isPrepareSaleRequest, isPreparedSale, isSaleResolution } from "../sales/schema";
import type { OriginalManagementPrepare } from "./management-sale-recovery-store";

export type ManagementSaleRecoveryView = {
  readonly transactionId: string;
  readonly locationId: string;
  readonly registerId: string;
  readonly status: "eligible" | "blocked" | "ready";
  readonly message: string;
  readonly orderReference?: string;
  readonly total?: Money;
};

export type ProvenManagementPrepare = {
  readonly request: PrepareSaleRequest;
  readonly idempotencyKey: string;
  readonly view: ManagementSaleRecoveryView;
  readonly prepared?: PreparedSale;
};

const PARTIAL_ORDER = "This existing order cannot yet be safely opened for payment.";

/** No writes: GET must never materialize, acknowledge or repair a commercial order. */
export async function proveManagementSaleRecovery(input: {
  readonly original: OriginalManagementPrepare;
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "resolve">;
  readonly now: () => Date;
}): Promise<ProvenManagementPrepare | ManagementSaleRecoveryView> {
  const { original, store } = input;
  const blocked = (message: string): ManagementSaleRecoveryView => ({
    transactionId: original.transactionId, locationId: original.locationId, registerId: original.registerId,
    status: "blocked", message,
  });
  const intent = original.intent;
  if (!isUuid(original.transactionId) || !isUuid(original.idempotencyKey) || !isUuid(original.shiftId) ||
      intent.transactionId !== original.transactionId || !/^[a-f0-9]{64}$/.test(original.requestHash)) {
    return blocked("The original sale identity could not be proven. Keep this sale for review.");
  }
  const [binding, shift, register, quote] = await Promise.all([
    store.lookupCommandScope({ transactionId: original.transactionId, operation: "sale.prepare" }),
    store.getShift(original.shiftId), store.getRegister(original.registerId), store.getQuote(intent.quoteId),
  ]);
  if (!binding || binding.organizationId !== original.organizationId || binding.locationId !== original.locationId ||
      binding.registerId !== original.registerId || binding.shiftId !== original.shiftId || binding.transactionId !== original.transactionId ||
      !register || register.id !== original.registerId || register.organizationId !== original.organizationId ||
      register.locationId !== original.locationId || register.status !== "active" ||
      !shift || shift.id !== original.shiftId || shift.organizationId !== original.organizationId ||
      shift.locationId !== original.locationId || shift.registerId !== original.registerId || shift.status !== "open") {
    return blocked("The original register and open shift must still be available at this location.");
  }
  const device = await store.getDevice(shift.deviceId);
  if (!device || device.id !== shift.deviceId || device.organizationId !== original.organizationId ||
      device.locationId !== original.locationId || device.status !== "active") {
    return blocked("The original sale device is no longer available at this location.");
  }
  if (!quote || !validateCanonicalDef("Quote", quote) || quote.id !== intent.quoteId ||
      quote.locationId !== original.locationId || quote.fingerprint !== intent.quoteFingerprint || !quote.purchasable ||
      !Number.isFinite(Date.parse(quote.expiresAt)) || quote.lines.length === 0 || quote.lines.length !== intent.lines.length ||
      quote.lines.some((line, index) => {
        const frozen = intent.lines[index];
        return !frozen || line.lineId !== intent.lineIds[index] || line.quantity !== frozen.quantity ||
          !(["unitPrice", "subtotal", "discount", "tax", "total"] as const).every((field) => moneyEqual(line[field], frozen[field]));
      })) return blocked("The original frozen quote and sale lines could not be proven. Current prices were not substituted.");
  const request: PrepareSaleRequest = {
    transactionId: original.transactionId, registerId: original.registerId, shiftId: original.shiftId,
    deviceId: shift.deviceId, quoteId: intent.quoteId, quoteFingerprint: intent.quoteFingerprint,
  };
  // Optional customer presentation is not stored in this intent. Never invent
  // it from current customer data or silently remove it from the original command.
  if (!isPrepareSaleRequest(request) || await sha256Hex(canonicalJson(request)) !== original.requestHash) {
    return blocked("The exact original sale request is unavailable. Continue recovery from the original device or ask support to review this sale.");
  }
  const claimKind = claimKindForExistingPrepare({ status: original.status, outcome: original.outcome, intentPresent: true });
  const certainty = effectCertaintyOf(original.outcome);
  const storedOutcome = original.outcome !== null && typeof original.outcome === "object"
    ? original.outcome as { paymentId?: unknown; receiptId?: unknown } : undefined;
  if (claimKind !== "repair" && claimKind !== "replay" ||
      storedOutcome?.paymentId || storedOutcome?.receiptId ||
      certainty && ["none", "not_found", "payment_pending", "finalizing", "completed", "cancelled"].includes(certainty)) {
    return blocked("This sale is not eligible for an existing-order repair. Check its current status before taking payment.");
  }
  if (await hasFinancialOrTerminalEvidence(store, original.transactionId)) {
    return blocked("Payment or other sale work already exists. Check that existing work; do not repair or take another payment.");
  }
  const local = await store.getSale(original.transactionId);
  if (local && (claimKind !== "replay" || local.organizationId !== original.organizationId || local.locationId !== original.locationId ||
      local.registerId !== request.registerId || local.shiftId !== request.shiftId || local.deviceId !== request.deviceId ||
      local.status !== "prepared" || local.assignedPaymentId || local.receipt || local.commercialConfirmed ||
      !isPreparedSale(local.prepared) || local.prepared.transactionId !== request.transactionId ||
      local.prepared.quoteFingerprint !== request.quoteFingerprint || !moneyEqual(local.prepared.total, quote.total) ||
      canonicalJson(local.prepared) !== canonicalJson(original.outcome) ||
      !Number.isFinite(Date.parse(local.prepared.expiresAt)) ||
      Date.parse(local.prepared.expiresAt) <= input.now().getTime())) {
    return blocked("The saved sale cannot safely be reopened for payment. Keep its existing work for review.");
  }
  if (!local && claimKind === "replay") return blocked("The acknowledged original sale is missing its saved payment reservation. Keep it for review.");
  let remote: ApiResult<SaleResolution>;
  try { remote = await input.salesPort.resolve(original.transactionId); }
  catch { return blocked("Commerce status could not be checked. Keep this same sale and check again when the connection is available."); }
  if (!remote.ok || !isSaleResolution(remote.data)) return blocked("Commerce status could not be checked. Keep this same sale and check again when the connection is available.");
  const resolution = remote.data;
  if (resolution.transactionId !== request.transactionId || !resolution.saleId || !resolution.orderReference ||
      resolution.paymentId || resolution.receiptId || !(resolution.status === "prepared" ||
        resolution.status === "requires_attention" && resolution.message === PARTIAL_ORDER)) {
    return blocked("The existing commerce order has not been proven unpaid and repairable. Do not start it again or take payment.");
  }
  // Recheck after the remote await: another operator may have submitted payment.
  if (await hasFinancialOrTerminalEvidence(store, original.transactionId)) return blocked("Other sale work appeared during the check. Check that work before taking payment.");
  const latest = await store.getSale(original.transactionId);
  if (local) {
    if (!latest || canonicalJson(latest) !== canonicalJson(local) || resolution.status !== "prepared" ||
        resolution.saleId !== local.prepared.saleId || resolution.orderReference !== local.prepared.orderReference ||
        Date.parse(local.prepared.expiresAt) <= input.now().getTime()) return blocked("The original prepared sale changed during the check. Check its current status again.");
  } else if (latest) return blocked("The original sale was saved during the check. Check its current status again.");
  return {
    request, idempotencyKey: original.idempotencyKey,
    ...(local ? { prepared: local.prepared } : {}),
    view: {
      transactionId: original.transactionId, locationId: original.locationId, registerId: original.registerId,
      status: local ? "ready" : "eligible", orderReference: resolution.orderReference, total: quote.total,
      message: local ? "The original sale is prepared. Return to its register and continue the same sale after checking its current status."
        : "The existing unpaid order can be checked and repaired using its original sale request. Your name is recorded as the staff member recovering this sale. Repair does not take payment.",
    },
  };
}

async function hasFinancialOrTerminalEvidence(store: CheckoutStore, transactionId: string): Promise<boolean> {
  const evidence = await Promise.all([
    store.getPaymentForTransaction(transactionId), store.getReceipt(transactionId), store.listCashSales(transactionId),
    ...(["sale.finalize", "sale.cancel", "payment.initialize", "payment.cash"] as const).map((operation) => store.lookupCommandScope({ transactionId, operation })),
  ]);
  return evidence.some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
}
