import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Uuid } from "../../../../../docs/contracts/domain.generated";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import type { StaffSessionStore } from "../auth/session-store";
import { assertMutationProtection, type MutationProtectionInput } from "../auth/csrf";
import type { ControlPlaneDirectory } from "./control-plane-directory";
import { loadManagementAuthority } from "./management-authority";
import type {
  ManagementLocation,
  ManagementTopologyDirectory,
  SavedDevice,
  SavedLocation,
  SavedRegister,
} from "./management-topology-directory";
import { authFailure } from "../auth/errors";
import { apiFailure } from "../http/api-failure";

export async function handleGetManagementTopology(input: {
  readonly correlationId: Uuid;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly topology: ManagementTopologyDirectory;
}): Promise<ApiResult<readonly ManagementLocation[]>> {
  const authority = await loadManagementAuthority(input);
  if (!authority.ok) return authority;

  const mayRead =
    authority.data.controlRole === "owner" ||
    authority.data.controlRole === "admin" ||
    authority.data.managerLocationIds.length > 0;
  if (!mayRead) {
    return authFailure("FORBIDDEN", "location/register topology is outside management authority", input.correlationId);
  }

  const rows = await input.topology.listOrganization({
    organizationId: authority.data.organizationId,
  });
  if (rows === "unavailable") {
    return authFailure("INTEGRATION_UNAVAILABLE", "management topology is unavailable", input.correlationId);
  }

  const visible =
    authority.data.controlRole === "owner" || authority.data.controlRole === "admin"
      ? rows
      : rows.filter((row) => authority.data.managerLocationIds.includes(row.id));

  return {
    ok: true,
    data: visible,
    correlationId: input.correlationId,
  };
}

export type TopologySaveRequest =
  | {
      readonly kind: "location";
      readonly locationId?: string;
      readonly name: string;
      readonly status: "active" | "inactive";
    }
  | {
      readonly kind: "register";
      readonly registerId?: string;
      readonly locationId: string;
      readonly name: string;
      readonly currency?: string;
      readonly status: "active" | "disabled" | "maintenance";
    }
  | {
      readonly kind: "device";
      readonly deviceId?: string;
      readonly locationId: string;
      readonly label: string;
      readonly status: "active" | "inactive";
    };

export async function handleSaveManagementTopology(input: {
  readonly correlationId: Uuid;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly topology: ManagementTopologyDirectory;
  readonly change: TopologySaveRequest;
  readonly protection: MutationProtectionInput;
}): Promise<ApiResult<SavedLocation | SavedRegister | SavedDevice>> {
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
      "organization owner or admin authority is required to change locations, registers, or devices",
      input.correlationId,
    );
  }

  const shared = {
    organizationId: authority.data.organizationId,
    actorId: authority.data.actorId,
    correlationId: input.correlationId,
  };
  const saved = input.change.kind === "location"
    ? await input.topology.saveLocation({ ...shared, ...input.change })
    : input.change.kind === "register"
      ? await input.topology.saveRegister({ ...shared, ...input.change })
      : await input.topology.saveDevice({ ...shared, ...input.change });

  if (saved === "busy") {
    return apiFailure("SHIFT_CONFLICT", "Close or resolve affected shifts before deactivating, disabling or moving this location, register or device.", input.correlationId);
  }
  if (saved === "inactive-parent") {
    return apiFailure("VALIDATION_ERROR", "Reactivate the location before making this register or device active.", input.correlationId);
  }
  if (saved === "invalid") {
    return apiFailure("VALIDATION_ERROR", "That location, register, or device change is not allowed.", input.correlationId);
  }
  if (saved === "outside") {
    return authFailure("FORBIDDEN", "That location, register, or device is outside this organization.", input.correlationId);
  }
  if (saved === "unavailable") {
    return authFailure("INTEGRATION_UNAVAILABLE", "The change could not be saved.", input.correlationId);
  }
  return { ok: true, data: saved, correlationId: input.correlationId };
}
