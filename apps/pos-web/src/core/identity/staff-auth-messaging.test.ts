import { describe, expect, test } from "vitest";
import type { ApiResult, RegisterPort } from "../../../../../docs/contracts/ports";
import type { Register, Session, Shift } from "../../../../../docs/contracts/domain.generated";
import { clientAttentionExtras } from "../../app/workspace-runtime";
import { createStaffRuntimeController } from "./staff-runtime";
import { StaffAuthError } from "./staff-auth-provider";
import type { StaffSessionContext } from "./staff-session-context";
import { createMemoryOfflineStaffPresentationStore } from "./offline-staff-presentation";
import { createMemorySelectedRegisterStore, selectedRegisterStorageKey } from "./selected-register-preference";
import { STAFF_PRESENTATION_COPY } from "./staff-presentation-notice";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION: Session = {
  actorId: "cashier_a",
  displayName: "Cashier A",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
  capabilities: ["ui.hint.only"],
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const REGISTER_A: Register = {
  id: "reg_a",
  name: "Front Counter",
  locationId: "loc_a1",
  currency: "GHS",
  status: "active",
};
const SHIFT_A: Shift = {
  id: "60a60173-ce30-4ab7-9461-697ee625ceb3",
  registerId: "reg_a",
  deviceId: "00000000-0000-4000-8000-0000000000a1",
  cashierId: "cashier_a",
  status: "open",
  openingFloat: { minor: 50000, currency: "GHS" },
  openedAt: "2026-09-18T08:00:00.000Z",
};

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data, correlationId: CORRELATION };
}

function fail(
  code: "INTEGRATION_UNAVAILABLE" | "AUTH_REQUIRED" | "FORBIDDEN",
  message: string,
  field?: string,
): ApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: code === "INTEGRATION_UNAVAILABLE",
      nextAction: code === "AUTH_REQUIRED" ? "reauthenticate" : "resolve",
      ...(field ? { details: { field } } : {}),
    },
    correlationId: CORRELATION,
  };
}

function registers(): RegisterPort {
  return {
    async get(id) {
      return id === "reg_a" ? ok(REGISTER_A) : fail("FORBIDDEN", "register is out of staff scope");
    },
    async activeShift() {
      return ok(SHIFT_A);
    },
    async open() {
      return ok(SHIFT_A);
    },
    async cashMovement() {
      return fail("INTEGRATION_UNAVAILABLE", "unused");
    },
    async close() {
      return ok(SHIFT_A);
    },
    async report() {
      return fail("INTEGRATION_UNAVAILABLE", "unused");
    },
  };
}

function context(assignedRegisterIds: readonly string[]): StaffSessionContext {
  return {
    session: SESSION,
    assignedLocationIds: ["loc_a1"],
    assignedRegisterIds,
  };
}

