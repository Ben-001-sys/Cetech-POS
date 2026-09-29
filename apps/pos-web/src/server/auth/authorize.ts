import type { ApiResult, ApiSuccess } from "../../../../../docs/contracts/ports";
import type { Session, Uuid } from "../../../../../docs/contracts/domain.generated";
import { roleAtLocation, type StaffAssignmentDirectory } from "./assignments";
import { toSession, type StaffIdentityClaims } from "./claims";
import { assertMutationProtection, type MutationProtectionInput } from "./csrf";
import { authFailure } from "./errors";
import type { IdentityVerifyResult } from "./identity-verifier";
import {
  assignmentRolePermits,
  isStaffPermission,
  type StaffAssignmentRole,
  type StaffPermission,
} from "./roles";

export type AuthorizedStaffContext = {
  readonly session: Session;
  readonly identity: StaffIdentityClaims;
  readonly assignmentRole?: StaffAssignmentRole;
  readonly locationId?: string;
  readonly registerId?: string;
};

export type ClientScopeClaim = {
  readonly actorId?: string;
  readonly organizationId?: string;
  readonly locationId?: string;
  readonly registerId?: string;
  readonly capabilities?: readonly string[];
  readonly role?: string;
  readonly customerId?: string;
};

type AuthorizeStaffShared = {
  readonly verifyResult: IdentityVerifyResult;
  readonly assignments: StaffAssignmentDirectory;
  readonly correlationId: Uuid;
  readonly required: {
    readonly organizationId: string;
    readonly locationId?: string;
    readonly registerId?: string;
    /** Server permission. Never taken from client/JWT capabilities. */
    readonly permission?: StaffPermission;
  };
  readonly client?: ClientScopeClaim;
};

export type AuthorizeStaffReadInput = AuthorizeStaffShared & {
  readonly kind: "read";
};

export type AuthorizeStaffMutationInput = AuthorizeStaffShared & {
  readonly kind: "mutation";
  readonly protection: MutationProtectionInput;
};

export type AuthorizeStaffActionInput = AuthorizeStaffReadInput | AuthorizeStaffMutationInput;

export async function authorizeStaffRead(
  input: Omit<AuthorizeStaffReadInput, "kind">,
): Promise<ApiResult<AuthorizedStaffContext>> {
  return authorizeStaffAction({ ...input, kind: "read" });
}

export async function authorizeStaffMutation(
  input: Omit<AuthorizeStaffMutationInput, "kind" | "protection">,
  protection: MutationProtectionInput,
): Promise<ApiResult<AuthorizedStaffContext>> {
  return authorizeStaffAction({ ...input, kind: "mutation", protection });
}

