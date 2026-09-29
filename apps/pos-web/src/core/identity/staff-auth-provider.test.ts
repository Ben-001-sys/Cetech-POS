import { describe, expect, test } from "vitest";
import {
  classifySupabasePasswordGrantFailure,
  createPublicSupabaseStaffAuthProvider,
  StaffAuthError,
} from "./staff-auth-provider";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-test-key",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("supabase password grant classification", () => {
  test("maps invalid_credentials and invalid_grant to credential rejection", () => {
    expect(classifySupabasePasswordGrantFailure(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" })).toBe(
      "invalid_credentials",
    );
    expect(classifySupabasePasswordGrantFailure(400, { error: "invalid_grant", error_description: "Invalid login credentials" })).toBe(
      "invalid_credentials",
    );
  });

  test("maps a banned provider account to disabled access", () => {
    expect(classifySupabasePasswordGrantFailure(400, { error_code: "user_banned" })).toBe("access_disabled");
  });

  test("keeps transport failure distinct from a rejected password", () => {
    expect(classifySupabasePasswordGrantFailure(500, { error: "server_error" })).toBe("provider_unavailable");
    expect(classifySupabasePasswordGrantFailure(503, null)).toBe("provider_unavailable");
  });

  test("sign-in uses the provider classification and does not call the network when offline", async () => {
    let calls = 0;
    const provider = createPublicSupabaseStaffAuthProvider({
      env: ENV,
      isOnline: () => false,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse(400, { error_code: "invalid_credentials" });
      },
    });
    await expect(provider.signIn({ email: "cashier@example.com", password: "wrong" })).rejects.toMatchObject({
      kind: "offline",
    });
    expect(calls).toBe(0);
  });

  test("a 400 invalid_credentials response is not an outage", async () => {
    const provider = createPublicSupabaseStaffAuthProvider({
      env: ENV,
      isOnline: () => true,
      fetchImpl: async () => jsonResponse(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" }),
    });
    await expect(provider.signIn({ email: "cashier@example.com", password: "wrong" })).rejects.toBeInstanceOf(StaffAuthError);
    await expect(provider.signIn({ email: "cashier@example.com", password: "wrong" })).rejects.toMatchObject({
      kind: "invalid_credentials",
    });
  });

  test("a provider 500 is unavailable", async () => {
    const provider = createPublicSupabaseStaffAuthProvider({
      env: ENV,
      fetchImpl: async () => jsonResponse(500, { msg: "timeout" }),
    });
    await expect(provider.signIn({ email: "cashier@example.com", password: "secret" })).rejects.toMatchObject({
      kind: "provider_unavailable",
    });
  });

  test("a timed-out password grant is a support failure with one reference", async () => {
    let signal: AbortSignal | undefined;
    const reports: string[] = [];
    const provider = createPublicSupabaseStaffAuthProvider({
      env: ENV,
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("x-cetech-sign-in-report") === "1") {
          reports.push(headers.get("x-correlation-id") ?? "");
          return jsonResponse(200, {});
        }
        signal = init?.signal ?? undefined;
        throw new DOMException("timed out", "TimeoutError");
      },
    });
    let thrown: unknown;
    try {
      await provider.signIn({ email: "cashier@example.com", password: "secret" });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({
      kind: "provider_unavailable",
      correlationId: reports[0],
    });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(reports).toHaveLength(1);
  });

  test("a successful password grant keeps the attempt correlation", async () => {
    let minted = 0;
    const provider = createPublicSupabaseStaffAuthProvider({
      env: ENV,
      correlationId: () => {
        minted += 1;
        return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      },
      isOnline: () => true,
      fetchImpl: async () => jsonResponse(200, {
        access_token: "access-token-value",
        refresh_token: "refresh-token-value",
      }),
    });
    await expect(provider.signIn({ email: " ", password: "" })).rejects.toMatchObject({
      kind: "credentials_required",
    });
    expect(minted).toBe(0);
    await expect(provider.signIn({ email: "cashier@example.com", password: "secret" })).resolves.toEqual({
      accessToken: "access-token-value",
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(minted).toBe(1);
  });
});
