import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import type { PreparedSale, SaleResolution, Uuid } from "../../../../../docs/contracts/domain.generated";
import { apiFailure } from "../http/api-failure";
import { toIsoTimestamp } from "../auth/ids";
import type { CheckoutStore, PosSaleRecord, PrepareEffectCertainty, StaffActor } from "../../core/checkout/types";
import { prepareEffectEvidence } from "./prepare-effect";
import { findOfficialReceipt, materializeRemotePrepared, CANCELLED_ATTEMPT, PAYMENT_ALREADY_PENDING, PAYMENT_ALREADY_SUBMITTED, RECEIPT_MISSING } from "./prepare-sale";
import { isSaleResolution } from "./schema";
import { assertActorCanAccessSale, assertBindingMatchesActor } from "./transaction-scope";

export async function resolveSale(input: {
  readonly store: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "resolve">;
  readonly actor: StaffActor;
  readonly transactionId: Uuid;
  readonly correlationId: Uuid;
}): Promise<ApiResult<SaleResolution>> {
  const local = await input.store.getSale(input.transactionId);
  if (local) {
    const access = assertActorCanAccessSale({
      sale: local,
      actor: input.actor,
      correlationId: input.correlationId,
    });
    if (!access.ok) {
      return access;
    }
    return { ok: true, data: resolutionFromRecord(local), correlationId: input.correlationId };
  }

  const binding = await input.store.lookupCommandScope({
    transactionId: input.transactionId,
    operation: "sale.prepare",
  });
  if (!binding) {
    return {
      ok: true,
      data: { transactionId: input.transactionId, status: "not_found" },
      correlationId: input.correlationId,
    };
  }
  const allowed = assertBindingMatchesActor({
    binding,
    actor: input.actor,
    correlationId: input.correlationId,
  });
  if (!allowed.ok) {
    return allowed;
  }

  const remote = await input.salesPort.resolve(input.transactionId);
  if (!remote.ok) {
    await recordResolution(input.store, input.transactionId, {
      status: "requires_attention",
      effectCertainty: "unknown",
      errorCode: remote.error.code,
      message: remote.error.message,
    });
    return apiFailure(
      "REQUIRES_ATTENTION",
      "This sale needs a manager check. Do not start another sale for this attempt.",
      input.correlationId,
    );
  }
  if (!isSaleResolution(remote.data)) {
    await recordResolution(input.store, input.transactionId, {
      status: "requires_attention",
      effectCertainty: "unknown",
      errorCode: "INTEGRATION_UNAVAILABLE",
      message: "bridge returned an invalid SaleResolution",
    });
    return apiFailure(
      "REQUIRES_ATTENTION",
      "This sale needs a manager check. Do not start another sale for this attempt.",
      input.correlationId,
    );
  }
  if (remote.data.status === "not_found") {
    await recordResolution(input.store, input.transactionId, {
      status: "acknowledged",
      effectCertainty: "not_found",
      errorCode: "NOT_FOUND",
      remoteStatus: "not_found",
      message: remote.data.message,
    });
    return remote;
  }
  if (remote.data.status === "cancelled") {
    await recordResolution(input.store, input.transactionId, {
      status: "acknowledged",
      effectCertainty: "cancelled",
      errorCode: "NOT_FOUND",
      remoteStatus: "cancelled",
      message: CANCELLED_ATTEMPT,
    });
    return {
      ok: true,
      data: {
        transactionId: remote.data.transactionId,
        status: "cancelled",
        saleId: remote.data.saleId,
        orderReference: remote.data.orderReference,
        paymentId: remote.data.paymentId,
        message: CANCELLED_ATTEMPT,
      },
      correlationId: input.correlationId,
    };
  }
  if (remote.data.status === "prepared") {
    let materialized: ApiResult<PreparedSale>;
    try {
      materialized = await materializeRemotePrepared({
        store: input.store,
        actor: input.actor,
        transactionId: input.transactionId,
        correlationId: input.correlationId,
        now: new Date(),
        resolution: remote.data,
      });
    } catch {
      materialized = apiFailure(
        "REQUIRES_ATTENTION",
        "The remote sale is prepared, but it could not be stored for payment.",
        input.correlationId,
      );
    }
    const saved = materialized.ok ? await input.store.getSale(input.transactionId) : undefined;
    if (materialized.ok && saved) {
      return {
        ok: true,
        data: {
          transactionId: saved.prepared.transactionId,
          status: "prepared",
          saleId: saved.prepared.saleId,
          orderReference: saved.prepared.orderReference,
        },
        correlationId: input.correlationId,
      };
    }
    await recordResolution(input.store, input.transactionId, {
      status: "requires_attention",
      effectCertainty: "prepared",
      errorCode: "REQUIRES_ATTENTION",
      remoteStatus: "prepared",
      message: materialized.ok
        ? "The remote sale is prepared, but it could not be stored for payment."
        : materialized.error.message,
    });
    return {
      ok: true,
      data: {
        transactionId: input.transactionId,
        status: "requires_attention",
        message: materialized.ok
          ? "This sale needs a manager check. Do not start another sale for this attempt."
          : materialized.error.message,
      },
      correlationId: input.correlationId,
    };
  }
  if (remote.data.status === "finalizing") {
    await recordResolution(input.store, input.transactionId, {
      status: "requires_attention",
      effectCertainty: "finalizing",
      errorCode: "OPERATION_IN_PROGRESS",
      remoteStatus: "finalizing",
      paymentId: remote.data.paymentId,
      message: PAYMENT_ALREADY_SUBMITTED,
    });
    return {
      ok: true,
      data: {
        transactionId: remote.data.transactionId,
        status: "finalizing",
        saleId: remote.data.saleId,
        orderReference: remote.data.orderReference,
        paymentId: remote.data.paymentId,
        message: PAYMENT_ALREADY_SUBMITTED,
      },
      correlationId: input.correlationId,
    };
  }
  if (remote.data.status === "payment_pending") {
    await recordResolution(input.store, input.transactionId, {
      status: "requires_attention",
      effectCertainty: "payment_pending",
      errorCode: "OPERATION_IN_PROGRESS",
      remoteStatus: "payment_pending",
      paymentId: remote.data.paymentId,
      message: PAYMENT_ALREADY_PENDING,
    });
    return {
      ok: true,
      data: {
        transactionId: remote.data.transactionId,
        status: "payment_pending",
        saleId: remote.data.saleId,
        orderReference: remote.data.orderReference,
        paymentId: remote.data.paymentId,
        message: PAYMENT_ALREADY_PENDING,
      },
      correlationId: input.correlationId,
    };
  }
  if (remote.data.status === "completed") {
    const receipt = await findOfficialReceipt(input.store, input.transactionId);
    if (receipt) {
      await recordResolution(input.store, input.transactionId, {
        status: "acknowledged",
        effectCertainty: "completed",
        errorCode: "OPERATION_IN_PROGRESS",
        remoteStatus: "completed",
        paymentId: remote.data.paymentId,
        message: remote.data.message,
      });
      return {
        ok: true,
        data: {
          transactionId: remote.data.transactionId,
          status: "completed",
          saleId: remote.data.saleId,
          orderReference: remote.data.orderReference,
          receiptId: receipt.id,
          paymentId: remote.data.paymentId,
        },
        correlationId: input.correlationId,
      };
    }
    await recordResolution(input.store, input.transactionId, {
      status: "requires_attention",
      effectCertainty: "completed",
      errorCode: "REQUIRES_ATTENTION",
      remoteStatus: "completed",
      paymentId: remote.data.paymentId,
      message: RECEIPT_MISSING,
    });
    return {
      ok: true,
      data: {
        transactionId: input.transactionId,
        status: "requires_attention",
        message: RECEIPT_MISSING,
      },
      correlationId: input.correlationId,
    };
  }
  const message = remote.data.message ?? "This sale needs a manager check. Do not start another sale for this attempt.";
  await recordResolution(input.store, input.transactionId, {
    status: "requires_attention",
    effectCertainty: "unknown",
    errorCode: "REQUIRES_ATTENTION",
    remoteStatus: remote.data.status,
    paymentId: remote.data.paymentId,
    message,
  });
  return {
    ok: true,
    data: {
      transactionId: remote.data.transactionId,
      status: "requires_attention",
      message,
    },
    correlationId: input.correlationId,
  };
}

