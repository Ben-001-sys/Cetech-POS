import { afterEach, expect, test, vi } from "vitest";
import { createBrowserPricingPort } from "./pricingClient";

afterEach(() => vi.useRealTimers());

test("browser price wait is bounded without changing the posted cart", async () => {
  vi.useFakeTimers();
  const request = { cartId: "cart_timeout", cartRevision: 2, locationId: "loc_a1", customer: { kind: "walkin" as const }, lines: [{ lineId: "line_a", productId: "product_a", quantity: "1" }] };
  const fetchImpl = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  const pricing = createBrowserPricingPort({ fetchImpl: fetchImpl as typeof fetch, timeoutMs: 100, correlationId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const result = pricing.quote(request);
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toMatchObject({ ok: false, error: { code: "INTEGRATION_UNAVAILABLE", message: expect.stringContaining("took too long") } });
  expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string)).toEqual(request);
  expect(vi.getTimerCount()).toBe(0);
});
