import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { CashMovement, CommandContext, OpenShiftRequest, Shift } from "../../../../../docs/contracts/domain.generated";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { toIsoTimestamp } from "../auth/ids";
import { apiFailure } from "../http/api-failure";
import type { CheckoutStore, StaffActor, StoredShift } from "../../core/checkout/types";
import { validateCanonicalDef } from "../quotes/canonical-schema";
import { toPublicShift } from "./shift-public";

const PRE_SEND_REJECTED = "pre_send_rejected";

export async function openShift(input: {
  readonly store: CheckoutStore;
  readonly actor: StaffActor;
  readonly request: OpenShiftRequest;
  readonly context: CommandContext;
  readonly now: Date;
}): Promise<ApiResult<Shift>> {
  const { store, actor, request, context, now } = input;
  return store.withLock(`shift:${request.registerId}`, async () => {
    const register = await store.getRegister(request.registerId);
    if (!register || register.status !== "active") {
      return apiFailure("NOT_FOUND", "register is not available", context.correlationId);
    }
    if (register.locationStatus === "inactive") {
      return apiFailure("NOT_FOUND", "location is inactive; reactivate it before opening a shift", context.correlationId);
    }
    if (register.organizationId !== actor.organizationId) {
      return apiFailure("FORBIDDEN", "register is out of staff organization scope", context.correlationId);
    }
    if (!actor.locationIds.includes(register.locationId)) {
      return apiFailure("FORBIDDEN", "register location is out of staff scope", context.correlationId);
    }
    if (request.openingFloat.currency !== register.currency) {
      return apiFailure("VALIDATION_ERROR", "opening float currency must match register", context.correlationId);
    }
    const device = await store.getDevice(request.deviceId);
    if (
      !device ||
      device.status !== "active" ||
      device.organizationId !== register.organizationId ||
      device.locationId !== register.locationId
    ) {
      return apiFailure("VALIDATION_ERROR", "device is not at the register location", context.correlationId);
    }

    const hash = await sha256Hex(canonicalJson(request));
    const claim = await store.claimIdempotency(
      actor.organizationId,
      "shift.open",
      context.idempotencyKey,
      hash,
      register.locationId,
      { registerId: request.registerId },
    );
    if (claim.kind === "conflict") {
      return apiFailure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different open-shift request",
        context.correlationId,
      );
    }
    if (claim.kind === "in_progress") {
      return apiFailure("OPERATION_IN_PROGRESS", "open shift is already in progress for this key", context.correlationId);
    }
    if (claim.kind === "replay") {
      return replayShift(claim.outcome, context.correlationId);
    }
    if (claim.kind === "repair") {
      const rejected = asPreSendRejection(claim.outcome);
      if (rejected) {
        return apiFailure(rejected.code, rejected.message, context.correlationId);
      }
      return replayShift(claim.outcome, context.correlationId);
    }

    await store.markIdempotencySent(actor.organizationId, "shift.open", context.idempotencyKey);
    const openedAt = toIsoTimestamp(now);
    const shift: StoredShift = {
      id: crypto.randomUUID(),
      registerId: request.registerId,
      deviceId: request.deviceId,
      cashierId: actor.actorId,
      status: "open",
      openingFloat: request.openingFloat,
      expectedCash: request.openingFloat,
      openedAt,
      organizationId: register.organizationId,
      locationId: register.locationId,
    };
    const inserted = await store.insertOpenShift(shift);
    if (inserted === "conflict") {
      await store.releaseIdempotency(actor.organizationId, "shift.open", context.idempotencyKey);
      return apiFailure("SHIFT_CONFLICT", "register already has an active shift", context.correlationId);
    }
    if (request.openingFloat.minor > 0) {
      const movement: CashMovement = {
        id: crypto.randomUUID(),
        shiftId: shift.id,
        kind: "opening_float",
        signedAmount: { minor: request.openingFloat.minor, currency: request.openingFloat.currency },
        actorId: actor.actorId,
        createdAt: openedAt,
        reason: "opening float",
      };
      const appended = await store.appendCashMovement({ ...movement, organizationId: register.organizationId });
      if (appended !== "ok") {
        await store.releaseIdempotency(actor.organizationId, "shift.open", context.idempotencyKey);
        return apiFailure("SHIFT_CONFLICT", "opening float could not be journaled", context.correlationId);
      }
    }
    const publicShift = toPublicShift(shift);
    if (!validateCanonicalDef("Shift", publicShift)) {
      await store.releaseIdempotency(actor.organizationId, "shift.open", context.idempotencyKey);
      return apiFailure("INTEGRATION_UNAVAILABLE", "open shift produced an invalid Shift", context.correlationId);
    }
    await store.acknowledgeIdempotency(actor.organizationId, "shift.open", context.idempotencyKey, publicShift);
    return { ok: true, data: publicShift, correlationId: context.correlationId };
  });
}

function replayShift(outcome: unknown, correlationId: CommandContext["correlationId"]): ApiResult<Shift> {
  if (!validateCanonicalDef("Shift", outcome)) {
    return apiFailure("INTEGRATION_UNAVAILABLE", "stored open-shift outcome is not a valid Shift", correlationId);
  }
  return { ok: true, data: outcome as Shift, correlationId };
}

function asPreSendRejection(outcome: unknown): { readonly code: "VALIDATION_ERROR" | "NOT_FOUND" | "FORBIDDEN"; readonly message: string } | null {
  if (outcome === null || typeof outcome !== "object") {
    return null;
  }
  const row = outcome as Record<string, unknown>;
  if (row.kind !== PRE_SEND_REJECTED || typeof row.message !== "string") {
    return null;
  }
  if (row.code === "VALIDATION_ERROR" || row.code === "NOT_FOUND" || row.code === "FORBIDDEN") {
    return { code: row.code, message: row.message };
  }
  return null;
}
