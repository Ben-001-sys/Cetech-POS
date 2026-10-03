import type { ApiResult, CheckoutUseCases } from "../../../../docs/contracts/ports";
import type { PreparedSale, PrepareSaleRequest } from "../../../../docs/contracts/domain.generated";
import type { PosLocalDatabase } from "../local/pos-local-db";
import { canonicalJson, sha256Hex } from "../local/canonical";
import { createOperationJournal } from "../local/operation-journal";
import { createCheckoutAttemptStore, discardCheckoutAttemptMemory, type CheckoutAttemptRecord } from "../features/sell/runtime/checkout-attempt-store";
import { isPrepareSaleRequest, isPreparedSale } from "../server/sales/schema";
import type { AttentionItemView } from "../ui/operational";
import type { AttentionRecoveryOutcome, LocalRecoveryContext } from "./attention-recovery";

const ATTEMPT_KEY = "checkout.active-business-attempt";
// These finite GET diagnostics identify an original prepare or its failed
// materialization. They offer an operator action, never authorize its mutation.
// The server must still prove the same unpaid order and original frozen intent.
const ORIGINAL_PREPARE_REPAIR_DIAGNOSTICS = new Set([
  "This existing order cannot yet be safely opened for payment.",
  "The stored quote is no longer valid, so this prepared sale cannot be opened for payment. Current catalog data was not used.",
  "The remote sale is prepared, but it could not be stored for payment.",
]);

export function canOfferOriginalPrepareRepair(outcome: AttentionRecoveryOutcome, transactionId?: string): boolean {
  if (outcome.status !== "attempted" || outcome.kind !== "sale" || !outcome.result.ok) return false;
  const sale = outcome.result.data;
  if (transactionId && sale.transactionId !== transactionId) return false;
  if (sale.paymentId || sale.receiptId) return false;
  if (sale.status === "prepared") return Boolean(sale.saleId && sale.orderReference);
  return sale.status === "requires_attention" && ORIGINAL_PREPARE_REPAIR_DIAGNOSTICS.has(sale.message ?? "");
}

export type OriginalPrepareRepair = {
  readonly itemId: string;
  readonly request: PrepareSaleRequest;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly attempt: CheckoutAttemptRecord;
  readonly attemptValue: string;
};

/** A repair can only replay the durable command authored in this context. */
export async function loadOriginalPrepareRepair(input: {
  readonly db: PosLocalDatabase;
  readonly item: AttentionItemView;
  readonly context: LocalRecoveryContext;
  readonly shiftId: string;
}): Promise<OriginalPrepareRepair | null> {
  const { db, item, context } = input;
  if (!item.id.startsWith("local-journal:") || !item.transactionId || item.recoverKind !== "sale" ||
      item.localRecoveryOwner !== "viewer" || item.quarantine || !item.resolveAllowed) return null;
  const row = await db.journal.get(item.id.slice("local-journal:".length));
  if (!row || row.operation !== "sale.prepare" || row.status === "acknowledged" ||
      row.transactionId !== item.transactionId || row.id !== row.idempotencyKey ||
      row.recoveryScope?.organizationId !== context.organizationId ||
      row.recoveryScope?.createdByActorId !== context.actorId ||
      row.recoveryScope?.registerId !== context.registerId || row.recoveryScope?.deviceId !== context.deviceId) return null;
  let payload: { payloadVersion?: unknown; operation?: unknown; transactionId?: unknown; request?: unknown };
  let attempt: CheckoutAttemptRecord;
  const stored = await db.kv.get(ATTEMPT_KEY);
  if (!stored) return null;
  try {
    payload = JSON.parse(row.payload);
    attempt = JSON.parse(stored.value);
  } catch { return null; }
  if (!payload || payload.payloadVersion !== "1.0.0" || payload.operation !== "sale.prepare" ||
      payload.transactionId !== row.transactionId || !isPrepareSaleRequest(payload.request) ||
      await sha256Hex(canonicalJson(payload)) !== row.requestHash) return null;
  const request = payload.request;
  if (!attempt || attempt.transactionId !== request.transactionId || attempt.prepareKey !== row.idempotencyKey ||
      attempt.quoteId !== request.quoteId || attempt.quoteFingerprint !== request.quoteFingerprint ||
      attempt.registerId !== request.registerId || attempt.shiftId !== request.shiftId || attempt.deviceId !== request.deviceId ||
      request.shiftId !== input.shiftId ||
      request.registerId !== context.registerId || request.deviceId !== context.deviceId ||
      !Number.isSafeInteger(attempt.quoteTotalMinor) || attempt.quoteTotalMinor < 0 || attempt.currency !== "GHS" ||
      attempt.paymentId || attempt.saleCompleted || attempt.prepared || attempt.cancelKey || attempt.cancelCorrelationId ||
      !["finalize_failed", "resolving_sale", "prepare_failed"].includes(attempt.stage) ||
      !isUuid(attempt.prepareCorrelationId) || !isUuid(attempt.cashKey) || !isUuid(attempt.cashCorrelationId) ||
      !isUuid(attempt.finalizeKey) || !isUuid(attempt.finalizeCorrelationId)) return null;
  const rows = await db.journal.where("transactionId").equals(request.transactionId).toArray();
  if (rows.some((other) => other.operation !== "sale.prepare" || other.id !== row.id)) return null;
  return { itemId: item.id, request, idempotencyKey: row.idempotencyKey, correlationId: attempt.prepareCorrelationId, attempt, attemptValue: stored.value };
}

