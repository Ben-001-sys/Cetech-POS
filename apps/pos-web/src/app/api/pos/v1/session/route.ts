import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseAuthEnv, staffAllowedOrigins } from "../../../../../config/env";
import { composeStaffSessionStore } from "../../../../../server/auth/compose-session-store";
import { composeStaffAccessControl } from "../../../../../server/auth/compose-staff-access-control";
import {
  handleEstablishStaffSession,
  handleReadStaffSession,
  handleRevokeStaffSession,
} from "../../../../../server/auth/handle-staff-session";
import { staffCookieSecure } from "../../../../../server/auth/cookies";
import { createStaffIdentityVerifier } from "../../../../../server/auth/identity-verifier";
import { createSupabaseAuthIntrospector } from "../../../../../server/auth/supabase-auth";
import { composeStaffAssignmentDirectory } from "../../../../../server/sales/compose-assignment-directory";
import { createServerRestFetch } from "../../../../../server/http/server-fetch";
import { STAFF_CSRF_HEADER } from "../../../../../config/auth";
import { authFailure } from "../../../../../server/auth/errors";
import { resolveCorrelationId } from "../../../../../server/http/correlation";
import { httpStatusFor } from "../../../../../server/http/status";
import { acceptStaffSignInReport, recordStaffSignInDiagnostic, runtimeNotConfiguredDiagnostic } from "../../../../../core/identity/sign-in-diagnostic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const store = tryComposeStore();
  const assignments = tryComposeAssignments();
  if (!store || !assignments) {
    return unavailable(request);
  }
  const result = await handleReadStaffSession({
    correlationIdHeader: request.headers.get("x-correlation-id") ?? undefined,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    cookieHeader: request.headers.get("cookie") ?? undefined,
    now: new Date(),
    store,
    assignments,
    allowedOrigins: staffAllowedOrigins(),
  });
  return withCookies(result);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (request.headers.get("x-cetech-sign-in-report") === "1" && !request.headers.get("authorization")) {
    return reportSignInFailure(request);
  }
  const store = tryComposeStore();
  const verifier = tryComposeVerifier();
  const accessControl = tryComposeAccessControl();
  const assignments = tryComposeAssignments();
  if (!store || !verifier || !accessControl || !assignments) {
    return unavailable(request);
  }
  const result = await handleEstablishStaffSession({
    correlationIdHeader: request.headers.get("x-correlation-id") ?? undefined,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    authorizationHeader: request.headers.get("authorization") ?? undefined,
    now: new Date(),
    verifier,
    accessControl,
    assignments,
    store,
    allowedOrigins: staffAllowedOrigins(),
    secureCookies: staffCookieSecure(),
  });
  return withCookies(result);
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const store = tryComposeStore();
  if (!store) {
    return unavailable(request);
  }
  const result = await handleRevokeStaffSession({
    correlationIdHeader: request.headers.get("x-correlation-id") ?? undefined,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    cookieHeader: request.headers.get("cookie") ?? undefined,
    csrfHeader: request.headers.get(STAFF_CSRF_HEADER),
    now: new Date(),
    store,
    allowedOrigins: staffAllowedOrigins(),
    secureCookies: staffCookieSecure(),
  });
  return withCookies(result);
}

function tryComposeStore() {
  try {
    return composeStaffSessionStore(process.env, createServerRestFetch());
  } catch {
    return undefined;
  }
}

function tryComposeAccessControl() {
  try {
    return composeStaffAccessControl(process.env);
  } catch {
    return undefined;
  }
}

function tryComposeVerifier() {
  const authEnv = readSupabaseAuthEnv();
  if (!authEnv) {
    return undefined;
  }
  try {
    return createStaffIdentityVerifier(
      createSupabaseAuthIntrospector({
        supabaseUrl: authEnv.url,
        publishableKey: authEnv.publishableKey,
      }),
    );
  } catch {
    return undefined;
  }
}

function tryComposeAssignments() {
  try {
    return composeStaffAssignmentDirectory(process.env, createServerRestFetch());
  } catch {
    return undefined;
  }
}

function unavailable(request: NextRequest): NextResponse {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
  recordStaffSignInDiagnostic(runtimeNotConfiguredDiagnostic(correlation.correlationId));
  const body = authFailure(
    "INTEGRATION_UNAVAILABLE",
    "staff session runtime is not configured",
    correlation.correlationId,
  );
  return NextResponse.json(body, {
    status: httpStatusFor(body.error.code),
    headers: { "Cache-Control": "no-store", "X-Correlation-ID": body.correlationId },
  });
}

function withCookies(result: {
  readonly status: number;
  readonly body: unknown;
  readonly cookies: readonly string[];
  readonly headers: Record<string, string>;
}): NextResponse {
  const response = NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
  for (const cookie of result.cookies) {
    response.headers.append("Set-Cookie", cookie);
  }
  return response;
}

async function reportSignInFailure(request: NextRequest): Promise<NextResponse> {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
  const origin = request.headers.get("origin");
  if (!origin || !staffAllowedOrigins().includes(origin)) {
    return NextResponse.json(
      { ok: false, correlationId: correlation.correlationId },
      { status: 403, headers: { "Cache-Control": "no-store", "X-Correlation-ID": correlation.correlationId } },
    );
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const diagnostic = correlation.ok ? acceptStaffSignInReport(body, correlation.correlationId) : null;
  if (diagnostic) {
    recordStaffSignInDiagnostic(diagnostic);
  }
  return NextResponse.json(
    { ok: true, data: { recorded: Boolean(diagnostic) }, correlationId: correlation.correlationId },
    {
      status: diagnostic ? 200 : 400,
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": correlation.correlationId },
    },
  );
}
