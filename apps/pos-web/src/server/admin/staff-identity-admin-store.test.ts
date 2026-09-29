import { describe, expect, test } from "vitest";
import type { PosRestFetch } from "../http/server-fetch";
import { createSupabaseStaffIdentityAdminStore } from "./staff-identity-admin-store";

function jsonResult(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

describe("Supabase staff invitation delivery", () => {
  test("sends redirect_to on the existing invite endpoint and does not follow a caller redirect", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: PosRestFetch = async (url, init) => {
      calls.push({ url, body: init.body ? JSON.parse(init.body) : null });
      if (url.includes("/auth/v1/invite?")) {
        return jsonResult(200, { id: "user-1", email: "new.staff@example.com" });
      }
      if (url.includes("/auth/v1/admin/users/user-1")) {
        return jsonResult(200, { id: "user-1", email: "new.staff@example.com" });
      }
      return jsonResult(500, {});
    };
    const store = createSupabaseStaffIdentityAdminStore({
      url: "https://project.supabase.co",
      serviceRoleKey: "service-role-test",
      fetchImpl,
      allowLocalhostInvitationRedirect: false,
    });
    const result = await store.invite({
      organizationId: "org_a",
      email: "new.staff@example.com",
      displayName: "New Staff",
      redirectTo: "https://pos-staging.example.com/auth/invite",
    });
    expect(result).toMatchObject({ authUserId: "user-1", email: "new.staff@example.com" });
    expect(calls[0]?.url).toBe(
      "https://project.supabase.co/auth/v1/invite?redirect_to=https%3A%2F%2Fpos-staging.example.com%2Fauth%2Finvite",
    );
    expect(calls[0]?.body).toEqual({
      email: "new.staff@example.com",
      data: { display_name: "New Staff" },
    });
    expect(JSON.stringify(calls[0]?.body)).not.toContain("evil.example");
  });

  test("an existing account stops before metadata update", async () => {
    const calls: string[] = [];
    const fetchImpl: PosRestFetch = async (url) => {
      calls.push(url);
      return jsonResult(422, { error_code: "email_exists", msg: "already registered" });
    };
    const store = createSupabaseStaffIdentityAdminStore({
      url: "https://project.supabase.co",
      serviceRoleKey: "service-role-test",
      fetchImpl,
      allowLocalhostInvitationRedirect: false,
    });
    const result = await store.invite({
      organizationId: "org_a",
      email: "existing@example.com",
      displayName: "Existing",
      redirectTo: "https://pos-staging.example.com/auth/invite",
    });
    expect(result).toBe("conflict");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/auth/v1/invite?");
  });

  test("deployed localhost redirect fails before delivery", async () => {
    let called = false;
    const fetchImpl: PosRestFetch = async () => {
      called = true;
      return jsonResult(200, {});
    };
    const store = createSupabaseStaffIdentityAdminStore({
      url: "https://project.supabase.co",
      serviceRoleKey: "service-role-test",
      fetchImpl,
      allowLocalhostInvitationRedirect: false,
    });
    const result = await store.invite({
      organizationId: "org_a",
      email: "new.staff@example.com",
      displayName: "New Staff",
      redirectTo: "http://localhost:3000/auth/invite",
    });
    expect(result).toBe("unavailable");
    expect(called).toBe(false);
  });

  test("local development may invite to localhost", async () => {
    const calls: string[] = [];
    const fetchImpl: PosRestFetch = async (url) => {
      calls.push(url);
      if (url.includes("/auth/v1/invite?")) {
        return jsonResult(200, { id: "user-2", email: "local@example.com" });
      }
      return jsonResult(200, { id: "user-2" });
    };
    const store = createSupabaseStaffIdentityAdminStore({
      url: "http://127.0.0.1:54321",
      serviceRoleKey: "service-role-test",
      fetchImpl,
      allowLocalhostInvitationRedirect: true,
    });
    const result = await store.invite({
      organizationId: "org_a",
      email: "local@example.com",
      displayName: "Local",
      redirectTo: "http://localhost:3000/auth/invite",
    });
    expect(result).toMatchObject({ authUserId: "user-2" });
    expect(calls[0]).toContain("redirect_to=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Finvite");
  });
});
