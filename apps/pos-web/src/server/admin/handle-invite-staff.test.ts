import { describe, expect, test } from "vitest";
import type { Session } from "../../../../../docs/contracts/domain.generated";
import { createMemoryAssignmentDirectory } from "../auth/assignments";
import { createEphemeralInMemoryStaffSessionStore } from "../auth/session-store";
import { createMemoryAdminAuditStore, type AdminAuditStore } from "./admin-audit-store";
import { createMemoryControlPlaneDirectory } from "./control-plane-directory";
import { handleInviteStaff, readStaffInviteBody } from "./handle-invite-staff";
import { createMemoryStaffAccessStatusAdminStore, type StaffAccessStatusAdminStore } from "./staff-access-status-admin-store";
import { createMemoryStaffIdentityAdminStore, type StaffIdentityAdminStore } from "./staff-identity-admin-store";

const NOW = new Date("2026-09-22T17:00:00.000Z");
const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORIGIN = "https://pos.example.test";

function session(actorId: string): Session {
  return {
    actorId,
    displayName: actorId,
    organizationId: "org_a",
    locationIds: ["loc_a1"],
    capabilities: [],
    expiresAt: "2026-09-22T18:00:00.000Z",
  };
}

async function runtime(
  actorId: string,
  controlRole: "owner" | "admin" | "support" | null,
  locationRole: "manager" | "cashier" = "manager",
) {
  const sessions = createEphemeralInMemoryStaffSessionStore();
  const id = await sessions.create(
    session(actorId),
    "csrf",
    new Date("2026-09-22T18:00:00.000Z"),
  );
  return {
    correlationId: CORRELATION,
    cookieHeader: `cetech_pos_sid=${id}`,
    now: NOW,
    sessions,
    assignments: createMemoryAssignmentDirectory([
      {
        actorId,
        organizationId: "org_a",
        locationRoles: [{ locationId: "loc_a1", role: locationRole }],
        registerIds: ["reg_a"],
      },
    ]),
    controlPlane: createMemoryControlPlaneDirectory(
      controlRole
        ? [{
            organizationId: "org_a",
            actorId,
            controlRole,
            status: "active",
          }]
        : [],
    ),
    protection: {
      origin: ORIGIN,
      referer: null,
      csrfCookie: "csrf",
      csrfHeader: "csrf",
      allowedOrigins: [ORIGIN],
    },
  };
}

