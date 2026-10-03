import { NextResponse, type NextRequest } from "next/server";
import { STAFF_CSRF_COOKIE, STAFF_CSRF_HEADER } from "../../../../../../config/auth";
import { staffAllowedOrigins } from "../../../../../../config/env";
import { composeStaffSessionStore } from "../../../../../../server/auth/compose-session-store";
import { parseCookieHeader } from "../../../../../../server/auth/cookies";
import { composeStaffAssignmentDirectory } from "../../../../../../server/sales/compose-assignment-directory";
import { composeControlPlaneDirectory } from "../../../../../../server/admin/compose-control-plane-directory";
import { composeReceiptSettingsAdminStore } from "../../../../../../server/admin/compose-receipt-settings-admin-store";
import {
  handleGetManagementReceiptSettings,
  handleSetManagementReceiptSettings,
} from "../../../../../../server/admin/handle-management-receipt-settings";
import { createServerRestFetch } from "../../../../../../server/http/server-fetch";
import { resolveCorrelationId } from "../../../../../../server/http/correlation";
import { httpStatusFor } from "../../../../../../server/http/status";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
  try {
    const fetchImpl = createServerRestFetch();
    const result = await handleGetManagementReceiptSettings({
      correlationId: correlation.correlationId,
      cookieHeader: request.headers.get("cookie") ?? undefined,
      now: new Date(),
      sessions: composeStaffSessionStore(process.env, fetchImpl),
      assignments: composeStaffAssignmentDirectory(process.env, fetchImpl),
      controlPlane: composeControlPlaneDirectory(process.env),
      receiptSettings: composeReceiptSettingsAdminStore(process.env),
      locationId: request.nextUrl.searchParams.get("locationId") ?? undefined,
      scope: request.nextUrl.searchParams.get("scope") ?? undefined,
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : httpStatusFor(result.error.code),
      headers: {
        "Cache-Control": "no-store",
        "X-Correlation-ID": result.correlationId,
      },
    });
  } catch {
    return NextResponse.json({
      ok: false as const,
      error: {
        code: "INTEGRATION_UNAVAILABLE" as const,
        message: "receipt settings are unavailable",
        retryable: true,
        nextAction: "resolve" as const,
      },
      correlationId: correlation.correlationId,
    }, {
      status: httpStatusFor("INTEGRATION_UNAVAILABLE"),
      headers: {
        "Cache-Control": "no-store",
        "X-Correlation-ID": correlation.correlationId,
      },
    });
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
  try {
    const fetchImpl = createServerRestFetch();
    const body = await readBody(request);
    const result = await handleSetManagementReceiptSettings({
      correlationId: correlation.correlationId,
      cookieHeader: request.headers.get("cookie") ?? undefined,
      now: new Date(),
      sessions: composeStaffSessionStore(process.env, fetchImpl),
      assignments: composeStaffAssignmentDirectory(process.env, fetchImpl),
      controlPlane: composeControlPlaneDirectory(process.env),
      receiptSettings: composeReceiptSettingsAdminStore(process.env),
      locationId: body.locationId,
      scope: body.scope,
      settings: body.settings,
      overrides: body.overrides,
      action: body.action,
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
      headers: {
        "Cache-Control": "no-store",
        "X-Correlation-ID": result.correlationId,
      },
    });
  } catch {
    return NextResponse.json({
      ok: false as const,
      error: {
        code: "INTEGRATION_UNAVAILABLE" as const,
        message: "receipt settings are unavailable",
        retryable: true,
        nextAction: "resolve" as const,
      },
      correlationId: correlation.correlationId,
    }, {
      status: httpStatusFor("INTEGRATION_UNAVAILABLE"),
      headers: {
        "Cache-Control": "no-store",
        "X-Correlation-ID": correlation.correlationId,
      },
    });
  }
}

async function readBody(request: NextRequest): Promise<{ locationId?: string; scope?: string; settings: unknown; overrides?: unknown; action?: string }> {
  const body = (await request.json()) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { settings: null };
  }
  const record = body as Record<string, unknown>;
  return {
    ...(typeof record.locationId === "string" ? { locationId: record.locationId } : {}),
    ...(typeof record.scope === "string" ? { scope: record.scope } : {}),
    ...(Object.hasOwn(record, "overrides") ? { overrides: record.overrides } : {}),
    ...(typeof record.action === "string" ? { action: record.action } : {}),
    settings: record.settings,
  };
}