export async function authorizeStaffAction(
  input: AuthorizeStaffActionInput,
): Promise<ApiResult<AuthorizedStaffContext>> {
  const { correlationId } = input;
  if (!input.verifyResult.ok) {
    return identityFailure(input.verifyResult.reason, correlationId);
  }

  if (input.kind === "mutation") {
    const protection = (input as { readonly protection?: MutationProtectionInput }).protection;
    if (!protection) {
      return authFailure("FORBIDDEN", "mutation requires CSRF and origin protection", correlationId);
    }
    const result = assertMutationProtection(protection);
    if (!result.ok) {
      return authFailure(
        "FORBIDDEN",
        result.reason === "csrf"
          ? "mutation requires matching CSRF cookie and header"
          : "mutation origin is not allowed",
        correlationId,
      );
    }
  }

  const identity = input.verifyResult.identity;
  if (isIdentitySpoofed(identity, input.client)) {
    return authFailure("FORBIDDEN", "client-supplied actor or organization does not match verified identity", correlationId);
  }
  if (input.client?.customerId) {
    return authFailure("FORBIDDEN", "buyer customer context is not staff identity", correlationId);
  }

  if (identity.organizationId !== input.required.organizationId) {
    return authFailure("FORBIDDEN", "organization is out of staff scope", correlationId);
  }

  const assignments = await input.assignments.lookup({
    actorId: identity.actorId,
    organizationId: identity.organizationId,
  });
  if (assignments === "unavailable") {
    return authFailure("INTEGRATION_UNAVAILABLE", "staff assignment directory is unavailable", correlationId, {
      field: "assignments",
    });
  }

  const locationId = input.required.locationId;
  if (locationId && !assignments.locationIds.includes(locationId)) {
    return authFailure("FORBIDDEN", "location is out of staff scope", correlationId);
  }
  if (
    input.client?.locationId !== undefined &&
    (!assignments.locationIds.includes(input.client.locationId) ||
      (locationId !== undefined && input.client.locationId !== locationId))
  ) {
    return authFailure("FORBIDDEN", "client-supplied location is not staff assignment authority", correlationId);
  }

  const registerId = input.required.registerId;
  if (registerId && !assignments.registerIds.includes(registerId)) {
    return authFailure("FORBIDDEN", "register is not assigned to this staff session", correlationId);
  }
  if (registerId && locationId) {
    const registerLocationProven = assignments.registerAssignments
      ? assignments.registerAssignments.some(
          (assignment) =>
            assignment.registerId === registerId &&
            assignment.locationId === locationId,
        )
      : assignments.locationIds.length === 1 &&
        assignments.locationIds[0] === locationId;
    if (!registerLocationProven) {
      return authFailure(
        "FORBIDDEN",
        "register is not assigned at this staff location",
        correlationId,
      );
    }
  }
  if (
    input.client?.registerId !== undefined &&
    (!assignments.registerIds.includes(input.client.registerId) ||
      (registerId !== undefined && input.client.registerId !== registerId))
  ) {
    return authFailure("FORBIDDEN", "client-supplied register is not staff assignment authority", correlationId);
  }

  let assignmentRole: StaffAssignmentRole | undefined;
  if (locationId) {
    assignmentRole = roleAtLocation(assignments, locationId) ?? undefined;
  }

  if (input.client?.role !== undefined) {
    if (!assignmentRole || input.client.role !== assignmentRole) {
      return authFailure("FORBIDDEN", "client-supplied role is not staff assignment authority", correlationId);
    }
  }

  if (input.required.permission) {
    if (!isStaffPermission(input.required.permission)) {
      return authFailure("FORBIDDEN", "staff is not permitted to perform this action", correlationId);
    }
    if (!locationId || !assignmentRole) {
      return authFailure("FORBIDDEN", "staff assignment role requires a location", correlationId);
    }
    if (!assignmentRolePermits(assignmentRole, input.required.permission)) {
      return authFailure("FORBIDDEN", "staff is not permitted to perform this action", correlationId);
    }
  }

  const session = {
    ...toSession(identity),
    locationIds: [...assignments.locationIds],
  };
  const success: ApiSuccess<AuthorizedStaffContext> = {
    ok: true,
    data: {
      session,
      identity,
      ...(assignmentRole ? { assignmentRole } : {}),
      ...(locationId ? { locationId } : {}),
      ...(registerId ? { registerId } : {}),
    },
    correlationId,
  };
  return success;
}

function identityFailure(
  reason: Exclude<IdentityVerifyResult, { ok: true }>["reason"],
  correlationId: Uuid,
) {
  switch (reason) {
    case "anonymous":
      return authFailure("AUTH_REQUIRED", "anonymous requests are denied", correlationId);
    case "expired":
      return authFailure("AUTH_REQUIRED", "session is expired", correlationId, { field: "session" });
    case "revoked":
      return authFailure("AUTH_REQUIRED", "identity verification was revoked", correlationId, { field: "session" });
    case "access_disabled":
      return authFailure("FORBIDDEN", "staff pos access is disabled", correlationId, { field: "pos_access" });
    case "malformed":
      return authFailure("AUTH_REQUIRED", "identity claims are malformed", correlationId);
    case "timeout":
    case "unavailable":
    case "transport":
      return authFailure("INTEGRATION_UNAVAILABLE", "identity provider is unavailable", correlationId);
    case "rejected":
      return authFailure("AUTH_REQUIRED", "staff session could not be established", correlationId);
  }
}

function isIdentitySpoofed(
  identity: StaffIdentityClaims,
  client: ClientScopeClaim | undefined,
): boolean {
  if (!client) {
    return false;
  }
  if (client.actorId !== undefined && client.actorId !== identity.actorId) {
    return true;
  }
  if (client.organizationId !== undefined && client.organizationId !== identity.organizationId) {
    return true;
  }
  return false;
}
