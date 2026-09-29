import { describe, expect, test } from "vitest";
import type { ApiResult, RegisterPort } from "../../../../../docs/contracts/ports";
import type { Register, Session } from "../../../../../docs/contracts/domain.generated";
import { resolveManagementSections } from "../../server/admin/management-context";
import { STAFF_PERMISSIONS } from "../../server/auth/roles";
import { STAFF_PRESENTATION_COPY } from "./staff-presentation-notice";
import {
  createMemoryOfflineStaffPresentationStore,
  serializeStoredOfflineStaffPresentation,
} from "./offline-staff-presentation";
import { createStaffRuntimeController } from "./staff-runtime";
import { journalOrganizationApplicability } from "../../local/journal-recovery-scope";
import { createCheckoutAttemptStore } from "../../features/sell/runtime/checkout-attempt-store";
import type { CheckoutAttemptRecord } from "../../features/sell/runtime/checkout-attempt-store";

const SESSION: Session = {
  actorId: "cashier_a",
  displayName: "Cashier A",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
  capabilities: [],
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const REGISTER_A: Register = {
  id: "reg_a",
  name: "Front Counter",
  locationId: "loc_a1",
  currency: "GHS",
  status: "active",
};
const REGISTER_B: Register = { ...REGISTER_A, id: "reg_b", name: "Side Counter" };

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data, correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
}

function registers(): RegisterPort {
  return {
    async get(id) {
      if (id === REGISTER_A.id) return ok(REGISTER_A);
      if (id === REGISTER_B.id) return ok(REGISTER_B);
      return {
        ok: false,
        error: { code: "NOT_FOUND", message: "missing", retryable: false, nextAction: "none" },
        correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      };
    },
    async activeShift() {
      return ok(null);
    },
    async open() {
      throw new Error("not used");
    },
    async cashMovement() {
      throw new Error("not used");
    },
    async close() {
      throw new Error("not used");
    },
    async report() {
      throw new Error("not used");
    },
  };
}

