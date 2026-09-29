import { NextResponse, type NextRequest } from "next/server";
import { STAFF_CSRF_COOKIE, STAFF_CSRF_HEADER } from "@/config/auth";
import { staffAllowedOrigins } from "@/config/env";
import { parseCookieHeader } from "@/server/auth/cookies";
import { composeStaffSessionStore } from "@/server/auth/compose-session-store";
import { composeStaffAssignmentDirectory } from "@/server/sales/compose-assignment-directory";
import { composeControlPlaneDirectory } from "@/server/admin/compose-control-plane-directory";
import { composeStaffIdentityAdminStore } from "@/server/admin/compose-staff-identity-admin-store";
import { composeStaffAccessStatusAdminStore } from "@/server/admin/compose-staff-access-status-admin-store";
import { composeAdminAuditStore } from "@/server/admin/compose-admin-audit-store";
import { handleInviteStaff, readStaffInviteBody } from "@/server/admin/handle-invite-staff";
import { createServerRestFetch } from "@/server/http/server-fetch";
import { resolveCorrelationId } from "@/server/http/correlation";
import { httpStatusFor } from "@/server/http/status";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
  try {
    const body = await request.json() as unknown;
    const parsed = readStaffInviteBody(body);
    if (!parsed) {
      const result = {
        ok: false as const,
        error: {
          code: "VALIDATION_ERROR" as const,
          message: "staff invitation request is invalid",
          retryable: false,
          nextAction: "resolve" as const,
        },
        correlationId: correlation.correlationId,
      };
      return NextResponse.json(result, {
        status: httpStatusFor(result.error.code),
        headers: { "Cache-Control": "no-store", "X-Correlation-ID": result.correlationId },
      });
    }

    const fetchImpl = createServerRestFetch();
    const result = await handleInviteStaff({
      correlationId: correlation.correlationId,
      cookieHeader: request.headers.get("cookie") ?? undefined,
      now: new Date(),
      sessions: composeStaffSessionStore(process.env, fetchImpl),
      assignments: composeStaffAssignmentDirectory(process.env, fetchImpl),
      controlPlane: composeControlPlaneDirectory(process.env),
      identities: composeStaffIdentityAdminStore(process.env),
      accessStatus: composeStaffAccessStatusAdminStore(process.env),
      audit: composeAdminAuditStore(process.env),
      email: parsed.email,
      displayName: parsed.displayName,
      runtimeEnv: process.env,
      protection: {
        origin: request.headers.get("origin"),
        referer: request.headers.get("referer"),
        csrfCookie: parseCookieHeader(request.headers.get("cookie") ?? undefined)[STAFF_CSRF_COOKIE] ?? null,
        csrfHeader: request.headers.get(STAFF_CSRF_HEADER),
        allowedOrigins: staffAllowedOrigins(),
      },
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : httpStatusFor(result.error.code),
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": result.correlationId },
    });
  } catch {
    const result = {
      ok: false as const,
      error: {
        code: "INTEGRATION_UNAVAILABLE" as const,
        message: "staff invitation runtime is unavailable",
        retryable: true,
        nextAction: "resolve" as const,
      },
      correlationId: correlation.correlationId,
    };
    return NextResponse.json(result, {
      status: httpStatusFor(result.error.code),
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": result.correlationId },
    });
  }
}

