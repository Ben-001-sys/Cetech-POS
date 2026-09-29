import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Session, Uuid } from "../../../../../docs/contracts/domain.generated";
import { STAFF_SESSION_COOKIE } from "../../config/auth";
import { toSession } from "./claims";
import {
  csrfClearCookie,
  csrfSetCookie,
  parseCookieHeader,
  sessionClearCookie,
  sessionSetCookie,
} from "./cookies";
import { authFailure } from "./errors";
import type { StaffIdentityVerifier } from "./identity-verifier";
import type { StaffAccessControl } from "./staff-access-control";
import type { StaffSessionStore } from "./session-store";
import {
  diagnosticFromVerifier,
  recordStaffSignInDiagnostic,
  sessionStoreDiagnostic,
} from "../../core/identity/sign-in-diagnostic";

export type EstablishStaffSessionInput = {
  readonly accessToken?: string;
  readonly now: Date;
  readonly verifier: StaffIdentityVerifier;
  readonly accessControl?: StaffAccessControl;
  readonly store: StaffSessionStore;
  readonly correlationId: Uuid;
  readonly secureCookies?: boolean;
};

export type EstablishedStaffSession = {
  readonly session: Session;
  readonly sessionId: string;
  readonly cookies: readonly string[];
};

export type RevokeStaffSessionInput = {
  readonly cookieHeader?: string;
  readonly store: StaffSessionStore;
  readonly now: Date;
  readonly correlationId: Uuid;
  readonly secureCookies?: boolean;
};

export async function establishStaffSession(
  input: EstablishStaffSessionInput,
): Promise<ApiResult<EstablishedStaffSession>> {
  const verifyResult = await input.verifier.verify({
    accessToken: input.accessToken,
    now: input.now,
  });
  if (!verifyResult.ok) {
    const diagnostic = diagnosticFromVerifier({
      correlationId: input.correlationId,
      reason: verifyResult.reason,
    });
    if (diagnostic) recordStaffSignInDiagnostic(diagnostic);
    if (verifyResult.reason === "timeout" || verifyResult.reason === "unavailable" || verifyResult.reason === "transport") {
      return authFailure("INTEGRATION_UNAVAILABLE", "identity provider is unavailable", input.correlationId);
    }
    if (verifyResult.reason === "access_disabled") {
      return authFailure("FORBIDDEN", "staff pos access is disabled", input.correlationId, { field: "pos_access" });
    }
    if (verifyResult.reason === "anonymous") {
      return authFailure("AUTH_REQUIRED", "anonymous requests are denied", input.correlationId);
    }
    if (verifyResult.reason === "expired" || verifyResult.reason === "revoked") {
      return authFailure("AUTH_REQUIRED", "staff session is expired or revoked", input.correlationId, { field: "session" });
    }
    return authFailure("AUTH_REQUIRED", "staff session could not be established", input.correlationId);
  }
  // Canonical disablement is pos_staff_access_controls. Auth metadata only
  // carries provisioning flags such as must_change_password.
  if (input.accessControl) {
    const access = await input.accessControl.status({
      organizationId: verifyResult.identity.organizationId,
      actorId: verifyResult.identity.actorId,
    });
    if (access === "unavailable") {
      return authFailure(
        "INTEGRATION_UNAVAILABLE",
        "staff access control is unavailable",
        input.correlationId,
      );
    }
    if (access === "disabled") {
      return authFailure("FORBIDDEN", "staff access is disabled", input.correlationId, { field: "pos_access" });
    }
  }

  const session = toSession(verifyResult.identity);
  const csrfToken = crypto.randomUUID();
  const expiresAt = new Date(Date.parse(session.expiresAt));
  let sessionId: string;
  try {
    sessionId = await input.store.create(session, csrfToken, expiresAt, {
      mustChangePassword: verifyResult.identity.mustChangePassword === true,
      authUserId: verifyResult.identity.authUserId ?? null,
    });
  } catch {
    recordStaffSignInDiagnostic(sessionStoreDiagnostic(input.correlationId));
    return authFailure(
      "INTEGRATION_UNAVAILABLE",
      "staff session store is unavailable",
      input.correlationId,
      { field: "session_store" },
    );
  }
  const secure = input.secureCookies ?? true;
  return {
    ok: true,
    data: {
      session,
      sessionId,
      cookies: [sessionSetCookie(sessionId, expiresAt, secure), csrfSetCookie(csrfToken, expiresAt, secure)],
    },
    correlationId: input.correlationId,
  };
}

export async function revokeStaffSession(input: RevokeStaffSessionInput): Promise<{
  readonly cookies: readonly string[];
}> {
  const cookies = parseCookieHeader(input.cookieHeader);
  const sessionId = cookies[STAFF_SESSION_COOKIE];
  if (sessionId) {
    await input.store.revoke(sessionId);
  }
  const secure = input.secureCookies ?? true;
  return { cookies: [sessionClearCookie(secure), csrfClearCookie(secure)] };
}
