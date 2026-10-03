import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Uuid } from "../../../../../docs/contracts/domain.generated";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import { authFailure } from "../auth/errors";
import type { StaffSessionStore } from "../auth/session-store";
import type { ControlPlaneDirectory } from "./control-plane-directory";
import { loadManagementAuthority } from "./management-authority";
import {
  MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT,
  selectManagementReturnsAttention,
  type ManagementReturnsAttentionDirectory,
  type ManagementReturnsAttentionItem,
  type ManagementReturnsAttentionScope,
  type ManagementReturnsAttentionView,
} from "./management-returns-attention-directory";

const LOCATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type { ManagementReturnsAttentionView };

export async function handleGetManagementReturnsAttention(input: {
  readonly correlationId: Uuid;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly returnsAttention: ManagementReturnsAttentionDirectory;
  readonly locationId?: string;
}): Promise<ApiResult<ManagementReturnsAttentionView>> {
  const authority = await loadManagementAuthority(input);
  if (!authority.ok) return authority;
  if (!authority.data.sections.includes("returns_approvals")) {
    return authFailure(
      "FORBIDDEN",
      "returns and approvals are outside management authority",
      input.correlationId,
    );
  }

  const locationId = input.locationId?.trim() || undefined;
  if (locationId && !LOCATION_ID.test(locationId)) {
    return authFailure("VALIDATION_ERROR", "location filter is invalid", input.correlationId);
  }

  const organizationWide =
    authority.data.controlRole === "owner" || authority.data.controlRole === "admin";
  if (
    locationId &&
    !organizationWide &&
    !authority.data.managerLocationIds.includes(locationId)
  ) {
    return authFailure(
      "FORBIDDEN",
      "location is outside returns and approvals authority",
      input.correlationId,
    );
  }

  const locationIds = organizationWide
    ? locationId
      ? [locationId]
      : undefined
    : locationId
      ? [locationId]
      : authority.data.managerLocationIds;
  const scope: ManagementReturnsAttentionScope = organizationWide && !locationId
    ? { kind: "organization" }
    : { kind: "locations", locationIds: locationIds ?? [] };

  if (locationIds && locationIds.length === 0) {
    return {
      ok: true,
      data: {
        scope,
        limit: MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT,
        truncated: false,
        rows: [],
      },
      correlationId: input.correlationId,
    };
  }

  let listed;
  try {
    listed = await input.returnsAttention.listOrganization({
      organizationId: authority.data.organizationId,
      locationIds,
    });
  } catch {
    return authFailure(
      "INTEGRATION_UNAVAILABLE",
      "returns and approvals are unavailable",
      input.correlationId,
    );
  }
  if (listed === "unavailable") {
    return authFailure(
      "INTEGRATION_UNAVAILABLE",
      "returns and approvals are unavailable",
      input.correlationId,
    );
  }

  const selected = selectManagementReturnsAttention({
    rows: listed.rows.map((row) => presentManagementReturnsAttention(
      row,
      input.now,
      authority.data.managerLocationIds.includes(row.locationId),
    )),
    organizationId: authority.data.organizationId,
    locationIds,
  });
  return {
    ok: true,
    data: {
      scope,
      limit: MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT,
      truncated: listed.truncated || selected.truncated,
      rows: selected.rows,
    },
    correlationId: input.correlationId,
  };
}

/** Presentation of persisted state only. Expiry does not cancel or execute a return. */
export function presentManagementReturnsAttention(
  row: ManagementReturnsAttentionItem,
  now: Date,
  isLocationManager: boolean,
): ManagementReturnsAttentionItem {
  const preview = row.category === "return"
    && (row.persistedStatus === "previewed" || row.persistedStatus === "approval_required");
  const expiry = row.previewExpiresAt ? Date.parse(row.previewExpiresAt) : Number.NaN;
  const previewState = preview
    ? !Number.isFinite(expiry) ? "unavailable" : expiry <= now.getTime() ? "expired" : "current"
    : undefined;
  const canApprove = row.category === "return"
    && row.persistedStatus === "approval_required"
    && row.approvalState === "required"
    && Boolean(row.returnId)
    && previewState === "current"
    && isLocationManager;
  const canReconcile = row.category === "refund_reconciliation"
    && Boolean(row.refundId)
    && isLocationManager
    && (row.persistedStatus === "pending"
      || row.persistedStatus === "failed"
      || row.persistedStatus === "requires_attention");

  let actionUnavailableReason: string | undefined;
  if (previewState === "expired") {
    actionUnavailableReason = "This preview has expired and cannot be approved or completed. Review the original sale again in Returns.";
  } else if (previewState === "unavailable") {
    actionUnavailableReason = "Preview validity could not be confirmed. Review the original sale again in Returns before proceeding.";
  } else if (row.approvalState === "recorded") {
    actionUnavailableReason = "Manager approval is already recorded. The cashier can continue the same return while the preview is valid.";
  } else if (row.approvalState === "required" && !isLocationManager) {
    actionUnavailableReason = "A Manager assignment at this location is required to approve this return. Organization access alone does not grant approval.";
  } else if (row.category === "return" && row.persistedStatus !== "approval_required") {
    actionUnavailableReason = row.persistedStatus === "previewed"
      ? "This is a return preview, not a pending approval. Continue it from the original Returns workflow."
      : row.persistedStatus === "completed"
        ? undefined
        : "This return needs reconciliation, not approval. Review its existing refund and stock records.";
  } else if (row.category === "refund_reconciliation" && !isLocationManager) {
    actionUnavailableReason = "A Manager assignment at this location is required to check the existing refund.";
  }

  return {
    ...row,
    ...(previewState ? { previewState } : {}),
    ...(previewState === "expired" ? {
      priority: "informational" as const,
      intervention: "informational" as const,
      statusLabel: "Return preview expired",
      summary: "This saved preview is no longer valid.",
      nextAction: "Review the original sale again in Returns if a return is still needed.",
    } : previewState === "unavailable" ? {
      priority: "needs_attention" as const,
      statusLabel: "Return preview needs review",
    } : {}),
    canApprove,
    canReconcile,
    canReview: Boolean(row.returnId),
    ...(actionUnavailableReason ? { actionUnavailableReason } : {}),
    ...(!row.returnId ? {
      reviewUnavailableReason: "This work item has no exact return reference. Review the original transaction in Needs attention; do not start another return.",
    } : {}),
  };
}
