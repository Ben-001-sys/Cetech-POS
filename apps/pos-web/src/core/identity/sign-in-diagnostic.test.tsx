import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { establishStaffSession } from "../../server/auth/staff-session";
import { handleEstablishStaffSession } from "../../server/auth/handle-staff-session";
import { SystemHealthPanel } from "../../features/admin/SystemHealthPanel";
import { LoginScreen } from "../../features/auth/LoginScreen";
import { formatOperationalDateTime } from "../../ui/cashier-language";
import { STAFF_PRESENTATION_COPY } from "./staff-presentation-notice";
import { createPublicSupabaseStaffAuthProvider, StaffAuthError } from "./staff-auth-provider";
import { createBffStaffSessionGateway } from "./bff-staff-session-gateway";
import { createStaffRuntimeController } from "./staff-runtime";
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
    const result = await gateway.establish("synthetic-access-token");
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
});

const EMAIL = "cashier@example.com";
const PASSWORD = "CorrectHorse7Battery";
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

async function capturePasswordGrant(failure: "timeout" | "transport" | "wrong" | "rejected"): Promise<{
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
      if (failure === "wrong") {
        return new Response(JSON.stringify({
          error_code: "invalid_credentials",
          access_token: "access-token-value",
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
    && !text.includes("service-role-key")
    && !text.includes("service_role")
    && !text.includes("invite-token-value");
}
