import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { ReceiptSettings, Uuid } from "../../../../../docs/contracts/domain.generated";
import type { MutationProtectionInput } from "../auth/csrf";
import { assertMutationProtection } from "../auth/csrf";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import { authFailure } from "../auth/errors";
import type { StaffSessionStore } from "../auth/session-store";
import { isReceiptSettings } from "../../core/receipt/settings";
import { isReceiptSettingsOverride, type ReceiptSettingsOverride, type ReceiptSettingsScope } from "../../core/receipt/settings-override";
import type { ControlPlaneDirectory } from "./control-plane-directory";
import { loadManagementAuthority } from "./management-authority";
import type { ReceiptSettingsAdminStore, ReceiptSettingsRead } from "./receipt-settings-admin-store";

const LOCATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export type ManagementReceiptSettingsView = {
  readonly locationId: string;
  readonly locationName?: string;
  readonly settings: ReceiptSettings;
  readonly persisted: boolean;
  readonly canManage: boolean;
  readonly scope?: ReceiptSettingsScope;
  readonly defaults?: ReceiptSettings;
  readonly overrides?: ReceiptSettingsOverride;
  readonly legacyOverride?: boolean;
  readonly affectedLocationCount?: number;
};

type Common = {
  readonly correlationId: Uuid;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly receiptSettings: ReceiptSettingsAdminStore;
  readonly locationId?: string;
  readonly scope?: string;
};

export async function handleGetManagementReceiptSettings(
  input: Common,
): Promise<ApiResult<ManagementReceiptSettingsView>> {
  const authority = await loadManagementAuthority(input);
  if (!authority.ok) return authority;
  if (!authority.data.sections.includes("receipt_settings")) {
    return authFailure(
      "FORBIDDEN",
      "receipt settings are outside management authority",
      input.correlationId,
    );
  }

  const organizationWide =
    authority.data.controlRole === "owner" || authority.data.controlRole === "admin";
  const scope = input.scope ?? "location";
  if (scope !== "organization" && scope !== "location") return authFailure("VALIDATION_ERROR", "receipt settings scope is invalid", input.correlationId);
  if (scope === "organization" && !organizationWide) return authFailure("FORBIDDEN", "organization admin authority is required to view shared receipt settings", input.correlationId);
  const locationId = input.locationId?.trim() ?? "";
  if (scope === "location" && (!locationId || !LOCATION_ID.test(locationId))) {
    return authFailure("VALIDATION_ERROR", "location is required", input.correlationId);
  }
  if (!organizationWide && !authority.data.managerLocationIds.includes(locationId)) {
    return authFailure(
      "FORBIDDEN",
      "location is outside receipt settings authority",
      input.correlationId,
    );
  }

  const read = await input.receiptSettings.read({
    organizationId: authority.data.organizationId,
    locationId,
    scope,
  });
  return viewResult(read, organizationWide, input.correlationId);
}

export async function handleSetManagementReceiptSettings(
  input: Common & {
    readonly protection: MutationProtectionInput;
    readonly settings: unknown;
    readonly overrides?: unknown;
    readonly action?: string;
  },
): Promise<ApiResult<ManagementReceiptSettingsView>> {
  const protection = assertMutationProtection(input.protection);
  if (!protection.ok) {
    return authFailure(
      "FORBIDDEN",
      protection.reason === "csrf"
        ? "mutation requires matching CSRF cookie and header"
        : "mutation origin is not allowed",
      input.correlationId,
    );
  }

  const authority = await loadManagementAuthority(input);
  if (!authority.ok) return authority;
  if (authority.data.controlRole !== "owner" && authority.data.controlRole !== "admin") {
    return authFailure(
      "FORBIDDEN",
      "organization admin authority is required to change receipt settings",
      input.correlationId,
    );
  }
  if (!authority.data.sections.includes("receipt_settings")) {
    return authFailure(
      "FORBIDDEN",
      "receipt settings are outside management authority",
      input.correlationId,
    );
  }

  const scope = input.scope ?? "location";
  if (scope !== "organization" && scope !== "location") return authFailure("VALIDATION_ERROR", "receipt settings scope is invalid", input.correlationId);
  if (input.action !== undefined) {
    if (input.action !== "apply_shared" || scope !== "organization" || input.settings !== undefined || input.overrides !== undefined) {
      return authFailure("VALIDATION_ERROR", "receipt settings action is invalid", input.correlationId);
    }
    if (!input.receiptSettings.applyShared) return authFailure("INTEGRATION_UNAVAILABLE", "shared receipt settings are unavailable", input.correlationId);
    return viewResult(await input.receiptSettings.applyShared({ organizationId: authority.data.organizationId,
      actorId: authority.data.actorId, correlationId: input.correlationId }), true, input.correlationId);
  }
  const locationId = input.locationId?.trim() ?? "";
  if (scope === "location" && (!locationId || !LOCATION_ID.test(locationId))) {
    return authFailure("VALIDATION_ERROR", "location is required", input.correlationId);
  }
  const sparse = input.overrides !== undefined;
  if (sparse ? scope !== "location" || input.settings !== undefined || !isReceiptSettingsOverride(input.overrides) : !isReceiptSettings(input.settings)) {
    return authFailure("VALIDATION_ERROR", "receipt settings are invalid", input.correlationId);
  }

  const saved = await input.receiptSettings.set({
    organizationId: authority.data.organizationId,
    locationId,
    scope,
    actorId: authority.data.actorId,
    correlationId: input.correlationId,
    ...(sparse ? { overrides: input.overrides as ReceiptSettingsOverride } : { settings: input.settings as ReceiptSettings }),
  });
  return viewResult(saved === "invalid" ? "invalid" : saved, true, input.correlationId);
}

function viewResult(
  read: ReceiptSettingsRead | "missing_location" | "invalid" | "unavailable",
  canManage: boolean,
  correlationId: Uuid,
): ApiResult<ManagementReceiptSettingsView> {
  if (read === "missing_location") {
    return authFailure("VALIDATION_ERROR", "location is not in this organization", correlationId);
  }
  if (read === "invalid") {
    return authFailure("VALIDATION_ERROR", "receipt settings are invalid", correlationId);
  }
  if (read === "unavailable") {
    return authFailure("INTEGRATION_UNAVAILABLE", "receipt settings are unavailable", correlationId);
  }
  return {
    ok: true,
    data: {
      locationId: read.locationId,
      ...(read.locationName ? { locationName: read.locationName } : {}),
      settings: read.settings,
      persisted: read.persisted,
      canManage,
      ...(read.scope === undefined ? {} : { scope: read.scope }),
      ...(read.defaults === undefined ? {} : { defaults: read.defaults }),
      ...(read.overrides === undefined ? {} : { overrides: read.overrides }),
      ...(read.legacyOverride === undefined ? {} : { legacyOverride: read.legacyOverride }),
      ...(read.affectedLocationCount === undefined ? {} : { affectedLocationCount: read.affectedLocationCount }),
    },
    correlationId,
  };
}
