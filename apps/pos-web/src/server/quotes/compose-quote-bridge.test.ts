import { describe, expect, test, vi } from "vitest";
import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Quote, QuoteRequest } from "../../../../../docs/contracts/domain.generated";
import { composeQuoteBridge } from "./compose-quote-bridge";

const env = { BRIDGE_BASE_URL: "https://woo.example.test", BRIDGE_USERNAME: "quote-service", BRIDGE_APPLICATION_PASSWORD: "test-only-application-password" };
const request: QuoteRequest = {
  cartId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", cartRevision: 1,
  customer: { kind: "walkin" }, locationId: "loc_a1",
  lines: [{ lineId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", productId: "123", quantity: "1" }],
};
const firstId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const secondId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("quote transport coordination", () => {
  test("equivalent concurrent requests share only active work and retain each caller's reference", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const result: ApiResult<Quote> = { ok: false, correlationId: firstId, error: { code: "INTEGRATION_UNAVAILABLE", message: "test failure", retryable: true, nextAction: "resolve" } };
    const fetchImpl = vi.fn(async () => { await gate; return { ok: false, status: 503, json: async () => result }; });
    const a = composeQuoteBridge(env, fetchImpl)!;
    const b = composeQuoteBridge(env, fetchImpl)!;
    const first = a.postQuote(request, firstId, "org_shared");
    const second = b.postQuote({ ...request, lines: request.lines.map((line) => ({ ...line })) }, secondId, "org_shared");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    release();
    expect((await first).correlationId).toBe(firstId);
    expect((await second).correlationId).toBe(secondId);
    await a.postQuote(request, firstId, "org_shared");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("different organizations, revisions and customers never share a price request", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: false, correlationId: firstId, error: { code: "INTEGRATION_UNAVAILABLE" } }) }));
    const bridge = composeQuoteBridge(env, fetchImpl)!;
    await Promise.all([
      bridge.postQuote(request, firstId, "org_one"),
      bridge.postQuote(request, secondId, "org_two"),
      bridge.postQuote({ ...request, cartRevision: 2 }, secondId, "org_one"),
      bridge.postQuote({ ...request, customer: { kind: "retail", customerId: "cust_two" } }, secondId, "org_one"),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  test("a hung upstream is aborted and returns a typed failure", async () => {
    const bridge = composeQuoteBridge(env, async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
    }), { timeoutMs: 5 })!;
    const pending = bridge.postQuote(request, firstId, "org_timeout");
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(await pending).toMatchObject({ ok: false, error: { code: "INTEGRATION_UNAVAILABLE" }, correlationId: firstId });
  });
});