/** A stale response may not acknowledge another sign-in's original prepare. */
export async function shouldDeferOriginalPrepareAcknowledgement(input: {
  readonly db: PosLocalDatabase;
  readonly item: AttentionItemView;
  readonly context: LocalRecoveryContext;
  readonly shiftId: string;
  readonly transactionId: string;
  readonly isCurrent: () => boolean;
}): Promise<boolean> {
  const { item, context } = input;
  if (!item.id.startsWith("local-journal:") || item.recoverKind !== "sale" || item.quarantine ||
      item.localRecoveryOwner !== "viewer" || item.transactionId !== input.transactionId) return false;
  const row = await input.db.journal.get(item.id.slice("local-journal:".length));
  if (!row || row.operation !== "sale.prepare" || row.transactionId !== input.transactionId || row.status === "acknowledged" ||
      row.recoveryScope?.createdByActorId !== context.actorId || row.recoveryScope?.organizationId !== context.organizationId ||
      row.recoveryScope?.registerId !== context.registerId || row.recoveryScope?.deviceId !== context.deviceId) return false;
  // The original row remains evidence even if the active attempt changed with
  // the sign-in while its status request was in flight. Do not overwrite it.
  if (!input.isCurrent()) return true;
  const original = await loadOriginalPrepareRepair(input);
  return !input.isCurrent() || Boolean(original);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type OriginalPrepareRepairOutcome =
  | { readonly status: "blocked" | "stale" }
  | { readonly status: "failed"; readonly result?: ApiResult<PreparedSale> }
  | { readonly status: "ready"; readonly result: ApiResult<PreparedSale> };

/** Explicit operator mutation. Status checks never call this function. */
export async function repairOriginalPrepare(input: {
  readonly db: PosLocalDatabase;
  readonly item: AttentionItemView;
  readonly context: LocalRecoveryContext;
  readonly shiftId: string;
  readonly checkout: Pick<CheckoutUseCases, "prepare">;
  readonly isCurrent: () => boolean;
}): Promise<OriginalPrepareRepairOutcome> {
  if (!input.isCurrent()) return { status: "stale" };
  const original = await loadOriginalPrepareRepair(input);
  if (!original) return { status: "blocked" };
  if (!input.isCurrent()) return { status: "stale" };
  let result: ApiResult<PreparedSale>;
  try {
    result = await input.checkout.prepare(original.request, {
      idempotencyKey: original.idempotencyKey,
      correlationId: original.correlationId,
    });
  } catch { return { status: "failed" }; }
  if (!input.isCurrent()) return { status: "stale" };
  if (!result.ok) return { status: "failed", result };
  if (!isPreparedSale(result.data) || result.data.transactionId !== original.request.transactionId ||
      result.data.quoteFingerprint !== original.request.quoteFingerprint ||
      result.data.total.minor !== original.attempt.quoteTotalMinor || result.data.total.currency !== original.attempt.currency ||
      Date.parse(result.data.expiresAt) <= Date.now()) return { status: "failed" };
  // Compare with the durable attempt again; never overwrite work created while the request was in flight.
  try {
    await input.db.transaction("rw", input.db.kv, async () => {
      const current = await input.db.kv.get(ATTEMPT_KEY);
      if (!input.isCurrent() || current?.value !== original.attemptValue) throw new Error("stale attempt");
      await createCheckoutAttemptStore(input.db).write({
        ...original.attempt,
        prepared: {
          transactionId: result.data.transactionId,
          saleId: result.data.saleId,
          orderReference: result.data.orderReference,
          quoteFingerprint: result.data.quoteFingerprint,
          total: result.data.total,
        },
        stage: "choose_payment",
        message: "",
      });
    });
  } catch {
    discardCheckoutAttemptMemory(input.db.name);
    return { status: "stale" };
  }
  try {
    await createOperationJournal(input.db).markAcknowledged(original.idempotencyKey);
  } catch { return { status: "failed" }; }
  return { status: "ready", result };
}
