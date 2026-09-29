import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { establishStaffSession } from "../../server/auth/staff-session";
import { handleEstablishStaffSession, handleReadStaffSession } from "../../server/auth/handle-staff-session";
import { createEphemeralInMemoryStaffSessionStore } from "../../server/auth/session-store";
import type { Register } from "../../../../../docs/contracts/domain.generated";
import type { RegisterPort } from "../../../../../docs/contracts/ports";
import { SystemHealthPanel } from "../../features/admin/SystemHealthPanel";
import { LoginScreen } from "../../features/auth/LoginScreen";
import { formatOperationalDateTime } from "../../ui/cashier-language";
import { STAFF_PRESENTATION_COPY } from "./staff-presentation-notice";
import { createPublicSupabaseStaffAuthProvider, StaffAuthError, type StaffAuthSuccess } from "./staff-auth-provider";
import { createBffStaffSessionGateway } from "./bff-staff-session-gateway";
import { createMemorySelectedRegisterStore } from "./selected-register-preference";
import { createStaffRuntimeController, type StaffRuntimeController } from "./staff-runtime";
import {
  acceptStaffSignInReport,
  classifyPasswordGrantDiagnostic,
  classifyVerifierDiagnostic,
  clearStaffSignInDiagnostics,
  recentStaffSignInDiagnostics,
  recordStaffSignInDiagnostic,
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
            createdAt: "2026-09-29T12:00:00.000Z",
          }],
        }}
      />,
    );
    expect(html).toContain("Recent sign-in checks");
    expect(html).toContain("The sign-in service did not respond.");
    expect(html).toContain("provider_unavailable");
    expect(html).toContain(`Reference ${CORRELATION}`);
    expect(html).toContain(`Checked ${formatOperationalDateTime("2026-09-29T12:00:00.000Z")}`);
    expect(html).toContain("Session save was not reached");
    expect(html).not.toContain("password");
    expect(html).not.toContain("service_role");
    expect(html).not.toContain("Bearer");
  });

  test("provider timeout keeps one correlation through the report, record, and log", async () => {
    const captured = await capturePasswordGrant("timeout");
    expect(captured.error.correlationId).toBeTruthy();
    expect(captured.reports).toHaveLength(1);
    expect(captured.reports[0]?.correlation).toBe(captured.error.correlationId);
    const recorded = recordReported(captured.reports[0]!);
    expect(recorded.correlationId).toBe(captured.error.correlationId);
    expect(recorded.reason).toBe("provider_timeout");
    expect(recorded.log).toContain(captured.error.correlationId!);
    const html = renderToStaticMarkup(
      <LoginScreen noticeState="provider_unavailable" supportReference={captured.error.correlationId} />,
    );
    expect(html).toContain(STAFF_PRESENTATION_COPY.provider_unavailable);
    expect(html).toContain(`Reference ${captured.error.correlationId}`);
    expect(secretFree(html, captured.reports[0]?.body ?? "", recorded.log, JSON.stringify(captured.error))).toBe(true);
  });

  test("provider transport failure keeps the same correlation", async () => {
    const captured = await capturePasswordGrant("transport");
    expect(captured.reports[0]?.correlation).toBe(captured.error.correlationId);
    const recorded = recordReported(captured.reports[0]!);
    expect(recorded.reason).toBe("transport_failed");
    expect(recorded.correlationId).toBe(captured.error.correlationId);
    expect(recorded.log).toContain(captured.error.correlationId!);
  });

  test("a BFF transport failure reports the gateway request correlation", async () => {
    const reports: string[] = [];
    const gateway = createBffStaffSessionGateway({
      correlationId: () => CORRELATION,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        if (headerValue(init?.headers, "x-cetech-sign-in-report") === "1") {
          reports.push(headerValue(init?.headers, "x-correlation-id"));
          return new Response("{}", { status: 200 });
        }
        throw new TypeError("socket hang up");
      }) as typeof fetch,
    });
    const result = await gateway.establish({
      accessToken: "synthetic-access-token",
      correlationId: CORRELATION,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.correlationId).toBe(CORRELATION);
    expect(reports).toEqual([CORRELATION]);
  });

  test("a verifier failure on the session handler uses the request correlation", async () => {
    clearStaffSignInDiagnostics();
    const result = await handleEstablishStaffSession({
      correlationIdHeader: CORRELATION,
      origin: "http://localhost:3000",
      referer: null,
      authorizationHeader: "Bearer not-logged",
      now: new Date(),
      verifier: { async verify() { return { ok: false as const, reason: "malformed" as const }; } },
      assignments: { async lookup() { throw new Error("assignments were not reached"); } },
      store: unusedStore(),
      allowedOrigins: ["http://localhost:3000"],
      secureCookies: false,
    });
    expect(result.headers["X-Correlation-ID"]).toBe(CORRELATION);
    const [row] = recentStaffSignInDiagnostics();
    expect(row?.reason).toBe("verifier_malformed");
    expect(row?.correlationId).toBe(CORRELATION);
    expect(row?.createdAt).toBeTruthy();
  });

  test("a session-store failure on the session handler keeps the request correlation", async () => {
    clearStaffSignInDiagnostics();
    const result = await handleEstablishStaffSession({
      correlationIdHeader: CORRELATION,
      origin: "http://localhost:3000",
      referer: null,
      authorizationHeader: "Bearer not-logged",
      now: new Date(),
      verifier: { async verify() { return { ok: true as const, identity: IDENTITY }; } },
      assignments: { async lookup() { throw new Error("assignments were not reached"); } },
      store: {
        async create() { throw new Error("store down"); },
        async get() { return null; },
        async revoke() { return; },
        async revokeActorSessions() { return; },
      },
      allowedOrigins: ["http://localhost:3000"],
      secureCookies: false,
    });
    expect(result.body.ok).toBe(false);
    const [row] = recentStaffSignInDiagnostics();
    expect(row?.reason).toBe("session_store_unavailable");
    expect(row?.sessionStoreReached).toBe(true);
    expect(row?.correlationId).toBe(CORRELATION);
    expect(result.headers["X-Correlation-ID"]).toBe(CORRELATION);
  });

  test("support records, logs, runtime state, and system health omit secrets", async () => {
    const captured = await capturePasswordGrant("rejected");
    const recorded = recordReported(captured.reports[0]!);
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() { throw new Error("not reached"); },
        async readContext() { throw new Error("not reached"); },
        async read() { return null; },
        async clear() { return; },
      },
      auth: {
        async signIn() { throw captured.error; },
        async signOut() { return; },
      },
      registers: {
        async get() { throw new Error("not reached"); },
        async activeShift() { throw new Error("not reached"); },
        async open() { throw new Error("not reached"); },
        async cashMovement() { throw new Error("not reached"); },
        async close() { throw new Error("not reached"); },
        async report() { throw new Error("not reached"); },
      },
    });
    await runtime.signIn({ email: EMAIL, password: PASSWORD });
    const health = renderToStaticMarkup(
      <SystemHealthPanel
        view={{
          overall: "degraded",
          buildId: "build-ok",
          checks: [],
          signInDiagnostics: recentStaffSignInDiagnostics(),
        }}
      />,
    );
    expect(secretFree(
      captured.reports[0]?.body ?? "",
      recorded.log,
      JSON.stringify(runtime.getState()),
      health,
    )).toBe(true);
    expect(runtime.getState().supportReference).toBe(captured.error.correlationId);
    expect(health).toContain(`Reference ${captured.error.correlationId}`);
  });

  test("a wrong password does not create a support record and keeps the cashier copy", async () => {
    clearStaffSignInDiagnostics();
    const captured = await capturePasswordGrant("wrong");
    expect(captured.reports).toEqual([]);
    expect(captured.error.kind).toBe("invalid_credentials");
    expect(captured.error.correlationId).toBeUndefined();
    expect(recentStaffSignInDiagnostics()).toEqual([]);
    const html = renderToStaticMarkup(<LoginScreen noticeState="invalid_credentials" />);
    expect(html).toContain(STAFF_PRESENTATION_COPY.invalid_credentials);
    expect(html).not.toContain("Reference");
    expect(STAFF_PRESENTATION_COPY.invalid_credentials).toBe("Incorrect email or password.");
  });

  test("repeated failures of the same reason stay ordered by server time", () => {
    clearStaffSignInDiagnostics();
    recordStaffSignInDiagnostic(sessionStoreDiagnostic(CORRELATION), () => new Date("2026-09-29T12:00:00.000Z"));
    recordStaffSignInDiagnostic(sessionStoreDiagnostic(CORRELATION), () => new Date("2026-09-29T12:05:00.000Z"));
    const rows = recentStaffSignInDiagnostics();
    expect(rows.map((row) => row.reason)).toEqual(["session_store_unavailable", "session_store_unavailable"]);
    const earlier = rows[0];
    const later = rows[1];
    if (!earlier || !later) throw new Error("expected two diagnostic rows");
    expect(earlier.createdAt < later.createdAt).toBe(true);
    const html = renderToStaticMarkup(
      <SystemHealthPanel view={{ overall: "degraded", buildId: "build-ok", checks: [], signInDiagnostics: rows }} />,
    );
    const first = html.indexOf(formatOperationalDateTime(earlier.createdAt));
    const second = html.indexOf(formatOperationalDateTime(later.createdAt));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThan(first);
  });

  test("provider success keeps one correlation when session-store creation fails", async () => {
    const calls: string[] = [];
    let serverBody = "";
    const outcome = await signInAttempt({
      attemptId: ATTEMPT,
      fetchImpl: async (_url, init) => {
        const correlation = headerValue(init?.headers, "x-correlation-id");
        calls.push(`${init?.method ?? "GET"} ${correlation}`);
        const result = await handleEstablishStaffSession({
          correlationIdHeader: correlation,
          origin: "http://localhost:3000",
          referer: null,
          authorizationHeader: headerValue(init?.headers, "authorization"),
          now: NOW,
          verifier: { async verify() { return { ok: true as const, identity: IDENTITY }; } },
          assignments: { async lookup() { throw new Error("assignments were not reached"); } },
          store: {
            async create() { throw new Error("store down"); },
            async get() { return null; },
            async revoke() { return; },
            async revokeActorSessions() { return; },
          },
          allowedOrigins: ["http://localhost:3000"],
          secureCookies: false,
        });
        serverBody = JSON.stringify(result.body);
        return jsonResult(result.status, result.body);
      },
    });
    const [row] = recentStaffSignInDiagnostics();
    const cashier = renderCashier(outcome.runtime);
    const health = renderHealth();
    expect(calls).toEqual([`POST ${ATTEMPT}`]);
    expect(outcome.signedIn.correlationId).toBe(ATTEMPT);
    expect(serverBody).toContain(ATTEMPT);
    expect(row?.correlationId).toBe(ATTEMPT);
    expect(row?.reason).toBe("session_store_unavailable");
    expect(row?.sessionStoreReached).toBe(true);
    expect(row?.createdAt).toBeTruthy();
    expect(outcome.log).toContain(ATTEMPT);
    expect(outcome.runtime.getState().supportReference).toBe(ATTEMPT);
    expect(outcome.runtime.getState().presentationNotice).toBe("provider_unavailable");
    expect(cashier).toContain(`Reference ${ATTEMPT}`);
    expect(health).toContain(`Reference ${ATTEMPT}`);
    expect(secretFree(serverBody, JSON.stringify(row), outcome.log, JSON.stringify(outcome.runtime.getState()), cashier, health)).toBe(true);
  });

  test("canonical disabled access does not show a cashier support reference", async () => {
    const outcome = await signInAttempt({
      attemptId: ATTEMPT,
      fetchImpl: async (_url, init) => {
        const correlation = headerValue(init?.headers, "x-correlation-id");
        const result = await handleEstablishStaffSession({
          correlationIdHeader: correlation,
          origin: "http://localhost:3000",
          referer: null,
          authorizationHeader: headerValue(init?.headers, "authorization"),
          now: NOW,
          verifier: { async verify() { return { ok: true as const, identity: IDENTITY }; } },
          accessControl: { async status() { return "disabled"; } },
          assignments: { async lookup() { throw new Error("assignments were not reached"); } },
          store: unusedStore(),
          allowedOrigins: ["http://localhost:3000"],
          secureCookies: false,
        });
        expect(result.body.correlationId).toBe(ATTEMPT);
        if (!result.body.ok) {
          expect(result.body.error.code).toBe("FORBIDDEN");
          expect(result.body.error.details?.field).toBe("pos_access");
        }
        return jsonResult(result.status, result.body);
      },
    });
    const state = outcome.runtime.getState();
    const cashier = renderCashier(outcome.runtime);
    expect(outcome.signedIn.correlationId).toBe(ATTEMPT);
    expect(state.status).toBe("unauthorized");
    expect(state.presentationNotice).toBe("access_disabled");
    expect(state.supportReference).toBeUndefined();
    expect(state.session).toBeNull();
    expect(state.register).toBeNull();
    expect(cashier).toContain("Your POS access is disabled. Contact a manager.");
    expect(cashier).not.toContain("Reference");
    expect(recentStaffSignInDiagnostics()).toEqual([]);
    expect(outcome.log).toBe("");
    expect(secretFree(cashier, JSON.stringify(state))).toBe(true);
  });

  test("provider success keeps one correlation when the verifier times out", async () => {
    const calls: string[] = [];
    let serverBody = "";
    const outcome = await signInAttempt({
      attemptId: ATTEMPT,
      fetchImpl: async (_url, init) => {
        const correlation = headerValue(init?.headers, "x-correlation-id");
        calls.push(`${init?.method ?? "GET"} ${correlation}`);
        const result = await handleEstablishStaffSession({
          correlationIdHeader: correlation,
          origin: "http://localhost:3000",
          referer: null,
          authorizationHeader: headerValue(init?.headers, "authorization"),
          now: NOW,
          verifier: { async verify() { return { ok: false as const, reason: "timeout" as const }; } },
          assignments: { async lookup() { throw new Error("assignments were not reached"); } },
          store: unusedStore(),
          allowedOrigins: ["http://localhost:3000"],
          secureCookies: false,
        });
        serverBody = JSON.stringify(result.body);
        return jsonResult(result.status, result.body);
      },
    });
    const [row] = recentStaffSignInDiagnostics();
    const cashier = renderCashier(outcome.runtime);
    const health = renderHealth();
    expect(calls).toEqual([`POST ${ATTEMPT}`]);
    expect(outcome.signedIn.correlationId).toBe(ATTEMPT);
    expect(row?.reason).toBe("provider_timeout");
    expect(row?.sessionStoreReached).toBe(false);
    expect(row?.correlationId).toBe(ATTEMPT);
    expect(row?.createdAt).toBeTruthy();
    expect(serverBody).toContain(ATTEMPT);
    expect(outcome.log).toContain(ATTEMPT);
    expect(outcome.runtime.getState().supportReference).toBe(ATTEMPT);
    expect(cashier).toContain(`Reference ${ATTEMPT}`);
    expect(health).toContain(`Reference ${ATTEMPT}`);
    expect(secretFree(serverBody, JSON.stringify(row), outcome.log, JSON.stringify(outcome.runtime.getState()), cashier, health)).toBe(true);
  });

  test("session POST and the required GET share the provider attempt correlation", async () => {
    const store = createEphemeralInMemoryStaffSessionStore();
    let cookieHeader = "";
    const calls: string[] = [];
    const outcome = await signInAttempt({
      attemptId: ATTEMPT,
      registers: readyRegisters(),
      fetchImpl: async (_url, init) => {
        const method = init?.method ?? "GET";
        const correlation = headerValue(init?.headers, "x-correlation-id");
        calls.push(`${method} ${correlation}`);
        if (method === "POST") {
          const result = await handleEstablishStaffSession({
            correlationIdHeader: correlation,
            origin: "http://localhost:3000",
            referer: null,
            authorizationHeader: headerValue(init?.headers, "authorization"),
            now: NOW,
            verifier: { async verify() { return { ok: true as const, identity: IDENTITY }; } },
            assignments: {
              async lookup() {
                return { locationIds: ["loc_a1"], registerIds: ["reg_a"], locationRoles: [] };
              },
            },
            store,
            allowedOrigins: ["http://localhost:3000"],
            secureCookies: false,
          });
          cookieHeader = result.cookies.join("; ");
          return jsonResult(result.status, result.body);
        }
        const result = await handleReadStaffSession({
          correlationIdHeader: correlation,
          origin: "http://localhost:3000",
          referer: null,
          cookieHeader,
          now: NOW,
          store,
          assignments: { async lookup() { return "unavailable"; } },
          allowedOrigins: ["http://localhost:3000"],
        });
        return jsonResult(result.status, result.body);
      },
    });
    const cashier = renderCashier(outcome.runtime);
    expect(outcome.signedIn.correlationId).toBe(ATTEMPT);
    expect(calls).toEqual([`POST ${ATTEMPT}`, `GET ${ATTEMPT}`]);
    expect(outcome.runtime.getState().supportReference).toBe(ATTEMPT);
    expect(outcome.runtime.getState().presentationNotice).toBe("assignments_unavailable");
    expect(cashier).toContain(STAFF_PRESENTATION_COPY.assignments_unavailable.replaceAll("'", "&#x27;"));
    expect(cashier).toContain(`Reference ${ATTEMPT}`);
    expect(cashier).not.toContain("No register assigned");
    expect(secretFree(cashier, JSON.stringify(outcome.runtime.getState()), outcome.log)).toBe(true);
  });

  test("a BFF transport failure reports the provider attempt correlation", async () => {
    const reports: string[] = [];
    const outcome = await signInAttempt({
      attemptId: ATTEMPT,
      fetchImpl: async (_url, init) => {
        const correlation = headerValue(init?.headers, "x-correlation-id");
        if (headerValue(init?.headers, "x-cetech-sign-in-report") === "1") {
          reports.push(correlation);
          return jsonResult(200, {});
        }
        throw new TypeError("socket hang up");
      },
    });
    const cashier = renderCashier(outcome.runtime);
    expect(reports).toEqual([ATTEMPT]);
    expect(outcome.signedIn.correlationId).toBe(ATTEMPT);
    expect(outcome.runtime.getState().supportReference).toBe(ATTEMPT);
    expect(cashier).toContain(`Reference ${ATTEMPT}`);
    expect(JSON.stringify(outcome.runtime.getState())).not.toContain(FRESH);
    expect(secretFree(reports.join("\n"), JSON.stringify(outcome.runtime.getState()), cashier)).toBe(true);
  });

  test("a later session refresh mints a fresh correlation", async () => {
    const calls: string[] = [];
    let refreshAllowed = false;
    const outcome = await signInAttempt({
      attemptId: ATTEMPT,
      nextRequestId: () => {
        if (!refreshAllowed) throw new Error("sign-in establishment minted a second correlation");
        return FRESH;
      },
      registers: readyRegisters(),
      fetchImpl: async (_url, init) => {
        const correlation = headerValue(init?.headers, "x-correlation-id");
        calls.push(`${init?.method ?? "GET"} ${correlation}`);
        return jsonResult(200, {
          ok: true,
          correlationId: correlation,
          data: {
            session: SESSION_CONTEXT.session,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a"],
          },
        });
      },
    });
    expect(outcome.runtime.getState().status).toBe("ready");
    expect(outcome.runtime.getState().supportReference).toBeUndefined();
    expect(calls).toEqual([`POST ${ATTEMPT}`, `GET ${ATTEMPT}`]);
    refreshAllowed = true;
    await outcome.runtime.refreshRegister();
    expect(calls).toEqual([`POST ${ATTEMPT}`, `GET ${ATTEMPT}`, `GET ${FRESH}`]);
    expect(ATTEMPT).not.toBe(FRESH);
  });

  test("wrong password and disabled access do not create a support reference", async () => {
    for (const failure of ["wrong", "disabled"] as const) {
      clearStaffSignInDiagnostics();
      const captured = await capturePasswordGrant(failure);
      expect(captured.reports).toEqual([]);
      expect(captured.error.correlationId).toBeUndefined();
      expect(recentStaffSignInDiagnostics()).toEqual([]);
      const runtime = createStaffRuntimeController({
        gateway: {
          async establish() { throw new Error("bff must not run"); },
          async readContext() { throw new Error("not reached"); },
          async read() { return null; },
          async clear() { return; },
        },
        auth: {
          async signIn() { throw captured.error; },
          async signOut() { return; },
        },
        registers: idleRegisters(),
      });
      await runtime.signIn({ email: EMAIL, password: PASSWORD });
      const notice = failure === "wrong" ? "invalid_credentials" : "access_disabled";
      const html = renderToStaticMarkup(
        <LoginScreen noticeState={notice} supportReference={runtime.getState().supportReference} />,
      );
      expect(runtime.getState().presentationNotice).toBe(notice);
      expect(runtime.getState().supportReference).toBeUndefined();
      expect(html).toContain(STAFF_PRESENTATION_COPY[notice]);
      expect(html).not.toContain("Reference");
      expect(secretFree(html, JSON.stringify(runtime.getState()))).toBe(true);
    }
    expect(STAFF_PRESENTATION_COPY.invalid_credentials).toBe("Incorrect email or password.");
    expect(STAFF_PRESENTATION_COPY.access_disabled).toBe("Your POS access is disabled. Contact a manager.");
  });
});