describe("ADMIN-105 staff invitation", () => {
  test("owner invite creates identity, starts POS-disabled, and records audit", async () => {
    const base = await runtime("owner_a", "owner");
    const identities = createMemoryStaffIdentityAdminStore();
    const accessStatus = createMemoryStaffAccessStatusAdminStore();
    const audit = createMemoryAdminAuditStore();
    const result = await handleInviteStaff({
      ...base,
      identities,
      accessStatus,
      audit,
      email: "new.staff@example.com",
      displayName: "New Staff",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected invite");
    expect(result.data).toMatchObject({
      email: "new.staff@example.com",
      displayName: "New Staff",
      posAccessStatus: "disabled",
    });
    expect(identities.rows).toHaveLength(1);
    expect(accessStatus.rows).toHaveLength(1);
    expect(accessStatus.rows[0]?.status).toBe("disabled");
    expect(audit.events.some((event) => event.action === "staff.identity.invited")).toBe(true);
  });

  test("admin may invite operational staff", async () => {
    const base = await runtime("admin_a", "admin");
    const result = await handleInviteStaff({
      ...base,
      identities: createMemoryStaffIdentityAdminStore(),
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "cashier@example.com",
      displayName: "Cashier",
    });
    expect(result.ok).toBe(true);
  });

  test("operational manager without organization authority cannot invite", async () => {
    const base = await runtime("manager_a", null);
    const result = await handleInviteStaff({
      ...base,
      identities: createMemoryStaffIdentityAdminStore(),
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "cashier@example.com",
      displayName: "Cashier",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected forbidden");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  test("invalid email is rejected before Auth side effects", async () => {
    const base = await runtime("owner_a", "owner");
    const identities = createMemoryStaffIdentityAdminStore();
    const result = await handleInviteStaff({
      ...base,
      identities,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "not-an-email",
      displayName: "Cashier",
    });
    expect(result.ok).toBe(false);
    expect(identities.rows).toHaveLength(0);
  });

  test("audit failure suspends newly invited Auth identity", async () => {
    const base = await runtime("owner_a", "owner");
    let suspended = false;
    const identity: StaffIdentityAdminStore = {
      async invite(input) {
        return {
          authUserId: "auth-user-1",
          actorId: "actor-new",
          organizationId: input.organizationId,
          email: input.email,
          displayName: input.displayName,
        };
      },
      async createWithTemporaryPassword() {
        return "unavailable";
      },
      async resetTemporaryPassword() {
        return "unavailable";
      },
      async replaceOwnPassword() {
        return "unavailable";
      },
      async findByActor() {
        return "missing";
      },
      async suspendAuthUser() {
        suspended = true;
        return "ok";
      },
    };
    const audit: AdminAuditStore = {
      async append() {
        return "unavailable";
      },
    };
    const result = await handleInviteStaff({
      ...base,
      identities: identity,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit,
      email: "new@example.com",
      displayName: "New",
    });
    expect(result.ok).toBe(false);
    expect(suspended).toBe(true);
  });

  test("failure to establish disabled POS status suspends invited Auth identity", async () => {
    const base = await runtime("owner_a", "owner");
    let suspended = false;
    const identity: StaffIdentityAdminStore = {
      async invite(input) {
        return {
          authUserId: "auth-user-2",
          actorId: "actor-new-2",
          organizationId: input.organizationId,
          email: input.email,
          displayName: input.displayName,
        };
      },
      async createWithTemporaryPassword() {
        return "unavailable";
      },
      async resetTemporaryPassword() {
        return "unavailable";
      },
      async replaceOwnPassword() {
        return "unavailable";
      },
      async findByActor() {
        return "missing";
      },
      async suspendAuthUser() {
        suspended = true;
        return "ok";
      },
    };
    const access: StaffAccessStatusAdminStore = {
      async setStatus() {
        return "unavailable";
      },
    };
    const result = await handleInviteStaff({
      ...base,
      identities: identity,
      accessStatus: access,
      audit: createMemoryAdminAuditStore(),
      email: "new2@example.com",
      displayName: "New Two",
    });
    expect(result.ok).toBe(false);
    expect(suspended).toBe(true);
  });

  test("support authority cannot invite staff", async () => {
    const base = await runtime("support_a", "support");
    const identities = createMemoryStaffIdentityAdminStore();
    const result = await handleInviteStaff({
      ...base,
      identities,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "cashier@example.com",
      displayName: "Cashier",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected forbidden");
    expect(result.error.code).toBe("FORBIDDEN");
    expect(identities.inviteCalls).toHaveLength(0);
  });

  test("cashier cannot invite staff", async () => {
    const base = await runtime("cashier_a", null, "cashier");
    const identities = createMemoryStaffIdentityAdminStore();
    const result = await handleInviteStaff({
      ...base,
      identities,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "other@example.com",
      displayName: "Other",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected forbidden");
    expect(result.error.code).toBe("FORBIDDEN");
    expect(identities.inviteCalls).toHaveLength(0);
  });

  test("staging invite uses the stable https /auth/invite redirect", async () => {
    const base = await runtime("owner_a", "owner");
    const identities = createMemoryStaffIdentityAdminStore();
    const result = await handleInviteStaff({
      ...base,
      identities,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "new.staff@example.com",
      displayName: "New Staff",
      runtimeEnv: {
        APP_ENV: "staging",
        APP_ORIGIN: "https://pos-staging.example.com",
        VERCEL_URL: "cetech-pos-staging-abc123.vercel.app",
      },
    });
    expect(result.ok).toBe(true);
    expect(identities.inviteCalls[0]?.redirectTo).toBe("https://pos-staging.example.com/auth/invite");
    expect(identities.inviteCalls[0]?.redirectTo).not.toContain("vercel.app");
  });

  test("deployed localhost origin fails before invitation delivery", async () => {
    const base = await runtime("owner_a", "owner");
    const identities = createMemoryStaffIdentityAdminStore();
    const result = await handleInviteStaff({
      ...base,
      identities,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "new.staff@example.com",
      displayName: "New Staff",
      runtimeEnv: {
        APP_ENV: "production",
        APP_ORIGIN: "http://localhost:3000",
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected configuration failure");
    expect(result.error.message).toContain("localhost");
    expect(identities.inviteCalls).toHaveLength(0);
  });

  test("an existing account is reported without a second invitation", async () => {
    const base = await runtime("owner_a", "owner");
    const identities = createMemoryStaffIdentityAdminStore();
    const first = await handleInviteStaff({
      ...base,
      identities,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "existing@example.com",
      displayName: "Existing",
    });
    expect(first.ok).toBe(true);
    const second = await handleInviteStaff({
      ...base,
      identities,
      accessStatus: createMemoryStaffAccessStatusAdminStore(),
      audit: createMemoryAdminAuditStore(),
      email: "existing@example.com",
      displayName: "Existing",
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("expected conflict");
    expect(second.error.message).toBe("This email already has an account.");
    expect(identities.rows).toHaveLength(1);
  });

  test("request body cannot choose the invitation redirect", () => {
    const parsed = readStaffInviteBody({
      email: "new.staff@example.com",
      displayName: "New Staff",
      redirectTo: "https://evil.example/phish",
      redirect_to: "https://evil.example/phish",
      redirect: "https://evil.example/phish",
    });
    expect(parsed).toEqual({
      email: "new.staff@example.com",
      displayName: "New Staff",
    });
    expect(JSON.stringify(parsed)).not.toContain("evil.example");
  });
});