describe("lineage reconciliation", () => {
  test("A cashier sign-in loads assignments without an organization control role", async () => {
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok({
            session: SESSION,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a"],
          });
        },
        async readContext() {
          return ok({
            session: SESSION,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a"],
          });
        },
        async read() {
          return SESSION;
        },
        async clear() {
          return;
        },
      },
      auth: {
        async signIn() {
          return { accessToken: "synthetic", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => true,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "correct-password" });
    const state = runtime.getState();
    expect(state.status).toBe("ready");
    expect(state.assignedRegisterIds).toEqual(["reg_a"]);
    expect(state.presentationNotice).toBeUndefined();
    expect(state.session?.capabilities).toEqual([]);
    expect(STAFF_PRESENTATION_COPY.invalid_credentials).not.toContain("temporarily unavailable");
  });

  test("B organization control stays separate from operational manager and cashier", () => {
    expect(resolveManagementSections({ controlRole: "owner", locationRoles: [] })).toContain("staff_access");
    expect(resolveManagementSections({ controlRole: "admin", locationRoles: [] })).toContain("staff_access");
    expect(resolveManagementSections({ controlRole: "support", locationRoles: [] })).not.toContain("staff_access");
    const managerSections = resolveManagementSections({
      controlRole: null,
      locationRoles: [{ locationId: "loc_a1", role: "manager" }],
    });
    expect(managerSections).toContain("staff_access");
    expect(STAFF_PERMISSIONS).not.toContain("staff.invite");
    expect(resolveManagementSections({ controlRole: null, locationRoles: [{ locationId: "loc_a1", role: "cashier" }] })).toEqual([]);
  });

  test("C assignment refresh coalesces and still applies a later grant", async () => {
    let reads = 0;
    let registerIds = ["reg_a"];
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok({ session: SESSION, assignedLocationIds: ["loc_a1"], assignedRegisterIds: registerIds });
        },
        async readContext() {
          reads += 1;
          if (reads === 1) await gate;
          return ok({ session: SESSION, assignedLocationIds: ["loc_a1"], assignedRegisterIds: [...registerIds] });
        },
        async read() {
          return SESSION;
        },
        async clear() {
          return;
        },
      },
      auth: {
        async signIn() {
          return { accessToken: "synthetic", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => true,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "correct-password" });
    const first = runtime.refreshRegister();
    const second = runtime.refreshRegister();
    release?.();
    await Promise.all([first, second]);
    expect(reads).toBe(1);
    registerIds = ["reg_a", "reg_b"];
    await runtime.refreshRegister();
    expect(runtime.getState().assignedRegisterIds).toEqual(["reg_a", "reg_b"]);
  });

  test("D offline presentation stores no organization-control authority", () => {
    const store = createMemoryOfflineStaffPresentationStore();
    store.write(
      {
        status: "ready",
        session: { ...SESSION, capabilities: ["organization.admin"] },
        assignedLocationIds: ["loc_a1"],
        assignedRegisterIds: ["reg_a"],
        assignedRegisters: [REGISTER_A],
        selectedRegisterId: "reg_a",
        register: REGISTER_A,
        shift: null,
        shiftOpen: true,
        mustChangePassword: false,
      },
      new Date("2026-09-25T12:00:00.000Z"),
    );
    const presented = store.evaluate(new Date("2026-09-25T13:00:00.000Z"));
    expect(presented?.outcome).toBe("available");
    if (presented?.outcome === "available") {
      expect(presented.authority.presentationOnly).toBe(true);
      expect(presented.authority.shiftOpen).toBe(false);
      expect(presented.authority.session?.capabilities).toEqual([]);
      expect(presented.authority.mustChangePassword).toBeUndefined();
    }
    const serialized = serializeStoredOfflineStaffPresentation({
      version: 1,
      verifiedAt: "2026-09-25T12:00:00.000Z",
      organizationId: "org_a",
      actorId: "cashier_a",
      displayName: "Cashier A",
      locationIds: ["loc_a1"],
      sessionExpiresAt: SESSION.expiresAt,
      register: { id: "reg_a", name: "Front Counter", locationId: "loc_a1", currency: "GHS", status: "active" },
      shift: null,
    });
    expect(serialized).not.toContain("organization.admin");
    expect(serialized).not.toContain("controlRole");
  });

  test("E unknown-organization recovery stays quarantined", () => {
    expect(journalOrganizationApplicability(undefined, "org_a")).toBe("unknown_organization");
    expect(journalOrganizationApplicability("org_b", "org_a")).toBe("different_organization");
    expect(journalOrganizationApplicability("org_a", "org_a")).toBe("same_organization");
  });

  test("F one checkout attempt identity survives a second read", async () => {
    const db = {
      name: "lineage-checkout",
      kv: {
        async get() {
          return undefined;
        },
        async put() {
          return;
        },
        async delete() {
          return;
        },
      },
    };
    const store = createCheckoutAttemptStore(db as never);
    const record = {
      transactionId: "11111111-1111-4111-8111-111111111111",
      quoteId: "quote-1",
      quoteFingerprint: "fp",
      quoteTotalMinor: 100,
      currency: "GHS",
      registerId: "reg_a",
      shiftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      prepareKey: "prepare",
      prepareCorrelationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cashKey: "cash",
      cashCorrelationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      finalizeKey: "finalize",
      finalizeCorrelationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      stage: "preparing",
      saleCompleted: false,
      message: "",
    } satisfies CheckoutAttemptRecord;
    await store.write(record);
    expect(store.readSync()?.transactionId).toBe(record.transactionId);
    expect(store.readSync()?.registerId).toBe("reg_a");
  });

  test("G sign-out retires local presentation and does not keep a session", async () => {
    const offline = createMemoryOfflineStaffPresentationStore();
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok({ session: SESSION, assignedLocationIds: ["loc_a1"], assignedRegisterIds: ["reg_a"] });
        },
        async readContext() {
          return ok({ session: SESSION, assignedLocationIds: ["loc_a1"], assignedRegisterIds: ["reg_a"] });
        },
        async read() {
          return SESSION;
        },
        async clear() {
          return;
        },
      },
      auth: {
        async signIn() {
          return { accessToken: "synthetic", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      offlinePresentationStore: offline,
      isOnline: () => true,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "correct-password" });
    await runtime.signOut();
    expect(runtime.getState().session).toBeNull();
    expect(runtime.getState().status).toBe("signed_out");
    expect(offline.evaluate(new Date())?.outcome).not.toBe("available");
  });

  test("H assignment lookup failure is not an empty assignment success", async () => {
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return {
            ok: false,
            error: {
              code: "INTEGRATION_UNAVAILABLE",
              message: "staff assignment directory is unavailable",
              retryable: true,
              nextAction: "resolve",
              details: { field: "assignments" },
            },
            correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          };
        },
        async readContext() {
          return {
            ok: false,
            error: {
              code: "INTEGRATION_UNAVAILABLE",
              message: "staff assignment directory is unavailable",
              retryable: true,
              nextAction: "resolve",
              details: { field: "assignments" },
            },
            correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          };
        },
        async read() {
          return null;
        },
        async clear() {
          return;
        },
      },
      auth: {
        async signIn() {
          return { accessToken: "synthetic", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => true,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "correct-password" });
    const state = runtime.getState();
    expect(state.presentationNotice).toBe("assignments_unavailable");
    expect(state.status).not.toBe("ready");
    expect(STAFF_PRESENTATION_COPY.assignments_unavailable).not.toContain("No register assigned");
  });
});
