import type { ApiFailure, Uuid } from "../../../../../docs/contracts/domain.generated";
import type { PrepareEffectCertainty } from "../../core/checkout/types";

const PRE_EFFECT_CODES = new Set<ApiFailure["error"]["code"]>([
  "VALIDATION_ERROR",
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "QUOTE_CHANGED",
  "QUOTE_EXPIRED",
  "STOCK_CHANGED",
  "SHIFT_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
]);

/**
 * Bridge rejections that are returned before Woo order create.
 * INTEGRATION_UNAVAILABLE and any nextAction of resolve are not in this set:
 * those can mean the commercial effect already happened.
 */
export function isDefinitivePreEffectRejection(failure: ApiFailure): boolean {
  return (
    failure.error.retryable === false &&
    failure.error.nextAction !== "resolve" &&
    PRE_EFFECT_CODES.has(failure.error.code)
  );
}

export type PrepareEffectEvidence = {
  readonly effectCertainty: PrepareEffectCertainty;
  readonly transactionId: Uuid;
  readonly idempotencyKey: Uuid;
  readonly errorCode: string;
  readonly remoteStatus?: string;
  readonly message?: string;
};

export function prepareEffectEvidence(input: {
  readonly effectCertainty: PrepareEffectCertainty;
  readonly transactionId: Uuid;
  readonly idempotencyKey: Uuid;
  readonly errorCode: string;
  readonly remoteStatus?: string;
  readonly message?: string;
}): PrepareEffectEvidence {
  return {
    effectCertainty: input.effectCertainty,
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey,
    errorCode: input.errorCode,
    ...(input.remoteStatus ? { remoteStatus: input.remoteStatus } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
}

export function effectCertaintyOf(outcome: unknown): PrepareEffectCertainty | undefined {
  if (outcome === null || typeof outcome !== "object" || !("effectCertainty" in outcome)) {
    return undefined;
  }
  const value = (outcome as { effectCertainty?: unknown }).effectCertainty;
  if (
    value === "none" ||
    value === "unknown" ||
    value === "not_found" ||
    value === "prepared" ||
    value === "completed"
  ) {
    return value;
  }
  return undefined;
}
