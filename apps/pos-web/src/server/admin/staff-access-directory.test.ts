import { afterEach, describe, expect, test, vi } from "vitest";
import type { PosRestFetch } from "../http/server-fetch";
import { createSupabaseStaffAccessDirectory } from "./staff-access-directory";

const ACTOR = "a1111111-1111-4111-8111-111111111111";
const AUTH_USER = "b2222222-2222-4222-8222-222222222222";

function authUser(overrides: Record<string, unknown> = {}) {
  // GoTrue admin/users returns { users, aud }. Auth id and the POS actor id
  // are separate; only server-owned app_metadata supplies the mapping.
  return {
    id: AUTH_USER,
    aud: "authenticated",
    email: "ama@example.test",
    app_metadata: { provider: "email", providers: ["email"], actor_id: ACTOR, organization_id: "org_a" },
    user_metadata: { display_name: "Ama Mensah" },
    created_at: "2026-09-22T12:00:00.000Z",
    last_sign_in_at: "2026-10-03T06:30:00.000Z",
    banned_until: null,
    deleted_at: null,
    ...overrides,
  };
}

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function setup(input: {
  readonly auth?: (page: number) => ReturnType<PosRestFetch>;
  readonly locations?: unknown;
  readonly registers?: unknown;
  readonly memberships?: unknown;
  readonly access?: unknown;
  readonly timeoutMs?: number;
} = {}) {
  const fetchImpl = vi.fn<PosRestFetch>(async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname === "/auth/v1/admin/users") {
      return input.auth ? input.auth(Number(parsed.searchParams.get("page"))) : response({ users: [authUser()], aud: "authenticated" });
    }
    if (parsed.pathname.endsWith("pos_staff_location_assignments")) {
      return response(input.locations ?? [{ actor_id: ACTOR, location_id: "loc_a1", role: "manager" }]);
    }
    if (parsed.pathname.endsWith("pos_staff_register_assignments")) {
      return response(input.registers ?? [{ actor_id: ACTOR, location_id: "loc_a1", register_id: "reg_a" }]);
    }
    if (parsed.pathname.endsWith("pos_organization_memberships")) {
      return response(input.memberships ?? [{ actor_id: ACTOR, control_role: "owner", status: "active" }]);
    }
    if (parsed.pathname.endsWith("pos_staff_access_controls")) return response(input.access ?? []);
    throw new Error(`unexpected synthetic request ${parsed.pathname}`);
  });
  return {
    fetchImpl,
    directory: createSupabaseStaffAccessDirectory({ url: "https://pos.example.test", serviceRoleKey: "synthetic-key", fetchImpl, timeoutMs: input.timeoutMs }),
  };
}

afterEach(() => vi.useRealTimers());

