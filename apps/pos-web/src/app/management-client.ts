"use client";

import type { ApiResult } from "../../../../docs/contracts/ports";
import type { ManagementContext } from "../server/admin/management-context";
import type { StaffAccessRecord } from "../server/admin/staff-access-directory";
import type { OperationalPolicyView } from "../server/admin/handle-operational-policy";
import type { ManagementLocation } from "../server/admin/management-topology-directory";
import type { ManagementShiftCashView } from "../server/admin/management-shift-cash-directory";
import type { ManagementReturnsAttentionView } from "../server/admin/management-returns-attention-directory";
import type { ManagementReturnDetailView } from "../server/admin/handle-management-return-detail";
import type { ManagementReceiptSettingsView } from "../server/admin/handle-management-receipt-settings";
import type { ManagementSystemHealthView } from "../server/admin/management-system-health";
import type { ManagementAuditView } from "../server/admin/management-audit";
import type { ManagementSaleRecoveryView } from "../server/admin/management-sale-recovery";
import type { PreparedSale, ReceiptSettings, RefundState, ReturnApprovalBinding, ShiftReport } from "../../../../docs/contracts/domain.generated";
import type { ReceiptSettingsOverride, ReceiptSettingsScope } from "../core/receipt/settings-override";
import type { CashCorrectionResult, ManagementCashMovement } from "../server/admin/cash-correction-admin-store";
import type { StaffAssignmentMutationResult } from "../server/admin/staff-assignment-admin-store";
import type { ControlMembershipMutationResult } from "../server/admin/control-membership-admin-store";
import type { StaffAccessStatusMutationResult } from "../server/admin/staff-access-status-admin-store";
import type { StaffInviteResult } from "../server/admin/handle-invite-staff";
import type { ShiftClosePolicyOverride } from "../server/auth/policy";
import { STAFF_CSRF_COOKIE, STAFF_CSRF_HEADER } from "../config/auth";

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return "";
}

async function jsonResult<T>(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<ApiResult<T>> {
  const correlationId = crypto.randomUUID();
  const mutation = !["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase());
  const controller = new AbortController();
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    stop = () => {
      controller.abort();
      reject(new Error("Management request interrupted"));
    };
    // Cover both the request and response body. Some fetch implementations do
    // not settle when aborted, so abort alone cannot release the saving state.
    deadline = setTimeout(stop, mutation ? 45_000 : 20_000);
    if (init.signal?.aborted) stop();
    else init.signal?.addEventListener("abort", stop, { once: true });
  });
  try {
    const headers = new Headers(init.headers);
    headers.set("x-correlation-id", correlationId);
    return await Promise.race([
      (async () => {
        const response = await fetchImpl(url, {
          credentials: "include",
          ...init,
          headers,
          signal: controller.signal,
        });
        const value: unknown = await response.json();
        if (!isManagementEnvelope(value)) throw new Error("Invalid management response");
        return value as ApiResult<T>;
      })(),
      interrupted,
    ]);
  } catch {
    return {
      ok: false,
      error: {
        code: "INTEGRATION_UNAVAILABLE",
        message: mutation
          ? "The change could not be confirmed. Refresh this section to check its status before trying again."
          : "Management could not be loaded. Refresh this section to try again.",
        retryable: !mutation,
        nextAction: "resolve",
      },
      correlationId,
    };
  } finally {
    clearTimeout(deadline);
    if (stop) init.signal?.removeEventListener("abort", stop);
  }
}

function isManagementEnvelope(value: unknown): value is ApiResult<unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.ok !== "boolean" || typeof row.correlationId !== "string") return false;
  if (row.ok) return row.data !== null && typeof row.data === "object";
  if (!row.error || typeof row.error !== "object" || Array.isArray(row.error)) return false;
  const error = row.error as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
}

export function fetchManagementContext(fetchImpl: typeof fetch = fetch) {
  return jsonResult<ManagementContext>(fetchImpl, "/api/pos/v1/admin/context");
}

export function fetchStaffAccess(fetchImpl: typeof fetch = fetch) {
  return jsonResult<readonly StaffAccessRecord[]>(fetchImpl, "/api/pos/v1/admin/staff");
}

export function fetchOperationalPolicy(
  input: { readonly locationId?: string; readonly registerId?: string },
  fetchImpl: typeof fetch = fetch,
) {
  const params = new URLSearchParams();
  if (input.locationId) params.set("locationId", input.locationId);
  if (input.registerId) params.set("registerId", input.registerId);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return jsonResult<OperationalPolicyView>(fetchImpl, `/api/pos/v1/admin/policy${query}`);
}

