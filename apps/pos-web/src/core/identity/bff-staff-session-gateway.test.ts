import { describe, expect, test } from "vitest";
import { createBffStaffSessionGateway } from "./bff-staff-session-gateway";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = {
  actorId: "cashier_a",
  displayName: "Cashier A",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
  capabilities: [],
  expiresAt: "2099-01-01T00:00:00.000Z",
};

describe("BFF staff session gateway", () => {
  test("does not treat POST session data as register authority when GET fails", async () => {
    const methods: string[] = [];
    const correlations: string[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      correlations.push(new Headers(init?.headers).get("x-correlation-id") ?? "");
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true, data: SESSION, correlationId: CORRELATION }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "INTEGRATION_UNAVAILABLE",
            message: "staff assignment directory is unavailable",
            retryable: true,
            nextAction: "resolve",
            details: { field: "assignments" },
          },
          correlationId: OTHER,
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const gateway = createBffStaffSessionGateway({
      fetchImpl,
      correlationId: () => OTHER,
    });

    const result = await gateway.establish({
      accessToken: "synthetic-access-token",
      correlationId: CORRELATION,
    });

    expect(methods).toEqual(["POST", "GET"]);
    expect(correlations).toEqual([CORRELATION, CORRELATION]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.correlationId).toBe(CORRELATION);
      expect(result.error.code).toBe("INTEGRATION_UNAVAILABLE");
      expect(result.error.details?.field).toBe("assignments");
    }
  });

  test("a transport failure reports the same correlation the request used", async () => {
    const reports: string[] = [];
    const gateway = createBffStaffSessionGateway({
      correlationId: () => OTHER,
      fetchImpl: (async (_url: string, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        if (headers.get("x-cetech-sign-in-report") === "1") {
          reports.push(headers.get("x-correlation-id") ?? "");
          return new Response("{}", { status: 200 });
        }
        throw new TypeError("socket hang up");
      }) as typeof fetch,
    });
    const result = await gateway.establish({
      accessToken: "synthetic-access-token",
      correlationId: CORRELATION,
    });
    expect(result.correlationId).toBe(CORRELATION);
    expect(reports).toEqual([CORRELATION]);
  });
});
