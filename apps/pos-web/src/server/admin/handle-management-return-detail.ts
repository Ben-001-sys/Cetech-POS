import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Money, ReturnCondition, StockDisposition, Uuid } from "../../../../../docs/contracts/domain.generated";
import type { CheckoutStore, PosSaleRecord } from "../../core/checkout/types";
import type { ReturnStore, StoredReturnRecord } from "../../core/returns/types";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import { authFailure } from "../auth/errors";
import { isUuid } from "../auth/ids";
import type { StaffSessionStore } from "../auth/session-store";
import { apiFailure } from "../http/api-failure";
import type { ControlPlaneDirectory } from "./control-plane-directory";
import { presentManagementReturnsAttention } from "./handle-management-returns-attention";
import { loadManagementAuthority } from "./management-authority";

export type ManagementReturnDetailView = {
  readonly returnId: Uuid;
  readonly saleId: string;
  readonly saleReference?: string;
  readonly locationId: string;
  readonly locationName?: string;
  readonly registerId: string;
  readonly registerName?: string;
  readonly persistedStatus: StoredReturnRecord["status"];
  readonly statusLabel: string;
  readonly refundTotal: Money;
  readonly previewExpiresAt: string;
  readonly previewState?: "current" | "expired" | "unavailable";
  readonly executed: boolean;
  readonly approvalState?: "required" | "recorded";
  readonly canApprove: boolean;
  readonly actionUnavailableReason?: string;
  readonly namesAvailable: boolean;
  readonly lines: readonly {
    readonly orderLineId: string;
    readonly name?: string;
    readonly quantity: string;
    readonly reason: string;
    readonly condition: ReturnCondition;
    readonly intendedDisposition: StockDisposition;
    readonly allocatedAmount: Money;
  }[];
  readonly effects: readonly {
    readonly kind: "cash_refund" | "provider_refund" | "commercial_refund" | "stock_disposition";
    readonly label: string;
    readonly effectId: Uuid;
    readonly status: string;
    readonly amount?: Money;
    readonly message?: string;
  }[];
};

/**
 * Exact persisted return detail. All dependencies expose reads only: opening
 * this view cannot resolve a provider, execute a return or alter stock/audit.
 */