const EMAIL = "cashier@example.com";
const PASSWORD = "CorrectHorse7Battery";
const ATTEMPT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FRESH = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-09-29T12:00:00.000Z");
const AUTH_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-test-key",
};
const IDENTITY = {
  actorId: "cashier_a",
  displayName: "Ama",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
  registerId: null,
  capabilities: [],
  expiresAt: "2026-09-30T12:00:00.000Z",
};
const REGISTER: Register = {
  id: "reg_a",
  name: "Front Counter",
  locationId: "loc_a1",
  currency: "GHS",
  status: "active",
};
const SESSION_CONTEXT = {
  session: {
    actorId: "cashier_a",
    displayName: "Ama",
    organizationId: "org_a",
    locationIds: ["loc_a1"],
    capabilities: [],
    expiresAt: "2099-01-01T00:00:00.000Z",
  },
};

function unusedStore() {
  return {
    async create() { throw new Error("store was not reached"); },
    async get() { return null; },
    async revoke() { return; },
    async revokeActorSessions() { return; },
  };
}

function headerValue(headers: HeadersInit | undefined, name: string): string {
  if (!headers) return "";
  if (headers instanceof Headers) return headers.get(name) ?? "";
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === name);
    return found?.[1] ?? "";
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? "";
}

async function capturePasswordGrant(failure: "timeout" | "transport" | "wrong" | "rejected" | "disabled"): Promise<{
  readonly reports: { readonly correlation: string; readonly body: string }[];
  readonly error: StaffAuthError;
}> {
  const reports: { correlation: string; body: string }[] = [];
  const provider = createPublicSupabaseStaffAuthProvider({
    env: AUTH_ENV,
    fetchImpl: async (_url, init) => {
      if (headerValue(init?.headers, "x-cetech-sign-in-report") === "1") {
        reports.push({
          correlation: headerValue(init?.headers, "x-correlation-id"),
          body: String(init?.body ?? ""),
        });
        return new Response("{}", { status: 200 });
      }
      if (!init?.signal) throw new Error("password grant is missing its timeout signal");
      if (failure === "timeout") throw new DOMException("timed out", "TimeoutError");
      if (failure === "transport") throw new TypeError("fetch failed");
      if (failure === "wrong" || failure === "disabled") {
        return new Response(JSON.stringify({
          error_code: failure === "disabled" ? "user_banned" : "invalid_credentials",
          access_token: "access-token-value",
          refresh_token: "refresh-token-value",
          invite: "invite-token-value",
        }), { status: 400, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "validation_failed", service_role: "service-role-key" }), {
        status: 422,
        headers: { "content-type": "application/json" },
      });
    },
  });
  try {
    await provider.signIn({ email: EMAIL, password: PASSWORD });
  } catch (error) {
    if (error instanceof StaffAuthError) return { reports, error };
    throw error;
  }
  throw new Error("password grant was expected to fail");
}

