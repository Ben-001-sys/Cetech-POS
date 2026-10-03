import { NextResponse, type NextRequest } from "next/server";
import { STAFF_CSRF_COOKIE, STAFF_CSRF_HEADER } from "@/config/auth";
import { staffAllowedOrigins } from "@/config/env";
import { composeAdminAuditStore } from "@/server/admin/compose-admin-audit-store";
import { composeControlPlaneDirectory } from "@/server/admin/compose-control-plane-directory";
import { handleGetManagementSaleRecovery, handleRepairManagementSale } from "@/server/admin/handle-management-sale-recovery";
import { composeManagementSaleRecoveryStore } from "@/server/admin/management-sale-recovery-store";
import { parseCookieHeader } from "@/server/auth/cookies";
import { apiFailure } from "@/server/http/api-failure";
import { resolveCorrelationId } from "@/server/http/correlation";
import { httpStatusFor } from "@/server/http/status";
import { composePosCommandHandlers } from "@/server/sales/compose-pos-command-runtime";

type RouteContext = { params: Promise<{ transactionId: string }> };

async function respond(request: NextRequest, context: RouteContext, mutation: boolean): Promise<NextResponse> {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
  const composed = composePosCommandHandlers(request);
  if (!composed.ok) return composed.response;
  try {
    const { transactionId } = await context.params;
    const input = {
      transactionId, correlationId: correlation.correlationId,
      cookieHeader: request.headers.get("cookie") ?? undefined, now: new Date(),
      sessions: composed.sessionStore, assignments: composed.assignments,
      controlPlane: composeControlPlaneDirectory(process.env), originals: composeManagementSaleRecoveryStore(process.env),
      checkoutStore: composed.runtime.store, salesPort: composed.runtime.salesPort,
    };
    const result = !correlation.ok ? apiFailure("VALIDATION_ERROR", "X-Correlation-ID must be a UUID", correlation.correlationId)
      : mutation ? await handleRepairManagementSale({
        ...input, audit: composeAdminAuditStore(process.env), catalogLookup: composed.runtime.catalogLookup,
        protection: {
          origin: request.headers.get("origin"), referer: request.headers.get("referer"),
          csrfCookie: parseCookieHeader(request.headers.get("cookie") ?? undefined)[STAFF_CSRF_COOKIE] ?? null,
          csrfHeader: request.headers.get(STAFF_CSRF_HEADER), allowedOrigins: staffAllowedOrigins(),
        },
      }) : await handleGetManagementSaleRecovery(input);
    return NextResponse.json(result, {
      status: result.ok ? 200 : httpStatusFor(result.error.code),
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": result.correlationId },
    });
  } catch {
    const result = apiFailure("INTEGRATION_UNAVAILABLE", "Sale recovery is unavailable. Keep this same sale and check again.", correlation.correlationId);
    return NextResponse.json(result, { status: httpStatusFor(result.error.code), headers: { "Cache-Control": "no-store", "X-Correlation-ID": result.correlationId } });
  }
}

export function GET(request: NextRequest, context: RouteContext) { return respond(request, context, false); }
export function POST(request: NextRequest, context: RouteContext) { return respond(request, context, true); }
