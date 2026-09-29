import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Uuid } from "../../../../../docs/contracts/domain.generated";
import { assertMutationProtection, type MutationProtectionInput } from "../auth/csrf";
import { authFailure } from "../auth/errors";
import { apiFailure } from "../http/api-failure";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import type { StaffSessionStore } from "../auth/session-store";
import type { ControlPlaneDirectory } from "./control-plane-directory";
import { loadManagementAuthority } from "./management-authority";
import {
  invitationRedirectFailureMessage,
  resolveStaffInvitationRedirect,
} from "./invitation-redirect";
import type { StaffIdentityAdminStore } from "./staff-identity-admin-store";
import type { StaffAccessStatusAdminStore } from "./staff-access-status-admin-store";
import type { AdminAuditStore } from "./admin-audit-store";

/**
 * Invitation body is email and display name only.
 * `redirectTo`, `redirect_to`, and any other field cannot choose the link destination.
 */
export function readStaffInviteBody(value: unknown): {
  readonly email: string;
  readonly displayName: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  if (typeof root.email !== "string" || typeof root.displayName !== "string") return null;
  return { email: root.email, displayName: root.displayName };
}

export type StaffInviteResult = {
  readonly actorId: string;
  readonly email: string;
  readonly displayName: string;
  readonly posAccessStatus: "disabled";
};

export async function handleInviteStaff(input: {
  readonly correlationId: Uuid;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly identities: StaffIdentityAdminStore;
  readonly accessStatus: StaffAccessStatusAdminStore;
  readonly audit: AdminAuditStore;
  readonly email: string;
  readonly displayName: string;
  readonly protection: MutationProtectionInput;
  /** Process environment. Request fields cannot select the invitation redirect. */
  readonly runtimeEnv?: Readonly<Record<string, string | undefined>>;
}): Promise<ApiResult<StaffInviteResult>> {
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
      "organization owner/admin authority is required to invite staff",
      input.correlationId,
    );
  }

  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return authFailure("VALIDATION_ERROR", "enter a valid staff email address", input.correlationId);
  }
  if (displayName.length < 1 || displayName.length > 128) {
    return authFailure("VALIDATION_ERROR", "staff display name is invalid", input.correlationId);
  }

  const redirect = resolveStaffInvitationRedirect(input.runtimeEnv ?? {});
  if (!redirect.ok) {
    return authFailure(
      "VALIDATION_ERROR",
      invitationRedirectFailureMessage(redirect.reason),
      input.correlationId,
    );
  }

  const invited = await input.identities.invite({
    organizationId: authority.data.organizationId,
    email,
    displayName,
    redirectTo: redirect.redirectTo,
  });
  if (invited === "conflict") {
    return apiFailure(
      "VALIDATION_ERROR",
      "This email already has an account.",
      input.correlationId,
    );
  }
  if (invited === "unavailable") {
    return authFailure(
      "INTEGRATION_UNAVAILABLE",
      "staff invitation could not be completed",
      input.correlationId,
    );
  }

  const disabled = await input.accessStatus.setStatus({
    organizationId: authority.data.organizationId,
    targetActorId: invited.actorId,
    status: "disabled",
    reason: "Invited staff awaiting operational assignment",
    actorId: authority.data.actorId,
    correlationId: input.correlationId,
  });
  if (disabled === "unavailable") {
    await input.identities.suspendAuthUser(invited.authUserId);
    return authFailure(
      "INTEGRATION_UNAVAILABLE",
      "invited staff could not be secured for assignment",
      input.correlationId,
    );
  }

  const audited = await input.audit.append({
    organizationId: authority.data.organizationId,
    actorId: authority.data.actorId,
    action: "staff.identity.invited",
    targetType: "staff_identity",
    targetId: invited.actorId,
    afterState: {
      email: invited.email,
      displayName: invited.displayName,
      posAccessStatus: "disabled",
    },
    correlationId: input.correlationId,
  });
  if (audited === "unavailable") {
    await input.identities.suspendAuthUser(invited.authUserId);
    return authFailure(
      "INTEGRATION_UNAVAILABLE",
      "staff invitation audit could not be committed",
      input.correlationId,
    );
  }

  return {
    ok: true,
    data: {
      actorId: invited.actorId,
      email: invited.email,
      displayName: invited.displayName,
      posAccessStatus: "disabled",
    },
    correlationId: input.correlationId,
  };
}
