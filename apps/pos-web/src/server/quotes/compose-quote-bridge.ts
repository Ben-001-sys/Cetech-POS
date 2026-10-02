import { createHash } from "node:crypto";
import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Quote, QuoteRequest, Uuid } from "../../../../../docs/contracts/domain.generated";
import { readBridgeServiceEnv } from "../../config/env";
import { authFailure } from "../auth/errors";
import { createBridgeServiceIdentity } from "../health/bridge-adapter";
import type { PosRestFetch } from "../http/server-fetch";

// Only active work is shared: no price cache, and no reuse after completion.
// Authorization remains per request in handleQuote, before this boundary.
const inFlightQuotes = new Map<string, Promise<ApiResult<Quote>>>();
const MAX_TRACKED_QUOTES = 64;

export function quotesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/wp-json/cetech-pos/v1/quotes")) {
    return trimmed;
  }
  if (trimmed.endsWith("/wp-json/cetech-pos/v1")) {
    return `${trimmed}/quotes`;
  }
  return `${trimmed}/wp-json/cetech-pos/v1/quotes`;
}

export function composeQuoteBridge(
  env: Readonly<Record<string, string | undefined>>,
  fetchImpl: PosRestFetch | undefined,
  options: { readonly timeoutMs?: number } = {},
): { postQuote(request: QuoteRequest, correlationId: Uuid, organizationId?: string): Promise<ApiResult<Quote>> } | undefined {
  const identity = readBridgeServiceEnv(env);
  if (!identity || !fetchImpl) {
    return undefined;
  }
  const service = createBridgeServiceIdentity({
    username: identity.username,
    applicationPassword: identity.applicationPassword,
  });
  const url = quotesUrl(identity.baseUrl);
  const timeoutMs = options.timeoutMs ?? 45_000;
  return {
    async postQuote(request, correlationId, organizationId) {
      const started = performance.now();
      const key = organizationId ? createHash("sha256")
        .update(JSON.stringify([url, identity.username, organizationId, request])).digest("hex") : null;
      const existing = key ? inFlightQuotes.get(key) : undefined;
      const operation = existing ?? (async (): Promise<ApiResult<Quote>> => {
        try {
          const response = await fetchImpl(url, {
            method: "POST",
            headers: {
              authorization: service.authorizationHeader,
              "content-type": "application/json",
              "x-correlation-id": correlationId,
            },
            body: JSON.stringify(request),
            signal: AbortSignal.timeout(timeoutMs),
          });
          const json = (await response.json()) as ApiResult<Quote>;
          if (!json || typeof json !== "object" || !("ok" in json)) {
            return authFailure(
              "INTEGRATION_UNAVAILABLE",
              "quote bridge returned an invalid envelope",
              correlationId,
            );
          }
          return json;
        } catch {
          return authFailure("INTEGRATION_UNAVAILABLE", "Price check could not finish. Check the price again.", correlationId);
        }
      })();
      if (key && !existing && inFlightQuotes.size < MAX_TRACKED_QUOTES) {
        inFlightQuotes.set(key, operation);
      }
      try {
        const result = await operation;
        console.info(JSON.stringify({
          event: "quote_bridge_timing", correlationId,
          elapsedMs: Math.round(performance.now() - started),
          coalesced: Boolean(existing), ok: result.ok,
        }));
        return { ...result, correlationId };
      } finally {
        if (key && inFlightQuotes.get(key) === operation) {
          inFlightQuotes.delete(key);
        }
      }
    },
  };
}