describe("staff directory identity consolidation", () => {
  test("actual admin/users response shape joins the distinct Auth id by actor and organization", async () => {
    const { directory } = setup();
    expect(await directory.listOrganization({ organizationId: "org_a" })).toEqual([{
      actorId: ACTOR,
      displayName: "Ama Mensah",
      email: "ama@example.test",
      identityStatus: "linked",
      authStatus: "active",
      posAccessStatus: "active",
      controlRole: "owner",
      locations: [{ locationId: "loc_a1", role: "manager", registerIds: ["reg_a"] }],
      createdAt: "2026-09-22T12:00:00.000Z",
      lastSignInAt: "2026-10-03T06:30:00.000Z",
    }]);
  });

  test("preserves email and login state when the staff account appears on a later page", async () => {
    const { directory, fetchImpl } = setup({
      auth: async (page) => response({ users: page === 1 ? Array.from({ length: 200 }, (_, i) => ({ id: `unrelated-${i}`, app_metadata: { provider: "email" } })) : [authUser()], aud: "authenticated" }),
    });
    const rows = await directory.listOrganization({ organizationId: "org_a" });
    expect(rows).toMatchObject([{ actorId: ACTOR, email: "ama@example.test", authStatus: "active", identityStatus: "linked" }]);
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes("/admin/users")).map(([url]) => new URL(url).searchParams.get("page"))).toEqual(["1", "2"]);
  });

  test("does not join a different organization or user-editable identity claims", async () => {
    const { directory } = setup({
      auth: async () => response({ users: [
        authUser({ app_metadata: { actor_id: ACTOR, organization_id: "org_b" } }),
        authUser({ id: "another-id", app_metadata: { provider: "email" }, user_metadata: { actor_id: ACTOR, organization_id: "org_a", display_name: "Untrusted claim" } }),
      ] }),
    });
    const rows = await directory.listOrganization({ organizationId: "org_a" });
    expect(rows).toMatchObject([{ actorId: ACTOR, displayName: "Unlinked staff reference", identityStatus: "unlinked", authStatus: "unknown" }]);
    expect(rows).not.toEqual(expect.arrayContaining([expect.objectContaining({ email: "ama@example.test" })]));
  });

  test("keeps missing identities and access-only references without inventing disabled Auth accounts", async () => {
    const { directory } = setup({ auth: async () => response({ users: [] }), access: [{ actor_id: "historical_actor", status: "disabled" }] });
    const rows = await directory.listOrganization({ organizationId: "org_a" });
    expect(rows).toMatchObject([
      { actorId: ACTOR, identityStatus: "unlinked", authStatus: "unknown", posAccessStatus: "active" },
      { actorId: "historical_actor", identityStatus: "unlinked", authStatus: "unknown", posAccessStatus: "disabled" },
    ]);
  });

  test.each([
    { banned_until: "2099-01-01T00:00:00.000Z" },
    { deleted_at: "2026-10-01T00:00:00.000Z" },
  ])("distinguishes a linked disabled login account from an unlinked reference (%j)", async (disabled) => {
    const { directory } = setup({ auth: async () => response({ users: [authUser(disabled)] }) });
    expect(await directory.listOrganization({ organizationId: "org_a" })).toMatchObject([{ identityStatus: "linked", authStatus: "disabled", email: "ama@example.test" }]);
  });

  test("fails closed for two Auth accounts claiming the same actor in the same organization", async () => {
    const { directory } = setup({ auth: async () => response({ users: [authUser(), authUser({ id: "another-id", email: "other@example.test" })] }) });
    expect(await directory.listOrganization({ organizationId: "org_a" })).toBe("unavailable");
  });

  test.each([{ users: null }, { users: [{}] }, []])("malformed Auth listing is unavailable rather than missing identities (%j)", async (body) => {
    const { directory } = setup({ auth: async () => response(body) });
    expect(await directory.listOrganization({ organizationId: "org_a" })).toBe("unavailable");
  });

  test("failed later page never returns a partial misleading directory", async () => {
    const { directory } = setup({ auth: async (page) => page === 1 ? response({ users: Array.from({ length: 200 }, (_, i) => ({ id: `user-${i}` })) }) : response({ message: "unavailable" }, 503) });
    expect(await directory.listOrganization({ organizationId: "org_a" })).toBe("unavailable");
  });

  test("bounds the Auth scan and rejects an incomplete final full page", async () => {
    const { directory, fetchImpl } = setup({ auth: async (page) => response({ users: Array.from({ length: 200 }, (_, i) => ({ id: `page-${page}-user-${i}` })) }) });
    expect(await directory.listOrganization({ organizationId: "org_a" })).toBe("unavailable");
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes("/admin/users"))).toHaveLength(5);
  });

  test("rejects malformed operational access instead of reporting it active", async () => {
    const { directory } = setup({ access: [{ actor_id: ACTOR, status: "unexpected" }] });
    expect(await directory.listOrganization({ organizationId: "org_a" })).toBe("unavailable");
  });

  test("uses one deadline across pages instead of restarting a timeout for each page", async () => {
    vi.useFakeTimers();
    const { directory, fetchImpl } = setup({
      timeoutMs: 200,
      auth: async (page) => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        return response({ users: Array.from({ length: 200 }, (_, i) => ({ id: `page-${page}-user-${i}` })) });
      },
    });
    const result = directory.listOrganization({ organizationId: "org_a" });
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBe("unavailable");
    expect(fetchImpl.mock.calls.filter(([url]) => url.includes("/admin/users"))).toHaveLength(2);
    expect(new Set(fetchImpl.mock.calls.map(([, init]) => init.signal)).size).toBe(1);
    expect(fetchImpl.mock.calls[0]?.[1].signal?.aborted).toBe(true);
  });

  test("a never-settling JSON body still returns unavailable at the shared deadline", async () => {
    vi.useFakeTimers();
    const { directory } = setup({ timeoutMs: 200, auth: async () => ({ ok: true, status: 200, json: async () => new Promise(() => undefined) }) });
    const result = directory.listOrganization({ organizationId: "org_a" });
    await vi.advanceTimersByTimeAsync(200);
    expect(await result).toBe("unavailable");
  });
});
