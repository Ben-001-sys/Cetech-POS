import { NextResponse, type NextRequest } from "next/server";
import { staffAllowedOrigins } from "../../../../../config/env";
import { composeStaffSessionStore } from "../../../../../server/auth/compose-session-store";
import { STAFF_CSRF_HEADER } from "../../../../../config/auth";
import { createServerRestFetch } from "../../../../../server/http/server-fetch";
import { composeCatalogProjectionStore } from "../../../../../server/catalog/catalog-projection-store";
import { composeQuoteBridge } from "../../../../../server/quotes/compose-quote-bridge";
import { handleQuote } from "../../../../../server/quotes/handle-quote";
import { httpStatusFor } from "../../../../../server/http/status";
import { authFailure } from "../../../../../server/auth/errors";
import { resolveCorrelationId } from "../../../../../server/http/correlation";
import { composeCheckoutRuntime } from "../../../../../server/sales/compose-checkout-runtime";
import { composeStaffAssignmentDirectory } from "../../../../../server/sales/compose-assignment-directory";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const started = performance.now();
  const stages: Record<string, number> = {};
  const fetchImpl = createServerRestFetch();
  let sessionStore;
  let snapshots;
  let bridge;
  let catalogIdentity;
  let assignments;
  try {
    sessionStore = composeStaffSessionStore(process.env, fetchImpl);
    snapshots = composeCheckoutRuntime(process.env, fetchImpl).store;
    bridge = composeQuoteBridge(process.env, fetchImpl);
    catalogIdentity = composeCatalogProjectionStore(process.env, fetchImpl);
    assignments = composeStaffAssignmentDirectory(process.env, fetchImpl);
  } catch {
    const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
    const body = authFailure(
      "INTEGRATION_UNAVAILABLE",
      "durable staff session, checkout, and catalog identity stores are required",
      correlation.correlationId,
    );
    return NextResponse.json(body, {
      status: httpStatusFor(body.error.code),
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": body.correlationId },
    });
  }
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const result = await handleQuote({
    correlationIdHeader: request.headers.get("x-correlation-id") ?? undefined,
    origin: request.headers.get("origin"),
    referer: request.headers.get("referer"),
    cookieHeader: request.headers.get("cookie") ?? undefined,
    csrfHeader: request.headers.get(STAFF_CSRF_HEADER),
    body,
    now: new Date(),
    sessionStore,
    assignments,
    allowedOrigins: staffAllowedOrigins(),
    bridge,
    snapshots,
    catalogIdentity,
    onStageComplete: (stage, elapsedMs) => { stages[stage] = elapsedMs; },
  }).catch(() => {
    const correlation = resolveCorrelationId(request.headers.get("x-correlation-id") ?? undefined);
    const failure = authFailure("INTEGRATION_UNAVAILABLE", "Price check could not finish. Check the price again.", correlation.correlationId);
    return { status: httpStatusFor(failure.error.code), body: failure,
      headers: { "Cache-Control": "no-store", "X-Correlation-ID": correlation.correlationId } };
  });
  console.info(JSON.stringify({
    event: "quote_request_timing", correlationId: result.body.correlationId,
    elapsedMs: Math.round(performance.now() - started), status: result.status, stages,
  }));
  return NextResponse.json(result.body, {
    status: result.status,
    headers: result.headers,
  });
}
