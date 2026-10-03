import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import type { PreparedSale } from "../../../../../docs/contracts/domain.generated";
import type { CheckoutStore, StaffActor } from "../../core/checkout/types";
import type { CatalogPresentationLookup } from "../../core/receipt/catalog-presentation";
import { canonicalJson } from "../../local/canonical";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import { assertMutationProtection, type MutationProtectionInput } from "../auth/csrf";
import { authFailure } from "../auth/errors";
import { isUuid } from "../auth/ids";
import type { StaffSessionStore } from "../auth/session-store";
import { apiFailure } from "../http/api-failure";
import { prepareSale } from "../sales/prepare-sale";
import type { AdminAuditStore } from "./admin-audit-store";
import type { ControlPlaneDirectory } from "./control-plane-directory";
import { loadManagementAuthority } from "./management-authority";
import { proveManagementSaleRecovery, type ManagementSaleRecoveryView } from "./management-sale-recovery";
import type { ManagementSaleRecoveryStore } from "./management-sale-recovery-store";

type ManagementRecoveryInput = {
  readonly correlationId: string;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly originals: ManagementSaleRecoveryStore;
  readonly checkoutStore: CheckoutStore;
  readonly salesPort: Pick<SalesPort, "prepare" | "resolve">;
  readonly transactionId: string;
};

async function authorizedOriginal(input: ManagementRecoveryInput) {
  if (!isUuid(input.transactionId) || !isUuid(input.correlationId)) {
    return authFailure("VALIDATION_ERROR", "sale recovery identity is invalid", input.correlationId);
  }
  const authority = await loadManagementAuthority(input);
  if (!authority.ok) return authority;
  const original = await input.originals.getOriginal(authority.data.organizationId, input.transactionId);
  if (original === "unavailable") return apiFailure("INTEGRATION_UNAVAILABLE", "Original sale evidence is unavailable. Keep this sale for review.", input.correlationId);
  if (!original || original.organizationId !== authority.data.organizationId || original.transactionId !== input.transactionId) {
    return apiFailure("NOT_FOUND", "Original sale was not found in your organization.", input.correlationId);
  }
  if (!authority.data.managerLocationIds.includes(original.locationId)) {
    return authFailure("FORBIDDEN", "Operational manager authority is required at the original sale location.", input.correlationId);
  }
  const actor: StaffActor = {
    actorId: authority.data.actorId, displayName: authority.data.displayName,
    organizationId: authority.data.organizationId, locationIds: authority.data.managerLocationIds,
  };
  return { ok: true as const, data: { original, actor }, correlationId: input.correlationId };
}

/** Capability check only: no diagnostics, journal, order or payment writes. */
export async function handleGetManagementSaleRecovery(input: ManagementRecoveryInput): Promise<ApiResult<ManagementSaleRecoveryView>> {
  const started = Date.now();
  const authorized = await authorizedOriginal(input);
  if (!authorized.ok) return authorized;
  const proof = await proveManagementSaleRecovery({
    original: authorized.data.original, store: input.checkoutStore, salesPort: input.salesPort,
    now: () => new Date(input.now.getTime() + Math.max(0, Date.now() - started)),
  });
  return { ok: true, data: "view" in proof ? proof.view : proof, correlationId: input.correlationId };
}

/** Explicit manager action; never creates a new transaction/key or takes payment. */
export async function handleRepairManagementSale(input: ManagementRecoveryInput & {
  readonly protection: MutationProtectionInput;
  readonly audit: AdminAuditStore;
  readonly catalogLookup: CatalogPresentationLookup;
}): Promise<ApiResult<PreparedSale>> {
  const started = Date.now();
  const currentTime = () => new Date(input.now.getTime() + Math.max(0, Date.now() - started));
  const protection = assertMutationProtection(input.protection);
  if (!protection.ok) return authFailure("FORBIDDEN", "Sale repair requires a trusted origin and matching CSRF protection.", input.correlationId);
  const authorized = await authorizedOriginal(input);
  if (!authorized.ok) return authorized;
  const proof = await proveManagementSaleRecovery({
    original: authorized.data.original, store: input.checkoutStore, salesPort: input.salesPort, now: currentTime,
  });
  if (!("view" in proof)) return apiFailure("REQUIRES_ATTENTION", proof.message, input.correlationId);
  // Reauthorize and reread the durable original after network awaits. Neither
  // an old capability response nor a browser-supplied command grants repair.
  const latest = await authorizedOriginal({ ...input, now: currentTime() });
  if (!latest.ok) return latest;
  if (canonicalJson(latest.data.original) !== canonicalJson(authorized.data.original)) {
    return apiFailure("REQUIRES_ATTENTION", "The original sale changed during the check. Check this same sale again.", input.correlationId);
  }
  const auditScope = {
    organizationId: latest.data.actor.organizationId, actorId: latest.data.actor.actorId,
    targetType: "sale", targetId: input.transactionId, locationId: latest.data.original.locationId,
    registerId: latest.data.original.registerId, correlationId: input.correlationId,
  };
  if (await input.audit.append({ ...auditScope, action: "sale.recovery.requested", beforeState: { status: latest.data.original.status }, afterState: { status: "requested", existingOrder: true } }) !== "ok") {
    return apiFailure("INTEGRATION_UNAVAILABLE", "Sale repair could not be recorded. The existing sale was kept and repair was not requested.", input.correlationId);
  }
  let result: ApiResult<PreparedSale>;
  const dispatchAuthority = await authorizedOriginal({ ...input, now: currentTime() });
  if (!dispatchAuthority.ok) result = dispatchAuthority;
  else if (canonicalJson(dispatchAuthority.data.original) !== canonicalJson(latest.data.original)) {
    result = apiFailure("REQUIRES_ATTENTION", "The original sale changed before repair. Check this same sale again.", input.correlationId);
  } else {
    try {
      result = await prepareSale({
        store: input.checkoutStore, salesPort: input.salesPort, catalogLookup: input.catalogLookup,
        actor: dispatchAuthority.data.actor, request: proof.request,
        context: { idempotencyKey: proof.idempotencyKey, correlationId: input.correlationId },
        now: currentTime(), requireOriginalRepair: true,
      });
    } catch {
      result = apiFailure("REQUIRES_ATTENTION", "The repair result is unknown. Check this same sale before taking payment; do not start it again.", input.correlationId);
    }
  }
  const recorded = await input.audit.append({
    ...auditScope, action: "sale.recovery.result",
    afterState: result.ok ? { status: "prepared", saleId: result.data.saleId }
      : { status: "requires_attention", errorCode: result.error.code },
  });
  if (recorded !== "ok") return apiFailure("REQUIRES_ATTENTION", "The repair result could not be recorded. Check this same sale before taking payment; do not start it again.", input.correlationId);
  return result;
}