function recordReported(report: { readonly correlation: string; readonly body: string }): {
  readonly correlationId: string;
  readonly reason: string;
  readonly log: string;
} {
  clearStaffSignInDiagnostics();
  const draft = acceptStaffSignInReport(JSON.parse(report.body) as unknown, report.correlation);
  if (!draft) throw new Error("sign-in report was refused");
  const lines: string[] = [];
  const original = console.info;
  console.info = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    recordStaffSignInDiagnostic(draft);
  } finally {
    console.info = original;
  }
  const row = recentStaffSignInDiagnostics().at(-1);
  if (!row) throw new Error("sign-in report was not recorded");
  return { correlationId: row.correlationId, reason: row.reason, log: lines.join("\n") };
}

function secretFree(...parts: string[]): boolean {
  const text = parts.join("\n");
  return !text.includes(EMAIL)
    && !text.includes(PASSWORD)
    && !text.includes("Bearer ")
    && !text.includes("access-token-value")
    && !text.includes("refresh-token-value")
    && !text.includes("service-role-key")
    && !text.includes("service_role")
    && !text.includes("invite-token-value");
}

function jsonResult(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function idleRegisters(): RegisterPort {
  const fail = async () => {
    throw new Error("register was not reached");
  };
  return { get: fail, activeShift: fail, open: fail, cashMovement: fail, close: fail, report: fail };
}

function readyRegisters(): RegisterPort {
  const fail = async () => {
    throw new Error("register command was not reached");
  };
  return {
    async get() {
      return { ok: true, data: REGISTER, correlationId: ATTEMPT };
    },
    async activeShift() {
      return { ok: true, data: null, correlationId: ATTEMPT };
    },
    open: fail,
    cashMovement: fail,
    close: fail,
    report: fail,
  };
}

function renderCashier(runtime: StaffRuntimeController): string {
  const state = runtime.getState();
  const notice = state.presentationNotice === "assignments_unavailable"
    || state.presentationNotice === "provider_unavailable"
    || state.presentationNotice === "invalid_credentials"
    || state.presentationNotice === "access_disabled"
    ? state.presentationNotice
    : "provider_unavailable";
  return renderToStaticMarkup(
    <LoginScreen noticeState={notice} supportReference={state.supportReference} />,
  );
}

function renderHealth(): string {
  return renderToStaticMarkup(
    <SystemHealthPanel
      view={{
        overall: "degraded",
        buildId: "build-ok",
        checks: [],
        signInDiagnostics: recentStaffSignInDiagnostics(),
      }}
    />,
  );
}

async function signInAttempt(input: {
  readonly attemptId: string;
  readonly fetchImpl: typeof fetch;
  readonly registers?: RegisterPort;
  readonly nextRequestId?: () => string;
}): Promise<{
  readonly signedIn: StaffAuthSuccess;
  readonly runtime: StaffRuntimeController;
  readonly log: string;
}> {
  clearStaffSignInDiagnostics();
  const provider = createPublicSupabaseStaffAuthProvider({
    env: AUTH_ENV,
    correlationId: () => input.attemptId,
    fetchImpl: async (_url, init) => {
      if (!init?.signal) throw new Error("password grant is missing its timeout signal");
      return jsonResult(200, {
        access_token: "access-token-value",
        refresh_token: "refresh-token-value",
      });
    },
  });
  let signedIn: StaffAuthSuccess | undefined;
  const runtime = createStaffRuntimeController({
    gateway: createBffStaffSessionGateway({
      fetchImpl: input.fetchImpl,
      correlationId: input.nextRequestId ?? (() => {
        throw new Error("sign-in establishment minted a second correlation");
      }),
    }),
    auth: {
      async signIn(request) {
        signedIn = await provider.signIn(request);
        return signedIn;
      },
      async signOut() {
        return;
      },
    },
    registers: input.registers ?? idleRegisters(),
    selectedRegisterStore: createMemorySelectedRegisterStore(),
  });
  const lines: string[] = [];
  const original = console.info;
  console.info = (message?: unknown) => {
    lines.push(String(message));
  };
  try {
    await runtime.signIn({ email: EMAIL, password: PASSWORD });
  } finally {
    console.info = original;
  }
  if (!signedIn) throw new Error("provider did not return a sign-in result");
  return { signedIn, runtime, log: lines.join("\n") };
}
