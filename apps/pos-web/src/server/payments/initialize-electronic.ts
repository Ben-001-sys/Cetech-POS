import type { ApiResult } from "../../../../../docs/contracts/ports";
import type {
  CommandContext,
  InitializePaymentRequest,
  PaymentState,
} from "../../../../../docs/contracts/domain.generated";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { apiFailure } from "../http/api-failure";
import type { CheckoutStore, StaffActor, StoredPayment } from "../../core/checkout/types";
import { validateCanonicalDef } from "../quotes/canonical-schema";
import { toPaymentState } from "./payment-state";
import { sandboxPayerEmail } from "./payer-email";
import type { ElectronicPaymentProvider } from "./provider";
import { providerReferenceFor } from "./reference";

export async function initializeElectronicPayment(input: {
  readonly store: CheckoutStore;
  readonly provider: ElectronicPaymentProvider;
  readonly actor: StaffActor;
  readonly request: InitializePaymentRequest;
  readonly context: CommandContext;
  readonly now: Date;
  readonly appEnv: string;
  readonly sandboxPayerEmail?: string;
  readonly methodConfigured?: boolean;
}): Promise<ApiResult<PaymentState>> {
  const { store, provider, actor, request, context, appEnv } = input;
  const requestStartedAt = Date.now();
  return store.withLock(`pay:${request.transactionId}`, async () => {
    const sale = await store.getSale(request.transactionId);
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
      return apiFailure("VALIDATION_ERROR", "sale cannot accept electronic payment in its current state", context.correlationId);
    }
    const existing = await store.getPaymentForTransaction(request.transactionId);
    if (existing?.status === "verified") {
      return apiFailure("VALIDATION_ERROR", "a verified tender already exists for this sale", context.correlationId);
    }
    if (existing && existing.tender === "cash") {
      return apiFailure("VALIDATION_ERROR", "a verified tender already exists for this sale", context.correlationId);
    }

    const hash = await sha256Hex(canonicalJson(request));
    const claim = await store.claimIdempotency(
      actor.organizationId,
      "payment.initialize",
      context.idempotencyKey,
      hash,
      sale.locationId,
      { transactionId: request.transactionId, registerId: sale.registerId, shiftId: sale.shiftId },
    );
    if (claim.kind === "conflict") {
      return apiFailure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency-Key was reused with a different initialize request",
        context.correlationId,
      );
    }
    if (claim.kind === "in_progress") {
      return apiFailure("OPERATION_IN_PROGRESS", "payment initialize is already in progress for this key", context.correlationId);
    }
    if (claim.kind === "replay" || claim.kind === "repair") {
      const durable = existing ?? (await store.getPaymentForTransaction(request.transactionId));
      if (durable) {
        return succeed(durable, context.correlationId);
      }
    }

    if (existing?.providerReference) {
      if (existing.tender !== request.tender) {
        await store.releaseIdempotency(actor.organizationId, "payment.initialize", context.idempotencyKey);
        return apiFailure(
          "VALIDATION_ERROR",
          "an electronic payment intent already exists for a different tender",
          context.correlationId,
        );
      }
      const state = toPaymentState(existing);
      await store.acknowledgeIdempotency(actor.organizationId, "payment.initialize", context.idempotencyKey, state);
      return succeed(existing, context.correlationId);
    }

    // Resolve idempotency and any existing intent before applying current
    // method availability. A configuration change must not hide a replay or
    // conflict for an already-effectful request, but no new provider side
    // effect may start when the selected method is disabled.
    if (input.methodConfigured === false) {
      await store.releaseIdempotency(actor.organizationId, "payment.initialize", context.idempotencyKey);
      return apiFailure(
        "INTEGRATION_UNAVAILABLE",
        "the selected electronic payment method is not configured",
        context.correlationId,
      );
    }

    const payer = sandboxPayerEmail({ appEnv, configuredEmail: input.sandboxPayerEmail });
    if (!payer) {
      await store.releaseIdempotency(actor.organizationId, "payment.initialize", context.idempotencyKey);
      return apiFailure(
        "INTEGRATION_UNAVAILABLE",
        appEnv === "production"
          ? "trusted payer contact is required for production electronic initialization"
          : "sandbox payer email is not configured",
        context.correlationId,
      );
    }

    await store.markIdempotencySent(actor.organizationId, "payment.initialize", context.idempotencyKey);

    const expiresAt = Date.parse(sale.prepared.expiresAt);
    const observedAt = input.now.getTime() + Math.max(0, Date.now() - requestStartedAt);
    if (!Number.isFinite(expiresAt) || !Number.isFinite(observedAt) || expiresAt <= observedAt) {
      await store.releaseIdempotency(actor.organizationId, "payment.initialize", context.idempotencyKey);
      return apiFailure(
        "REQUIRES_ATTENTION",
        "the prepared sale reservation has expired or cannot be verified; check this sale before taking payment",
        context.correlationId,
        { field: "pre_effect" },
      );
    }

    const paymentId = crypto.randomUUID();
    const providerReference = providerReferenceFor(paymentId);
    const intent: StoredPayment = {
      paymentId,
      transactionId: request.transactionId,
      saleId: sale.prepared.saleId,
      tender: request.tender,
      status: "initializing",
      amount: sale.prepared.total,
      actorId: actor.actorId,
      provider: provider.id,
      providerReference,
      displayReference: providerReference,
      initializeStatus: "pending_remote",
    };
    await store.savePayment(intent);
    await store.saveSale({
      ...sale,
      status: "payment_pending",
      assignedPaymentId: paymentId,
    });

    const remote = await provider.initialize({
      reference: providerReference,
      amount: sale.prepared.total,
      email: payer.email,
      tender: request.tender,
      metadata: {
        transactionId: request.transactionId,
        paymentId,
        saleId: sale.prepared.saleId,
        organizationId: sale.organizationId,
        locationId: sale.locationId,
      },
    });
    if (remote.kind === "live_mode_blocked") {
      const blocked: StoredPayment = {
        ...intent,
        status: "requires_attention",
        initializeStatus: "lost_response",
        attentionReason: "live provider configuration is not authorized",
      };
      await store.savePayment(blocked);
      await store.markIdempotencyRequiresAttention(
        actor.organizationId,
        "payment.initialize",
        context.idempotencyKey,
        toPaymentState(blocked),
      );
      return succeed(blocked, context.correlationId);
    }
    if (remote.kind === "lost_response") {
      const lost: StoredPayment = {
        ...intent,
        status: "reconciling",
        initializeStatus: "lost_response",
        attentionReason: "provider initialize response was lost; resolve the original reference",
      };
      await store.savePayment(lost);
      await store.markIdempotencyRequiresAttention(
        actor.organizationId,
        "payment.initialize",
        context.idempotencyKey,
        toPaymentState(lost),
      );
      return succeed(lost, context.correlationId);
    }
    if (remote.kind === "failed") {
      const failed: StoredPayment = {
        ...intent,
        status: remote.retryable ? "reconciling" : "failed",
        initializeStatus: remote.retryable ? "lost_response" : "initialized",
        attentionReason: remote.message,
      };
      await store.savePayment(failed);
      if (remote.retryable) {
        await store.markIdempotencyRequiresAttention(
          actor.organizationId,
          "payment.initialize",
          context.idempotencyKey,
          toPaymentState(failed),
        );
      } else {
        await store.acknowledgeIdempotency(
          actor.organizationId,
          "payment.initialize",
          context.idempotencyKey,
          toPaymentState(failed),
        );
      }
      return succeed(failed, context.correlationId);
    }

    const awaiting: StoredPayment = {
      ...intent,
      status: "awaiting_customer",
      initializeStatus: "initialized",
      accessCode: remote.accessCode,
      displayReference: remote.displayReference,
    };
    await store.savePayment(awaiting);
    const state = toPaymentState(awaiting);
    if (!validateCanonicalDef("PaymentState", state)) {
      await store.releaseIdempotency(actor.organizationId, "payment.initialize", context.idempotencyKey);
      return apiFailure("INTEGRATION_UNAVAILABLE", "initialize produced an invalid PaymentState", context.correlationId);
    }
    await store.acknowledgeIdempotency(actor.organizationId, "payment.initialize", context.idempotencyKey, state);
    return { ok: true, data: state, correlationId: context.correlationId };
  });
}

function succeed(payment: StoredPayment, correlationId: CommandContext["correlationId"]): ApiResult<PaymentState> {
  return { ok: true, data: toPaymentState(payment), correlationId };
}