export function updateOperationalPolicy(
  input: {
    readonly scope: { readonly locationId?: string; readonly registerId?: string };
    readonly override: ShiftClosePolicyOverride;
  },
  fetchImpl: typeof fetch = fetch,
) {
  const params = new URLSearchParams();
  if (input.scope.locationId) params.set("locationId", input.scope.locationId);
  if (input.scope.registerId) params.set("registerId", input.scope.registerId);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return jsonResult<OperationalPolicyView>(
    fetchImpl,
    `/api/pos/v1/admin/policy${query}`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
      },
      body: JSON.stringify(input.override),
    },
  );
}


export function fetchManagementTopology(fetchImpl: typeof fetch = fetch) {
  return jsonResult<readonly ManagementLocation[]>(fetchImpl, "/api/pos/v1/admin/topology");
}

export function fetchManagementShiftsCash(fetchImpl: typeof fetch = fetch) {
  return jsonResult<ManagementShiftCashView>(fetchImpl, "/api/pos/v1/admin/shifts-cash");
}

export function fetchManagementReturnsAttention(fetchImpl: typeof fetch = fetch) {
  return jsonResult<ManagementReturnsAttentionView>(fetchImpl, "/api/pos/v1/admin/returns-attention");
}

export function fetchManagementReturnDetail(returnId: string, fetchImpl: typeof fetch = fetch) {
  return jsonResult<ManagementReturnDetailView>(fetchImpl, `/api/pos/v1/admin/returns/${encodeURIComponent(returnId)}`);
}

export function fetchManagementSaleRecovery(transactionId: string, fetchImpl: typeof fetch = fetch) {
  return jsonResult<ManagementSaleRecoveryView>(fetchImpl, `/api/pos/v1/admin/sales/${encodeURIComponent(transactionId)}/recovery`);
}

export function repairManagementSale(transactionId: string, fetchImpl: typeof fetch = fetch) {
  return jsonResult<PreparedSale>(fetchImpl, `/api/pos/v1/admin/sales/${encodeURIComponent(transactionId)}/recovery`, {
    method: "POST",
    headers: { [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE) },
  });
}

export function fetchManagementSystemHealth(fetchImpl: typeof fetch = fetch) {
  return jsonResult<ManagementSystemHealthView>(fetchImpl, "/api/pos/v1/admin/system-health");
}

export function fetchManagementAudit(fetchImpl: typeof fetch = fetch) {
  return jsonResult<ManagementAuditView>(fetchImpl, "/api/pos/v1/admin/audit");
}

export async function fetchManagementReceiptSettings(
  scope: string | { readonly scope: ReceiptSettingsScope; readonly locationId?: string },
  fetchImpl: typeof fetch = fetch,
) {
  const params = new URLSearchParams(typeof scope === "string" ? { locationId: scope } : {
    scope: scope.scope,
    ...(scope.locationId ? { locationId: scope.locationId } : {}),
  });
  const result = await jsonResult<ManagementReceiptSettingsView>(
    fetchImpl,
    `/api/pos/v1/admin/receipt-settings?${params.toString()}`,
  );
  return checkedReceiptScope(result, typeof scope === "string" ? { scope: "location", locationId: scope } : scope);
}

export type ManagementReceiptSettingsChange =
  | { readonly locationId: string; readonly settings: ReceiptSettings }
  | { readonly scope: "organization"; readonly settings: ReceiptSettings }
  | { readonly scope: "location"; readonly locationId: string; readonly overrides: ReceiptSettingsOverride }
  | { readonly scope: "organization"; readonly action: "apply_shared" };

export async function updateManagementReceiptSettings(
  input: ManagementReceiptSettingsChange,
  fetchImpl: typeof fetch = fetch,
) {
  const result = await jsonResult<ManagementReceiptSettingsView>(
    fetchImpl,
    "/api/pos/v1/admin/receipt-settings",
    {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
      },
      body: JSON.stringify(input),
    },
  );
  return checkedReceiptScope(result, "scope" in input ? input : { scope: "location", locationId: input.locationId });
}

function checkedReceiptScope(
  result: ApiResult<ManagementReceiptSettingsView>,
  expected: { readonly scope: ReceiptSettingsScope; readonly locationId?: string },
): ApiResult<ManagementReceiptSettingsView> {
  if (!result.ok) return result;
  const view = result.data;
  if (view && (expected.scope === "organization"
    ? view.scope === "organization" && view.locationId === ""
    : view.locationId === expected.locationId && (view.scope === "location" || view.scope === undefined))) return result;
  return {
    ok: false,
    error: { code: "INTEGRATION_UNAVAILABLE", message: "Receipt settings returned another scope. Reload settings before making changes.", retryable: false, nextAction: "resolve" },
    correlationId: result.correlationId,
  };
}

