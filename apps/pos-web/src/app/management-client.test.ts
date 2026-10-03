import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchManagementContext, fetchManagementReturnDetail, fetchManagementReceiptSettings, repairManagementSale, updateManagementReceiptSettings, updateOperationalPolicy } from "./management-client";
import { STAFF_CSRF_COOKIE, STAFF_CSRF_HEADER } from "../config/auth";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("management request completion", () => {
  test.each([null, {}, { ok: true }, { ok: true, data: null, correlationId: "test" }, { ok: false, error: null, correlationId: "test" }])("invalid envelope %j yields a completed failure", async value => {
    const result = await fetchManagementContext(async () => Response.json(value));
    expect(result).toMatchObject({ ok: false, error: { code: "INTEGRATION_UNAVAILABLE" } });
  });

  test("receipt scope mismatch cannot become an editable result", async () => {
    const result = await fetchManagementReceiptSettings({ scope: "location", locationId: "loc_b" }, async () => Response.json({ ok: true, correlationId: "test", data: { scope: "location", locationId: "loc_a" } }));
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.error.message).toContain("another scope");
  });

  test("manager repair supplies CSRF to the original transaction path without creating a request or key", async () => {
    vi.stubGlobal("document", { cookie: `${STAFF_CSRF_COOKIE}=token` });
    let url: unknown;
    let captured: RequestInit | undefined;
    await repairManagementSale("old/transaction", async (input, init) => {
      url = input; captured = init;
      return Response.json({ ok: true, data: {}, correlationId: "test" });
    });
    expect(url).toBe("/api/pos/v1/admin/sales/old%2Ftransaction/recovery");
    expect(captured?.method).toBe("POST");
    expect(captured?.body).toBeUndefined();
    expect(new Headers(captured?.headers).get(STAFF_CSRF_HEADER)).toBe("token");
    expect(new Headers(captured?.headers).get("idempotency-key")).toBeNull();
  });
  test("saved-return review is an exact encoded read without a mutation body", async () => {
    let url: unknown;
    let captured: RequestInit | undefined;
    await fetchManagementReturnDetail("return/a 1", async (input, init) => {
      url = input;
      captured = init;
      return Response.json({ ok: true, data: {}, correlationId: "test" });
    });
    expect(url).toBe("/api/pos/v1/admin/returns/return%2Fa%201");
    expect(captured?.method ?? "GET").toBe("GET");
    expect(captured?.body).toBeUndefined();
  });

  test("organization receipt reads omit location and sparse writes retain explicit false and blank", async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      const body = init?.body ? JSON.parse(String(init.body)) as { locationId?: string } : null;
      return Response.json({ ok: true, data: body ? { scope: "location", locationId: body.locationId } : { scope: "organization", locationId: "" }, correlationId: "test" });
    };
    await fetchManagementReceiptSettings({ scope: "organization" }, fetchImpl);
    await updateManagementReceiptSettings({ scope: "location", locationId: "loc_a", overrides: { showSku: false, presentation: { address: "", logoDataUrl: null } } }, fetchImpl);
    expect(calls[0]?.url).toBe("/api/pos/v1/admin/receipt-settings?scope=organization");
    expect(calls[1]?.body).toEqual({ scope: "location", locationId: "loc_a", overrides: { showSku: false, presentation: { address: "", logoDataUrl: null } } });
  });
  test("releases a read even when fetch ignores abort", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | null | undefined;
    const request = fetchManagementContext(async (_url, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => undefined);
    });
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await request;
    expect(signal?.aborted).toBe(true);
    expect(result).toMatchObject({ ok: false, error: { retryable: true } });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("includes response body parsing in the deadline", async () => {
    vi.useFakeTimers();
    const request = fetchManagementContext(async () => ({
      json: () => new Promise(() => undefined),
    }) as unknown as Response);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await request).toMatchObject({ ok: false, error: { code: "INTEGRATION_UNAVAILABLE" } });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("does not suggest replaying an unconfirmed mutation", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("document", { cookie: `${STAFF_CSRF_COOKIE}=token` });
    let captured: RequestInit | undefined;
    let calls = 0;
    const request = updateOperationalPolicy({ scope: {}, override: {} }, async (_url, init) => {
      captured = init;
      calls += 1;
      return new Promise<Response>(() => undefined);
    });
    await vi.advanceTimersByTimeAsync(44_999);
    expect(captured?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const result = await request;
    expect(result).toMatchObject({ ok: false, error: { retryable: false } });
    if (!result.ok) expect(result.error.message).toContain("check its status before trying again");
    expect(calls).toBe(1);
    expect(captured?.credentials).toBe("include");
    expect(captured?.method).toBe("PATCH");
    expect(new Headers(captured?.headers).get(STAFF_CSRF_HEADER)).toBe("token");
    expect(new Headers(captured?.headers).get("x-correlation-id")).toMatch(/^[\da-f-]{36}$/);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("successful responses clear their deadline", async () => {
    vi.useFakeTimers();
    const data = { ok: true, data: { actorId: "manager_a" }, correlationId: "test" };
    const result = await fetchManagementContext(async () => Response.json(data));
    expect(result).toEqual(data);
    expect(vi.getTimerCount()).toBe(0);
  });
});
