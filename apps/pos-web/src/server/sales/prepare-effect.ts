import type { ApiFailure, Uuid } from "../../../../../docs/contracts/domain.generated";
import type { PrepareEffectCertainty } from "../../core/checkout/types";

export { effectCertaintyOf } from "../../core/checkout/prepare-claim";

export const PRE_EFFECT_FIELD = "pre_effect";

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

export function isProvenPreEffectFailure(failure: ApiFailure): boolean {
  return failure.error.details?.field === PRE_EFFECT_FIELD;
}

/** Keep the original code. The field tells clients this failure happened before any commercial send. */
export function withPreEffectSignal(failure: ApiFailure): ApiFailure {
  if (failure.error.nextAction !== "resolve" || isProvenPreEffectFailure(failure)) {
    return failure;
  }
  return {
    ...failure,
    error: {
      ...failure.error,
      details: {
        ...failure.error.details,
        field: PRE_EFFECT_FIELD,
      },
    },
  };
}

export type PrepareEffectEvidence = {
  readonly effectCertainty: PrepareEffectCertainty;
  readonly transactionId: Uuid;
  readonly idempotencyKey: Uuid;
  readonly errorCode: string;
  readonly remoteStatus?: string;
  readonly paymentId?: Uuid;
  readonly message?: string;
};

export function prepareEffectEvidence(input: {
  readonly effectCertainty: PrepareEffectCertainty;
  readonly transactionId: Uuid;
  readonly idempotencyKey: Uuid;
  readonly errorCode: string;
  readonly remoteStatus?: string;
  readonly paymentId?: Uuid;
  readonly message?: string;
}): PrepareEffectEvidence {
  return {
    effectCertainty: input.effectCertainty,
    transactionId: input.transactionId,
    idempotencyKey: input.idempotencyKey,
    errorCode: input.errorCode,
    ...(input.remoteStatus ? { remoteStatus: input.remoteStatus } : {}),
    ...(input.paymentId ? { paymentId: input.paymentId } : {}),
    ...(input.message ? { message: input.message } : {}),
  };
}