export function updateStaffAssignment(
  input: {
    readonly actorId: string;
    readonly locationId: string;
    readonly role: "cashier" | "manager";
    readonly registerIds: readonly string[];
  },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<StaffAssignmentMutationResult>(
    fetchImpl,
    `/api/pos/v1/admin/staff/${encodeURIComponent(input.actorId)}/assignment`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
      },
      body: JSON.stringify({
        locationId: input.locationId,
        role: input.role,
        registerIds: input.registerIds,
      }),
    },
  );
}


export function updateControlMembership(
  input: {
    readonly actorId: string;
    readonly controlRole: "owner" | "admin" | "support";
    readonly status: "active" | "disabled";
  },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<ControlMembershipMutationResult>(
    fetchImpl,
    `/api/pos/v1/admin/staff/${encodeURIComponent(input.actorId)}/control-membership`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
      },
      body: JSON.stringify({
        controlRole: input.controlRole,
        status: input.status,
      }),
    },
  );
}


export function updateStaffAccessStatus(
  input: {
    readonly actorId: string;
    readonly status: "active" | "disabled";
    readonly reason?: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<StaffAccessStatusMutationResult>(
    fetchImpl,
    `/api/pos/v1/admin/staff/${encodeURIComponent(input.actorId)}/access-status`,
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
      },
      body: JSON.stringify({
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    },
  );
}


export function resetStaffTemporaryPassword(
  input: { readonly actorId: string; readonly temporaryPassword: string },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<{ readonly mustChangePassword: true }>(
    fetchImpl,
    `/api/pos/v1/admin/staff/${encodeURIComponent(input.actorId)}/password`,
    {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ temporaryPassword: input.temporaryPassword }),
    },
  );
}

export function createStaffAccount(
  input: {
    readonly email: string;
    readonly displayName: string;
    readonly temporaryPassword: string;
    readonly controlRole: "owner" | "admin" | "support" | null;
    readonly locations: readonly {
      readonly locationId: string;
      readonly role: "cashier" | "manager";
      readonly registerIds: readonly string[];
    }[];
    readonly enableAccess: boolean;
  },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<{
    readonly actorId: string;
    readonly setupStatus: "complete" | "incomplete";
    readonly posAccessStatus: "active" | "disabled";
  }>(
    fetchImpl,
    "/api/pos/v1/admin/staff/create",
    {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(input),
    },
  );
}

export function saveTopology(
  change: {
    readonly kind: "location" | "register" | "device";
    readonly locationId?: string;
    readonly registerId?: string;
    readonly deviceId?: string;
    readonly name?: string;
    readonly label?: string;
    readonly currency?: string;
    readonly status: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<{ readonly id: string }>(
    fetchImpl,
    "/api/pos/v1/admin/topology",
    {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify(change),
    },
  );
}

export function inviteStaff(
  input: {
    readonly email: string;
    readonly displayName: string;
  },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<StaffInviteResult>(
    fetchImpl,
    "/api/pos/v1/admin/staff/invite",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
      },
      body: JSON.stringify(input),
    },
  );
}

function mutationHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
  };
}

export function approveManagementReturn(returnId: string, fetchImpl: typeof fetch = fetch) {
  return jsonResult<ReturnApprovalBinding>(
    fetchImpl,
    `/api/pos/v1/admin/returns/${encodeURIComponent(returnId)}/approve`,
    { method: "POST", headers: mutationHeaders() },
  );
}

export function reconcileManagementRefund(refundId: string, fetchImpl: typeof fetch = fetch) {
  return jsonResult<RefundState>(
    fetchImpl,
    `/api/pos/v1/admin/refunds/${encodeURIComponent(refundId)}/reconcile`,
    { method: "POST", headers: mutationHeaders() },
  );
}

export function fetchManagementShiftReport(
  shiftId: string,
  kind: "X" | "Z",
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<ShiftReport>(
    fetchImpl,
    `/api/pos/v1/admin/shifts/${encodeURIComponent(shiftId)}/report?kind=${kind}`,
  );
}

export function fetchManagementCashMovements(shiftId: string, fetchImpl: typeof fetch = fetch) {
  return jsonResult<readonly ManagementCashMovement[]>(
    fetchImpl,
    `/api/pos/v1/admin/shifts/${encodeURIComponent(shiftId)}/movements`,
  );
}

export function reverseManagementCashMovement(
  input: { readonly shiftId: string; readonly movementId: string; readonly reason: string },
  fetchImpl: typeof fetch = fetch,
) {
  return jsonResult<CashCorrectionResult>(
    fetchImpl,
    `/api/pos/v1/admin/shifts/${encodeURIComponent(input.shiftId)}/corrections`,
    {
      method: "POST",
      headers: mutationHeaders(),
      body: JSON.stringify({ movementId: input.movementId, reason: input.reason }),
    },
  );
}
