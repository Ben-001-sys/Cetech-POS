import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { establishStaffSession } from "../../server/auth/staff-session";
import { SystemHealthPanel } from "../../features/admin/SystemHealthPanel";
import {
  acceptStaffSignInReport,
  classifyPasswordGrantDiagnostic,
  classifyVerifierDiagnostic,
  clearStaffSignInDiagnostics,
  recentStaffSignInDiagnostics,
  runtimeNotConfiguredDiagnostic,
  sessionStoreDiagnostic,
} from "./sign-in-diagnostic";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("staff sign-in diagnostics", () => {
  test("each support reason is classified without guessing", () => {
    expect(classifyVerifierDiagnostic("timeout")).toBe("provider_timeout");
    expect(classifyVerifierDiagnostic("unavailable")).toBe("provider_unavailable");
    expect(classifyVerifierDiagnostic("rejected")).toBe("provider_rejected");
    expect(classifyVerifierDiagnostic("malformed")).toBe("verifier_malformed");
    expect(classifyVerifierDiagnostic("transport")).toBe("transport_failed");
    expect(sessionStoreDiagnostic(CORRELATION).reason).toBe("session_store_unavailable");
    expect(sessionStoreDiagnostic(CORRELATION).sessionStoreReached).toBe(true);
    expect(runtimeNotConfiguredDiagnostic(CORRELATION).reason).toBe("runtime_not_configured");
    expect(runtimeNotConfiguredDiagnostic(CORRELATION).sessionStoreReached).toBe(false);
    expect(classifyPasswordGrantDiagnostic({ configured: false })).toBe("runtime_not_configured");
    expect(classifyPasswordGrantDiagnostic({ configured: true, timeout: true })).toBe("provider_timeout");
    expect(classifyPasswordGrantDiagnostic({ configured: true, transport: true })).toBe("transport_failed");
    expect(classifyPasswordGrantDiagnostic({ configured: true, httpStatus: 503 })).toBe("provider_unavailable");
    expect(classifyPasswordGrantDiagnostic({ configured: true, httpStatus: 422 })).toBe("provider_rejected");
    expect(classifyPasswordGrantDiagnostic({ configured: true, missingAccessToken: true })).toBe("verifier_malformed");
    expect(classifyPasswordGrantDiagnostic({ configured: true, credentialRejection: true, httpStatus: 401 })).toBeNull();
    expect(classifyPasswordGrantDiagnostic({ configured: true, accessDisabled: true, httpStatus: 400 })).toBeNull();
  });

  test("a report drops secrets and does not mark the session store as reached", () => {
    expect(acceptStaffSignInReport({
      reason: "provider_timeout",
      httpStatus: 504,
      category: "identity_provider",
    }, CORRELATION)).toEqual({
      correlationId: CORRELATION,
      category: "identity_provider",
      httpStatusClass: "5xx",
      reason: "provider_timeout",
      sessionStoreReached: false,
    });
    for (const body of [
      { reason: "provider_timeout", email: "cashier@example.com" },
      { reason: "provider_timeout", password: "secret-value" },
      { reason: "provider_rejected", authorization: "Bearer secret" },
      { reason: "verifier_malformed", access_token: "token-value" },
      { reason: "runtime_not_configured", note: "service_role key" },
    ]) {
      expect(acceptStaffSignInReport(body, CORRELATION)).toBeNull();
    }
  });

  test("verifier timeout is recorded before the session store is touched", async () => {
    clearStaffSignInDiagnostics();
    let created = false;
    const result = await establishStaffSession({
      accessToken: "not-logged",
      now: new Date(),
      correlationId: CORRELATION,
      verifier: { async verify() { return { ok: false as const, reason: "timeout" as const }; } },
      store: {
        async create() { created = true; return "sid"; },
        async get() { return null; },
        async revoke() { return; },
        async revokeActorSessions() { return; },
      },
    });
    expect(result.ok).toBe(false);
    expect(created).toBe(false);
    const [row] = recentStaffSignInDiagnostics();
    expect(row?.reason).toBe("provider_timeout");
    expect(row?.correlationId).toBe(CORRELATION);
    expect(row?.sessionStoreReached).toBe(false);
    expect(JSON.stringify(row)).not.toMatch(/password|bearer |access_token|service_role|@/i);
  });

  test("a session-store failure is distinct and records that creation was reached", async () => {
    clearStaffSignInDiagnostics();
    const result = await establishStaffSession({
      accessToken: "not-logged",
      now: new Date(),
      correlationId: CORRELATION,
      verifier: {
        async verify() {
          return {
            ok: true as const,
            identity: {
              actorId: "cashier_a",
              displayName: "Ama",
              organizationId: "org_a",
              locationIds: ["loc_a1"],
              registerId: null,
              capabilities: [],
              expiresAt: "2026-09-30T12:00:00.000Z",
            },
          };
        },
      },
      store: {
        async create() { throw new Error("store down"); },
        async get() { return null; },
        async revoke() { return; },
        async revokeActorSessions() { return; },
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe("staff session store is unavailable");
    }
    const [row] = recentStaffSignInDiagnostics();
    expect(row?.reason).toBe("session_store_unavailable");
    expect(row?.sessionStoreReached).toBe(true);
  });

  test("system health shows the support reason and hides secrets", () => {
    const html = renderToStaticMarkup(
      <SystemHealthPanel
        view={{
          overall: "healthy",
          buildId: "build-ok",
          checks: [],
          signInDiagnostics: [{
            correlationId: CORRELATION,
            category: "bff_session",
            httpStatusClass: "5xx",
            reason: "provider_unavailable",
            sessionStoreReached: false,
          }],
        }}
      />,
    );
    expect(html).toContain("Recent sign-in checks");
    expect(html).toContain("The sign-in service did not respond.");
    expect(html).toContain("provider_unavailable");
    expect(html).toContain(CORRELATION);
    expect(html).toContain("Session save was not reached");
    expect(html).not.toContain("password");
    expect(html).not.toContain("service_role");
    expect(html).not.toContain("Bearer");
  });
});
