import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Quote, QuoteRequest, Uuid } from "../../../../../docs/contracts/domain.generated";
import { STAFF_CSRF_COOKIE, STAFF_SESSION_COOKIE } from "../../config/auth";
import { authFailure } from "../auth/errors";
import { assertMutationProtection } from "../auth/csrf";
import { parseCookieHeader } from "../auth/cookies";
import type { StaffSessionStore } from "../auth/session-store";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import { resolveCorrelationId } from "../http/correlation";
import { httpStatusFor } from "../http/status";
import {
  collectQuoteIdentityItemIds,
  restoreQuoteToPosIds,
  translateQuoteRequestToProvider,
  REQUIRED_QUOTE_SOURCE_SYSTEM,
} from "../catalog/catalog-identity";
import type { CatalogProjectionStore } from "../catalog/catalog-projection-store";
import { isQuote, isQuoteRequest } from "./canonical-schema";

export type QuoteBridge = {
  postQuote(request: QuoteRequest, correlationId: Uuid, organizationId?: string): Promise<ApiResult<Quote>>;
};

export type HandleQuoteInput = {
  readonly correlationIdHeader?: string;
  readonly origin: string | null;
  readonly referer: string | null;
  readonly cookieHeader?: string;
  readonly csrfHeader?: string | null;
  readonly body: unknown;
  readonly now: Date;
  readonly sessionStore: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly allowedOrigins: readonly string[];
  readonly bridge?: QuoteBridge;
  readonly snapshots?: { saveQuote(quote: Quote): Promise<void> };
  readonly catalogIdentity?: Pick<CatalogProjectionStore, "loadByItemIds">;
  readonly onStageComplete?: (stage: string, elapsedMs: number) => void;
};

export type HandleQuoteResponse = {
  readonly status: number;
  readonly body: ApiResult<Quote>;
  readonly headers: { readonly "Cache-Control": "no-store"; readonly "X-Correlation-ID": Uuid };
};

export async function handleQuote(input: HandleQuoteInput): Promise<HandleQuoteResponse> {
  async function timed<T>(stage: string, action: () => Promise<T>): Promise<T> {
    const started = performance.now();
    try { return await action(); }
    finally { input.onStageComplete?.(stage, Math.round(performance.now() - started)); }
  }
  const correlation = resolveCorrelationId(input.correlationIdHeader);
  const headers = { "Cache-Control": "no-store" as const, "X-Correlation-ID": correlation.correlationId };
  if (!correlation.ok) {
    const body = authFailure("VALIDATION_ERROR", "X-Correlation-ID must be a UUID", correlation.correlationId);
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  const protection = assertMutationProtection({
    origin: input.origin,
    referer: input.referer,
    csrfCookie: readCookie(input.cookieHeader, STAFF_CSRF_COOKIE),
    csrfHeader: input.csrfHeader ?? null,
    allowedOrigins: input.allowedOrigins,
  });
  if (!protection.ok) {
    const body = authFailure(
      "FORBIDDEN",
      protection.reason === "csrf"
        ? "mutation requires matching CSRF cookie and header"
        : "mutation origin is not allowed",
      correlation.correlationId,
    );
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  const sessionId = readCookie(input.cookieHeader, STAFF_SESSION_COOKIE);
  let stored = null;
  try {
    stored = sessionId ? await timed("session", () => input.sessionStore.get(sessionId, input.now)) : null;
  } catch {
    const body = authFailure("INTEGRATION_UNAVAILABLE", "staff session store is unavailable", correlation.correlationId);
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  if (!stored) {
    const body = authFailure("AUTH_REQUIRED", "staff session is required", correlation.correlationId);
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  if (stored.mustChangePassword === true) {
    const body = authFailure("FORBIDDEN", "Create a new password before continuing.", correlation.correlationId);
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  const organizationId = stored.session.organizationId;
  const request = parseQuoteRequest(input.body);
  if (!request) {
    const body = authFailure("VALIDATION_ERROR", "QuoteRequest is invalid", correlation.correlationId);
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  const assignments = await timed("assignments", () => input.assignments.lookup({
    actorId: stored.session.actorId,
    organizationId,
  }));
  if (assignments === "unavailable") {
    const body = authFailure(
      "INTEGRATION_UNAVAILABLE",
      "staff assignment directory is unavailable",
      correlation.correlationId,
    );
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  if (!assignments.locationIds.includes(request.locationId)) {
    const body = authFailure("FORBIDDEN", "location is out of staff scope", correlation.correlationId);
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  if (!input.catalogIdentity) {
    const body = authFailure(
      "INTEGRATION_UNAVAILABLE",
      "catalog identity mapping is unavailable",
      correlation.correlationId,
    );
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  if (!input.bridge) {
    const body = authFailure(
      "INTEGRATION_UNAVAILABLE",
      "authoritative quote bridge is not configured",
      correlation.correlationId,
    );
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  let mappings;
  try {
    mappings = await timed("catalogIdentity", () => input.catalogIdentity!.loadByItemIds(
      organizationId,
      collectQuoteIdentityItemIds(request),
    ));
  } catch {
    const body = authFailure(
      "INTEGRATION_UNAVAILABLE",
      "catalog identity mapping is unavailable",
      correlation.correlationId,
    );
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  const translated = translateQuoteRequestToProvider({
    request,
    requiredSourceSystem: REQUIRED_QUOTE_SOURCE_SYSTEM,
    mappings,
  });
  if (!translated.ok) {
    const body = authFailure("INTEGRATION_UNAVAILABLE", translated.message, correlation.correlationId);
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  const result = await timed("bridge", () => input.bridge!.postQuote(
    translated.value.request, correlation.correlationId, organizationId,
  ));
  if (!result.ok) {
    return { status: httpStatusFor(result.error.code), body: result, headers };
  }
  const restored = restoreQuoteToPosIds({ quote: result.data, translation: translated.value });
  if (!restored.ok) {
    const body = authFailure(
      "INTEGRATION_UNAVAILABLE",
      isQuote(result.data) ? restored.message : "quote bridge returned an invalid Quote",
      correlation.correlationId,
    );
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  if (!isQuote(restored.value)) {
    const body = authFailure(
      "INTEGRATION_UNAVAILABLE",
      "quote bridge returned an invalid Quote",
      correlation.correlationId,
    );
    return { status: httpStatusFor(body.error.code), body, headers };
  }
  if (input.snapshots) {
    await timed("saveSnapshot", () => input.snapshots!.saveQuote(restored.value));
  }
  return { status: 200, body: { ok: true, data: restored.value, correlationId: result.correlationId }, headers };
}

function readCookie(header: string | undefined, name: string): string | null {
  return parseCookieHeader(header)[name] ?? null;
}

function parseQuoteRequest(body: unknown): QuoteRequest | null {
  return isQuoteRequest(body) ? body : null;
}
