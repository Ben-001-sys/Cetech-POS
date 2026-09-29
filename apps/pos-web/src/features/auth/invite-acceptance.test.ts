import { describe, expect, test } from "vitest";
import {
  ACCEPTED_INVITE_COPY,
  acceptStaffInvitation,
  consumeInviteLocation,
  EXPIRED_INVITE_COPY,
  INVALID_INVITE_COPY,
} from "./invite-acceptance";

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "publishable-test-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-must-not-leak",
};

const PASSWORD = "CorrectHorse7Battery";

describe("staff invitation acceptance", () => {
  test("removes invite token material from the address that remains visible", () => {
    const secret = "invite-secret-token-value";
    const consumed = consumeInviteLocation({
      pathname: "/auth/invite",
      search: `?token_hash=${secret}&type=invite`,
      hash: `#access_token=${secret}&refresh_token=${secret}&type=invite`,
    });
    expect(consumed.nextPath).toBe("/auth/invite");
    expect(consumed.nextPath).not.toContain(secret);
    expect(consumed.material).toEqual({ kind: "session", accessToken: secret });
  });

  test("synthetic invite acceptance sets a password and does not assign a role or register", async () => {
    const secret = "verify-hash-secret";
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      calls.push({
        url: String(input),
        headers,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
      });
      if (String(input).endsWith("/auth/v1/verify")) {
        return json(200, { access_token: "session-access-token", token_type: "bearer" });
      }
      return json(200, { id: "user-1" });
    };
    const consumed = consumeInviteLocation({
      pathname: "/auth/invite",
      search: `?type=invite&token_hash=${secret}`,
      hash: "",
    });
    const result = await acceptStaffInvitation({
      material: consumed.material,
      password: PASSWORD,
      fetchImpl,
      env: ENV,
    });
    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      "https://project.supabase.co/auth/v1/verify",
      "https://project.supabase.co/auth/v1/user",
      "https://project.supabase.co/auth/v1/logout",
    ]);
    expect(calls[0]?.body).toEqual({ type: "invite", token_hash: secret });
    expect(calls[1]?.body).toEqual({ password: PASSWORD });
    const serialized = JSON.stringify(calls);
    expect(serialized).not.toContain("service-role-must-not-leak");
    expect(serialized).not.toContain("/admin/");
    expect(serialized).not.toContain("assignment");
    expect(serialized).not.toContain("control_role");
    expect(calls[1]?.headers.authorization).toBe("Bearer session-access-token");
  });

  test("an expired invitation does not set a password", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return json(403, { error_code: "otp_expired", msg: "Token has expired" });
    };
    const result = await acceptStaffInvitation({
      material: { kind: "verify", tokenHash: "expired-token" },
      password: PASSWORD,
      fetchImpl,
      env: ENV,
    });
    expect(result).toEqual({ ok: false, reason: "expired", message: EXPIRED_INVITE_COPY });
    expect(calls).toEqual(["https://project.supabase.co/auth/v1/verify"]);
    expect(EXPIRED_INVITE_COPY).not.toContain("expired-token");
  });

  test("a missing invitation is invalid and makes no Auth call", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return json(200, {});
    };
    const consumed = consumeInviteLocation({ pathname: "/auth/invite", search: "", hash: "" });
    expect(consumed.material.kind).toBe("missing");
    const result = await acceptStaffInvitation({
      material: consumed.material,
      password: PASSWORD,
      fetchImpl,
      env: ENV,
    });
    expect(result).toEqual({ ok: false, reason: "invalid", message: INVALID_INVITE_COPY });
    expect(called).toBe(false);
  });

  test("accepted copy does not claim a role or register was assigned", () => {
    expect(ACCEPTED_INVITE_COPY).toContain("assign your access");
    expect(ACCEPTED_INVITE_COPY.toLowerCase()).not.toContain("you are now a");
  });
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