export async function handleGetManagementReturnDetail(input: {
  readonly correlationId: Uuid;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly returns: Pick<ReturnStore, "getReturn" | "getApprovalForReturn">;
  readonly sales?: Pick<CheckoutStore, "getSale">;
  readonly returnId: string;
}): Promise<ApiResult<ManagementReturnDetailView>> {
  const authority = await loadManagementAuthority(input);
  if (!authority.ok) return authority;
  if (!authority.data.sections.includes("returns_approvals")) {
    return authFailure("FORBIDDEN", "returns and approvals are outside management authority", input.correlationId);
  }
  if (!isUuid(input.returnId)) {
    return authFailure("VALIDATION_ERROR", "return id is invalid", input.correlationId);
  }

  let stored: StoredReturnRecord | undefined;
  try {
    stored = await input.returns.getReturn(input.returnId);
  } catch {
    return authFailure("INTEGRATION_UNAVAILABLE", "return details are unavailable", input.correlationId);
  }
  if (!stored || stored.organizationId !== authority.data.organizationId) {
    return apiFailure("NOT_FOUND", "return was not found", input.correlationId);
  }
  const organizationWide = authority.data.controlRole === "owner" || authority.data.controlRole === "admin";
  const isLocationManager = authority.data.managerLocationIds.includes(stored.locationId);
  if (!organizationWide && !isLocationManager) {
    return authFailure("FORBIDDEN", "return location is outside management authority", input.correlationId);
  }

  let approvalRecorded = false;
  if (stored.status === "approval_required") {
    try {
      const approval = await input.returns.getApprovalForReturn(stored.returnId, stored.fingerprint);
      approvalRecorded = Boolean(approval
        && approval.organizationId === stored.organizationId
        && approval.locationId === stored.locationId
        && approval.returnId === stored.returnId
        && approval.fingerprint === stored.fingerprint
        && Date.parse(approval.expiresAt) > input.now.getTime());
    } catch {
      return authFailure("INTEGRATION_UNAVAILABLE", "return approval details are unavailable", input.correlationId);
    }
  }
  const presentation = presentManagementReturnsAttention({
    id: `return:${stored.returnId}`,
    category: "return",
    priority: "informational",
    intervention: "informational",
    organizationId: stored.organizationId,
    locationId: stored.locationId,
    returnId: stored.returnId,
    persistedStatus: stored.status,
    statusLabel: RETURN_STATUS_LABELS[stored.status],
    summary: "Saved return details.",
    nextAction: "Review the existing return.",
    previewExpiresAt: stored.previewExpiresAt,
    ...(stored.status === "approval_required" ? { approvalState: approvalRecorded ? "recorded" as const : "required" as const } : {}),
    updatedAt: input.now.toISOString(),
  }, input.now, isLocationManager);

  // Names are optional persisted sale presentation. Their absence must not
  // hide the return or fall back to a mutable/current product catalogue.
  let sale: PosSaleRecord | undefined;
  if (input.sales) {
    try {
      const candidate = await input.sales.getSale(stored.transactionId);
      if (candidate?.organizationId === stored.organizationId
        && candidate.locationId === stored.locationId
        && candidate.registerId === stored.registerId
        && candidate.prepared.saleId === stored.saleId) sale = candidate;
    } catch {
      sale = undefined;
    }
  }
  const names = new Map<string, string>();
  if (sale?.orderLines?.length === sale?.lines.length) {
    sale?.orderLines?.forEach((line, index) => {
      const name = sale.lines[index]?.name;
      if (name) names.set(line.orderLineId, name);
    });
  }
  const lines = stored.requestedLines.map((line) => ({
    orderLineId: line.orderLineId,
    ...(names.has(line.orderLineId) ? { name: names.get(line.orderLineId) } : {}),
    quantity: line.quantity,
    reason: line.reason,
    condition: line.condition,
    intendedDisposition: line.intendedDisposition,
    allocatedAmount: { ...line.allocatedHistoricAmount },
  }));

  return {
    ok: true,
    correlationId: input.correlationId,
    data: {
      returnId: stored.returnId,
      saleId: stored.saleId,
      ...(sale ? { saleReference: sale.prepared.orderReference, locationName: sale.locationName, registerName: sale.registerName } : {}),
      locationId: stored.locationId,
      registerId: stored.registerId,
      persistedStatus: stored.status,
      statusLabel: presentation.statusLabel,
      refundTotal: { ...stored.refundTotal },
      previewExpiresAt: stored.previewExpiresAt,
      ...(presentation.previewState ? { previewState: presentation.previewState } : {}),
      executed: Boolean(stored.executeClaimedAt),
      ...(presentation.approvalState ? { approvalState: presentation.approvalState } : {}),
      canApprove: Boolean(presentation.canApprove),
      ...(presentation.actionUnavailableReason ? { actionUnavailableReason: presentation.actionUnavailableReason } : {}),
      namesAvailable: lines.every((line) => Boolean(line.name)),
      lines,
      effects: effectsFromRecord(stored),
    },
  };
}

const RETURN_STATUS_LABELS: Record<StoredReturnRecord["status"], string> = {
  previewed: "Return preview",
  approval_required: "Approval required",
  refund_pending: "Refund pending",
  in_progress: "Return in progress",
  completed: "Return completed",
  requires_attention: "Return needs attention",
};

function effectsFromRecord(stored: StoredReturnRecord): ManagementReturnDetailView["effects"] {
  const effects: Array<ManagementReturnDetailView["effects"][number]> = [];
  for (const [kind, label, refund] of [
    ["cash_refund", "Cash refund", stored.cashRefund],
    ["provider_refund", "Payment refund", stored.providerRefund],
  ] as const) {
    if (refund && effectMatchesReturn(refund, stored)) effects.push({
      kind, label, effectId: refund.refundId, status: refund.status,
      amount: { ...refund.amount }, ...(refund.attentionReason ? { message: refund.attentionReason } : {}),
    });
  }
  if (stored.commercialRefund && effectMatchesReturn(stored.commercialRefund, stored)) effects.push({
    kind: "commercial_refund", label: "Order refund record",
    effectId: stored.commercialRefund.commercialRefundId, status: stored.commercialRefund.status,
    amount: { ...stored.commercialRefund.amount },
    ...(stored.commercialRefund.message ? { message: stored.commercialRefund.message } : {}),
  });
  if (stored.stockDisposition && effectMatchesReturn(stored.stockDisposition, stored)) effects.push({
    kind: "stock_disposition", label: "Stock handling",
    effectId: stored.stockDisposition.stockDispositionId, status: stored.stockDisposition.status,
    ...(stored.stockDisposition.message ? { message: stored.stockDisposition.message } : {}),
  });
  return effects;
}

function effectMatchesReturn(
  effect: { readonly organizationId: string; readonly locationId: string; readonly returnId: string; readonly transactionId: string },
  stored: StoredReturnRecord,
): boolean {
  return effect.organizationId === stored.organizationId
    && effect.locationId === stored.locationId
    && effect.returnId === stored.returnId
    && effect.transactionId === stored.transactionId;
}