async function recordResolution(
  store: CheckoutStore,
  transactionId: Uuid,
  evidence: {
    readonly status: "requires_attention" | "acknowledged";
    readonly effectCertainty: PrepareEffectCertainty;
    readonly errorCode: string;
    readonly remoteStatus?: string;
    readonly paymentId?: Uuid;
    readonly message?: string;
  },
): Promise<void> {
  const operation = await store.findSalePrepareOperation(transactionId);
  if (!operation) {
    return;
  }
  await store.recordPrepareDiagnostic({
    organizationId: operation.organizationId,
    operation: "sale.prepare",
    idempotencyKey: operation.idempotencyKey,
    status: evidence.status,
    attemptedAt: toIsoTimestamp(new Date()),
    countAttempt: !operation.lastAttemptAt,
    errorCode: evidence.errorCode,
    outcome: prepareEffectEvidence({
      effectCertainty: evidence.effectCertainty,
      transactionId,
      idempotencyKey: operation.idempotencyKey,
      errorCode: evidence.errorCode,
      remoteStatus: evidence.remoteStatus,
      paymentId: evidence.paymentId,
      message: evidence.message,
    }),
  });
}

export function resolutionFromRecord(sale: PosSaleRecord): SaleResolution {
  const paymentId = sale.assignedPaymentId;
  if (sale.status === "completed" && sale.receipt) {
    return {
      transactionId: sale.prepared.transactionId,
      status: "completed",
      saleId: sale.prepared.saleId,
      orderReference: sale.prepared.orderReference,
      receiptId: sale.receipt.id,
      paymentId,
    };
  }
  if (sale.status === "cancelled") {
    return {
      transactionId: sale.prepared.transactionId,
      status: "cancelled",
      saleId: sale.prepared.saleId,
      orderReference: sale.prepared.orderReference,
      paymentId,
    };
  }
  if (sale.status === "requires_attention") {
    return {
      transactionId: sale.prepared.transactionId,
      status: "requires_attention",
      saleId: sale.prepared.saleId,
      orderReference: sale.prepared.orderReference,
      paymentId,
      message: "This transaction needs manager review. Do not start another sale.",
    };
  }
  if (sale.commercialConfirmed || sale.status === "finalizing") {
    return {
      transactionId: sale.prepared.transactionId,
      status: "finalizing",
      saleId: sale.prepared.saleId,
      orderReference: sale.prepared.orderReference,
      paymentId,
    };
  }
  if (paymentId) {
    return {
      transactionId: sale.prepared.transactionId,
      status: "payment_pending",
      saleId: sale.prepared.saleId,
      orderReference: sale.prepared.orderReference,
      paymentId,
    };
  }
  return {
    transactionId: sale.prepared.transactionId,
    status: "prepared",
    saleId: sale.prepared.saleId,
    orderReference: sale.prepared.orderReference,
  };
}
