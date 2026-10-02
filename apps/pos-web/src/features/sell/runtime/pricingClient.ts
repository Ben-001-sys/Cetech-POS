import type { PricingPort } from "../../../../../../docs/contracts/ports";
import type { ApiResult } from "../../../../../../docs/contracts/ports";
import type { Quote, QuoteRequest, Uuid } from "../../../../../../docs/contracts/domain.generated";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}

/**
 * Browser PricingPort. Posts the whole-cart QuoteRequest to the BFF.
 * Does not compute provider storefront prices in the browser.
 */
export function createBrowserPricingPort(options: {
  readonly quoteUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly csrfCookie?: string;
  readonly csrfHeader?: string;
  readonly correlationId?: () => Uuid;
  readonly timeoutMs?: number;
} = {}): PricingPort {
  const quoteUrl = options.quoteUrl ?? "/api/pos/v1/quotes";
  const fetchImpl = options.fetchImpl ?? fetch;
  const csrfCookie = options.csrfCookie ?? "cetech_pos_csrf";
  const csrfHeader = options.csrfHeader ?? "x-csrf-token";
  const correlationId = options.correlationId ?? (() => crypto.randomUUID());
  const timeoutMs = options.timeoutMs ?? 60_000;
  return {
    async quote(input: QuoteRequest): Promise<ApiResult<Quote>> {
      const correlation = correlationId();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(quoteUrl, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
            "x-correlation-id": correlation,
            [csrfHeader]: readCookie(csrfCookie) ?? "",
          },
          body: JSON.stringify(input),
          signal: controller.signal,
        });
        const body = (await response.json()) as ApiResult<Quote>;
        return body;
      } catch {
        return {
          ok: false,
          error: {
            code: "INTEGRATION_UNAVAILABLE",
            message: controller.signal.aborted
              ? "Price check took too long. Your cart is saved. Check the price again."
              : "Authoritative quote transport failed.",
            retryable: true,
            nextAction: "retry_same_key",
          },
          correlationId: correlation,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
