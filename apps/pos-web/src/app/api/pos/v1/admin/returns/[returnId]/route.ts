import { NextResponse, type NextRequest } from "next/server";
import { readSupabaseInfrastructureEnv } from "@/config/env";
import { composeStaffSessionStore } from "@/server/auth/compose-session-store";
import { composeControlPlaneDirectory } from "@/server/admin/compose-control-plane-directory";
import { handleGetManagementReturnDetail } from "@/server/admin/handle-management-return-detail";
import { createServerRestFetch } from "@/server/http/server-fetch";
import { resolveCorrelationId } from "@/server/http/correlation";
import { httpStatusFor } from "@/server/http/status";
import { composeReturnStore } from "@/server/returns/compose-return-store";
import { composeStaffAssignmentDirectory } from "@/server/sales/compose-assignment-directory";
import { createSupabaseCheckoutStore } from "@/server/sales/supabase-checkout-store";

/** Management detail is a read. Do not route it through return resolution. */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ returnId: string }> },
): Promise<NextResponse> {
  const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
  try {
    const fetchImpl = createServerRestFetch();
    const infrastructure = readSupabaseInfrastructureEnv(process.env);
    const { returnId } = await context.params;
    const result = await handleGetManagementReturnDetail({
      correlationId: correlation.correlationId,
      cookieHeader: request.headers.get("cookie") ?? undefined,
      now: new Date(),
      sessions: composeStaffSessionStore(process.env, fetchImpl),
      assignments: composeStaffAssignmentDirectory(process.env, fetchImpl),
      controlPlane: composeControlPlaneDirectory(process.env),
      returns: composeReturnStore({
        url: infrastructure?.url,
        serviceRoleKey: infrastructure?.serviceRoleKey,
        fetchImpl,
        allowEphemeral: process.env.APP_ENV !== "staging" && process.env.APP_ENV !== "production",
      }),
      sales: infrastructure ? createSupabaseCheckoutStore({
        url: infrastructure.url,
        serviceRoleKey: infrastructure.serviceRoleKey,
        fetchImpl,
      }) : undefined,
      returnId,
    });
    return NextResponse.json(result, {
      status: result.ok ? 200 : httpStatusFor(result.error.code),
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": result.correlationId },
    });
  } catch {
    return NextResponse.json({
      ok: false,
      error: { code: "INTEGRATION_UNAVAILABLE", message: "return details are unavailable", retryable: true, nextAction: "resolve" },
      correlationId: correlation.correlationId,
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": correlation.correlationId },
    });
  }
}