describe("CAN-06 staff authority messaging", () => {
  test("wrong password stays a credential rejection with no session", async () => {
    let established = false;
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          established = true;
          return ok(context(["reg_a"]));
        },
        async readContext() {
          return fail("AUTH_REQUIRED", "staff session is required");
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
          throw new StaffAuthError("invalid_credentials", "staff credentials were rejected");
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => true,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "wrong" });
    expect(established).toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      register: null,
      presentationNotice: "invalid_credentials",
    });
    expect(STAFF_PRESENTATION_COPY.invalid_credentials).toBe("Incorrect email or password.");
    expect(STAFF_PRESENTATION_COPY.invalid_credentials).not.toContain("temporarily unavailable");
  });

  test("disabled POS access is not a password or outage failure", async () => {
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return fail("FORBIDDEN", "staff pos access is disabled", "pos_access");
        },
        async readContext() {
          return fail("AUTH_REQUIRED", "staff session is required");
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
          return { accessToken: "access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => true,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "correct" });
    expect(runtime.getState()).toMatchObject({
      status: "unauthorized",
      session: null,
      register: null,
      presentationNotice: "access_disabled",
    });
    expect(runtime.getState().supportReference).toBeUndefined();
    expect(STAFF_PRESENTATION_COPY.access_disabled).toBe("Your POS access is disabled. Contact a manager.");
    expect(STAFF_PRESENTATION_COPY.access_disabled).not.toContain("password");
    expect(STAFF_PRESENTATION_COPY.access_disabled).not.toContain("temporarily unavailable");
  });

  test("expired session closes authority and retires the offline snapshot", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    offlineStore.write(
      {
        status: "ready",
        session: SESSION,
        assignedLocationIds: ["loc_a1"],
        assignedRegisterIds: ["reg_a"],
        assignedRegisters: [REGISTER_A],
        selectedRegisterId: "reg_a",
        register: REGISTER_A,
        shift: SHIFT_A,
        shiftOpen: true,
      },
      new Date("2026-09-21T10:00:00.000Z"),
    );
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok(context(["reg_a"]));
        },
        async readContext() {
          return fail("AUTH_REQUIRED", "staff session is expired or revoked", "session");
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
          return { accessToken: "access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      offlinePresentationStore: offlineStore,
      now: () => new Date("2026-09-21T11:00:00.000Z"),
    });
    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "expired",
      session: null,
      presentationNotice: "session_expired",
    });
    expect(offlineStore.serializedSnapshot()).toBeNull();
    expect(STAFF_PRESENTATION_COPY.session_expired).toBe("Your session ended. Sign in again.");
  });

  test("assignment lookup failure is not zero registers and can recover", async () => {
    let phase: "down" | "up" = "down";
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok(context(["reg_a"]));
        },
        async readContext() {
          return phase === "down"
            ? fail("INTEGRATION_UNAVAILABLE", "staff assignment directory is unavailable", "assignments")
            : ok(context(["reg_a"]));
        },
        async read() {
          return phase === "up" ? SESSION : null;
        },
        async clear() {
          return;
        },
      },
      auth: {
        async signIn() {
          return { accessToken: "access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => true,
    });
    await runtime.restore();
    const blocked = runtime.getState();
    expect(blocked.status).toBe("unavailable");
    expect(blocked.session).toBeNull();
    expect(blocked.presentationNotice).toBe("assignments_unavailable");
    expect(blocked.assignedRegisterIds).toEqual([]);
    expect(STAFF_PRESENTATION_COPY.assignments_unavailable).not.toContain("No register assigned");
    const attention = clientAttentionExtras({ catalogAvailability: null, authority: blocked });
    expect(attention.some((item) => item.title === "No register assigned")).toBe(false);

    phase = "up";
    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
    });
    expect(runtime.getState().presentationNotice).toBeUndefined();
  });

  test("an authoritative empty assignment list stays distinct from lookup failure", async () => {
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok(context([]));
        },
        async readContext() {
          return ok(context([]));
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
          return { accessToken: "access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
    });
    await runtime.restore();
    const state = runtime.getState();
    expect(state).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
      assignedRegisterIds: [],
      register: null,
    });
    expect(state.presentationNotice).toBeUndefined();
    const attention = clientAttentionExtras({ catalogAvailability: null, authority: state });
    expect(attention.some((item) => item.title === "No register assigned")).toBe(true);
  });

  test("provider outage can be followed by a normal sign-in", async () => {
    let available = false;
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok(context(["reg_a"]));
        },
        async readContext() {
          return fail("AUTH_REQUIRED", "staff session is required");
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
          if (!available) {
            throw new StaffAuthError("provider_unavailable", "identity provider is unavailable");
          }
          return { accessToken: "access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => true,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "secret" });
    expect(runtime.getState().presentationNotice).toBe("provider_unavailable");
    expect(runtime.getState().session).toBeNull();
    expect(STAFF_PRESENTATION_COPY.provider_unavailable).not.toContain("password");
    available = true;
    await runtime.signIn({ email: "cashier@example.com", password: "secret" });
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
    });
    expect(runtime.getState().presentationNotice).toBeUndefined();
  });

  test("offline fresh sign-in does not call the provider or mint authority", async () => {
    let called = false;
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok(context(["reg_a"]));
        },
        async readContext() {
          return fail("AUTH_REQUIRED", "staff session is required");
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
          called = true;
          return { accessToken: "access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: registers(),
      isOnline: () => false,
    });
    await runtime.signIn({ email: "cashier@example.com", password: "secret" });
    expect(called).toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      presentationNotice: "offline_sign_in",
    });
  });

  test("forbidden explicit register selection keeps the current session and register", async () => {
    const store = createMemorySelectedRegisterStore({
      [selectedRegisterStorageKey("org_a", "cashier_a")]: "reg_a",
    });
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok(context(["reg_a", "reg_b"]));
        },
        async readContext() {
          return ok(context(["reg_a", "reg_b"]));
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
          return { accessToken: "access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: {
        ...registers(),
        async get(id) {
          if (id === "reg_b") return fail("FORBIDDEN", "register is out of staff scope");
          return ok(REGISTER_A);
        },
      },
      selectedRegisterStore: store,
    });
    await runtime.restore();
    const accepted = await runtime.selectRegister("reg_b");
    expect(accepted).toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
      presentationNotice: "register_forbidden",
    });
    expect(store.read("org_a", "cashier_a")).toBe("reg_a");
    expect(STAFF_PRESENTATION_COPY.register_forbidden).toBe("That register isn't available to this account.");
    expect(runtime.getState().status).not.toBe("unauthorized");
  });
});
