import type { ApiResult } from "../../../../docs/contracts/ports";
import type { Uuid } from "../../../../docs/contracts/domain.generated";
import type { CatalogSyncPage } from "../core/catalog/sync-page";

export const CATALOG_SYNC_REQUEST_TIMEOUT_MS = 20_000;

export type BrowserCatalogSyncQuery = {
  readonly cursor?: string;
  readonly limit?: number;
  readonly modifiedAfter?: string;
};

/**
 * Browser CatalogPort never talks to Woo. This client only calls the POS BFF.
 * Bridge credentials stay server-side.
 */
export function createBrowserCatalogSyncClient(options: {
  readonly syncUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly correlationId?: () => Uuid;
  readonly timeoutMs?: number;
} = {}): {
  fetchPage(query: BrowserCatalogSyncQuery): Promise<ApiResult<CatalogSyncPage>>;
} {
  const syncUrl = options.syncUrl ?? "/api/pos/v1/catalog/sync";
  const fetchImpl = options.fetchImpl ?? fetch;
  const correlationId = options.correlationId ?? (() => crypto.randomUUID());
  const timeoutMs = options.timeoutMs ?? CATALOG_SYNC_REQUEST_TIMEOUT_MS;
  return {
    async fetchPage(query) {
      const correlation = correlationId();
      const url = withQuery(syncUrl, query);
      try {
        const response = await fetchImpl(url, {
          method: "GET",
          credentials: "include",
          headers: {
            accept: "application/json",
            "x-correlation-id": correlation,
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = (await response.json()) as ApiResult<CatalogSyncPage>;
        return body;
      } catch {
        return {
          ok: false,
          error: {
            code: "INTEGRATION_UNAVAILABLE",
            message: "catalog producer is unavailable",
            retryable: true,
            nextAction: "resolve",
          },
          correlationId: correlation,
        };
      }
    },
  };
}

function withQuery(url: string, query: BrowserCatalogSyncQuery): string {
  const origin = "https://pos.invalid";
  const parsed = url.startsWith("http") ? new URL(url) : new URL(url, origin);
  if (query.cursor) {
    parsed.searchParams.set("cursor", query.cursor);
  }
  if (query.limit !== undefined) {
    parsed.searchParams.set("limit", String(query.limit));
  }
  if (query.modifiedAfter) {
    parsed.searchParams.set("modifiedAfter", query.modifiedAfter);
  }
  if (url.startsWith("http")) {
    return parsed.toString();
  }
  return `${parsed.pathname}${parsed.search}`;
}
