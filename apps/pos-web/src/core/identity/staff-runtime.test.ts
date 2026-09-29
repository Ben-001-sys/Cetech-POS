import { describe, expect, test } from "vitest";
import type { ApiResult, RegisterPort } from "../../../../../docs/contracts/ports";
import type { Register, Session, Shift } from "../../../../../docs/contracts/domain.generated";
import { AppShell } from "../../ui/shell";
import { createBffStaffSessionGateway } from "./bff-staff-session-gateway";
import { checkoutScopeFromStaffAuthority } from "./checkout-scope";
import { createStaffIdentityPort } from "./staff-identity-port";
import { createMemorySelectedRegisterStore, selectedRegisterStorageKey } from "./selected-register-preference";
import {
  createMemoryOfflineStaffPresentationStore,
  OFFLINE_GRACE_EXPIRED_MESSAGE,
  OFFLINE_STAFF_PRESENTATION_MAX_AGE_MS,
} from "./offline-staff-presentation";
import { lockStaffSession } from "./staff-lock";
import { createPublicSupabaseStaffAuthProvider } from "./staff-auth-provider";
import { createStaffRuntimeController, REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE } from "./staff-runtime";

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
const REGISTER_B: Register = {
  id: "reg_b",
  name: "Back Counter",
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
const SHIFT_B: Shift = {
  id: "70b70173-ce30-4ab7-9461-697ee625ceb4",
  registerId: "reg_b",
  deviceId: "00000000-0000-4000-8000-0000000000b1",
  cashierId: "cashier_a",
  status: "open",
  openingFloat: { minor: 25000, currency: "GHS" },
  openedAt: "2026-09-18T09:00:00.000Z",
};

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data, correlationId: CORRELATION };
}

function fail(code: "INTEGRATION_UNAVAILABLE" | "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND", message: string): ApiResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      retryable: code === "INTEGRATION_UNAVAILABLE",
      nextAction: code === "AUTH_REQUIRED" ? "reauthenticate" : "resolve",
    },
    correlationId: CORRELATION,
  };
}

function sessionFetch(assignedRegisterIds: () => readonly string[]): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        ok: true,
        correlationId: CORRELATION,
        data: {
          session: SESSION,
          assignedLocationIds: ["loc_a1"],
          assignedRegisterIds: assignedRegisterIds(),
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

function authStub() {
  return {
    async signIn() {
      return { accessToken: "staff-access-token", correlationId: CORRELATION };
    },
    async signOut() {
      return;
    },
  };
}

function watchRegisterPreference(initialRegisterId?: string) {
  const writes: Array<{ organizationId: string; actorId: string; registerId: string }> = [];
  const clears: Array<{ organizationId: string; actorId: string }> = [];
  const inner = createMemorySelectedRegisterStore(
    initialRegisterId
      ? { [selectedRegisterStorageKey("org_a", "cashier_a")]: initialRegisterId }
      : {},
  );
  return {
    writes,
    clears,
    store: {
      read(organizationId: string, actorId: string) {
        return inner.read(organizationId, actorId);
      },
      write(organizationId: string, actorId: string, registerId: string) {
        writes.push({ organizationId, actorId, registerId });
        inner.write(organizationId, actorId, registerId);
      },
      clear(organizationId: string, actorId: string) {
        clears.push({ organizationId, actorId });
        inner.clear(organizationId, actorId);
      },
    },
  };
}

function holdAuthClosedLookup(
  registers: ReturnType<typeof stubRegisters>,
  target: "register" | "shift",
  registerId: string,
  skip = 0,
) {
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const originalGet = registers.getImpl;
  const originalShift = registers.shiftImpl;
  let armed = true;
  let remainingSkips = skip;
  const respond = async () => {
    entered();
    await gate;
    return fail("AUTH_REQUIRED", "staff session is expired or revoked");
  };
  const claim = (id: string) => {
    if (!armed || id !== registerId) return false;
    if (remainingSkips > 0) {
      remainingSkips -= 1;
      return false;
    }
    armed = false;
    return true;
  };
  if (target === "register") {
    registers.getImpl = async (id) => (claim(id) ? respond() : originalGet(id));
  } else {
    registers.shiftImpl = async (id) => (claim(id) ? respond() : originalShift(id));
  }
  return { release, started };
}

function cashierRuntime(options: {
  registers: ReturnType<typeof stubRegisters>;
  assigned: readonly string[];
  store: ReturnType<typeof watchRegisterPreference>["store"];
  offlineStore: ReturnType<typeof createMemoryOfflineStaffPresentationStore>;
  onEstablish?: (current: Session) => Session;
  isOnline?: () => boolean;
  now?: () => Date;
}) {
  let active = ok({
    session: SESSION,
    assignedLocationIds: ["loc_a1"],
    assignedRegisterIds: options.assigned,
  });
  const runtime = createStaffRuntimeController({
    gateway: {
      async establish() {
        const session = options.onEstablish ? options.onEstablish(active.ok ? active.data.session : SESSION) : SESSION;
        active = ok({
          session,
          assignedLocationIds: ["loc_a1"],
          assignedRegisterIds: options.assigned,
        });
        return active;
      },
      async readContext() {
        return active;
      },
      async read() {
        return active.ok ? active.data.session : null;
      },
      async clear() {
        return;
      },
    },
    auth: authStub(),
    registers: options.registers,
    selectedRegisterStore: options.store,
    offlinePresentationStore: options.offlineStore,
    isOnline: options.isOnline,
    now: options.now,
  });
  return {
    runtime,
    denyTransport() {
      active = fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
    },
  };
}

async function expectCurrentAuthClosed(target: "register" | "shift") {
  const watched = watchRegisterPreference("reg_a");
  const offlineStore = createMemoryOfflineStaffPresentationStore();
  const registers = stubRegisters();
  let online = true;
  const harness = cashierRuntime({
    registers,
    assigned: ["reg_a"],
    store: watched.store,
    offlineStore,
    isOnline: () => online,
    now: () => new Date("2026-09-21T11:00:00.000Z"),
  });
  await harness.runtime.restore();
  expect(offlineStore.serializedSnapshot()).toContain(SESSION.expiresAt);
  expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  if (target === "register") {
    registers.getImpl = async () => fail("AUTH_REQUIRED", "staff session is expired or revoked");
  } else {
    registers.shiftImpl = async () => fail("AUTH_REQUIRED", "staff session is expired or revoked");
  }
  await harness.runtime.refreshRegister();
  expect(harness.runtime.getState()).toMatchObject({
    status: "expired",
    session: null,
    register: null,
    shift: null,
    shiftOpen: false,
  });
  expect(offlineStore.serializedSnapshot()).toBeNull();
  expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  harness.denyTransport();
  online = false;
  await harness.runtime.restore();
  expect(harness.runtime.getState().session).toBeNull();
  expect(harness.runtime.getState().presentationOnly).not.toBe(true);
  expect(harness.runtime.getState().status).toBe("unavailable");
  expect(offlineStore.read(new Date("2026-09-21T12:00:00.000Z"))).toBeNull();
}

function holdRegisterSwitch(
  registers: ReturnType<typeof stubRegisters>,
  outcome: "forbidden" | "timeout" | "success" | "missing",
) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = registers.getImpl;
  let armed = true;
  registers.getImpl = async (id) => {
    if (armed && id === "reg_b") {
      armed = false;
      await gate;
      if (outcome === "forbidden") {
        return fail("FORBIDDEN", "register is out of staff scope");
      }
      if (outcome === "timeout") {
        return fail("INTEGRATION_UNAVAILABLE", "Warp server error: Thread killed by timeout manager");
      }
      if (outcome === "missing") {
        return fail("NOT_FOUND", "register was not found");
      }
    }
    return original(id);
  };
  return { release };
}

function controller(
  registers: RegisterPort,
  assigned: readonly string[] | (() => readonly string[]) = ["reg_a"],
  store = createMemorySelectedRegisterStore(),
) {
  const assignedFn = typeof assigned === "function" ? assigned : () => assigned;
  return {
    store,
    runtime: createStaffRuntimeController({
      gateway: createBffStaffSessionGateway({ fetchImpl: sessionFetch(assignedFn), correlationId: () => CORRELATION }),
      auth: authStub(),
      registers,
      selectedRegisterStore: store,
    }),
  };
}

describe("STG-06 staff runtime register authority", () => {
  test("CAN-05 concurrent refreshRegister calls share one register hydration", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalGet = registers.getImpl;
    const originalShift = registers.shiftImpl;
    registers.getImpl = async (id) => {
      await gate;
      return originalGet(id);
    };
    registers.shiftImpl = async (id) => {
      await gate;
      return originalShift(id);
    };
    registers.got.length = 0;
    registers.shifted.length = 0;
    const burst = Promise.all(Array.from({ length: 8 }, () => runtime.refreshRegister()));
    release();
    await burst;
    expect(registers.got).toEqual(["reg_a", "reg_a"]);
    expect(registers.shifted).toEqual(["reg_a"]);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      register: { id: "reg_a" },
      shiftOpen: true,
    });
  });

  test("CAN-05 in-flight refresh does not restore authority after sign-out", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalGet = registers.getImpl;
    registers.getImpl = async (id) => {
      await gate;
      return originalGet(id);
    };
    const pending = runtime.refreshRegister();
    await runtime.signOut();
    release();
    await pending;
    expect(runtime.getState().status).toBe("signed_out");
    expect(runtime.getState().session).toBeNull();
    expect(runtime.getState().register).toBeNull();
  });

  test("CAN-05 concurrent offline revalidation shares one session read", async () => {
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
    let reads = 0;
    let holdReads = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unavailable = fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return unavailable;
        },
        async readContext() {
          reads += 1;
          if (holdReads) {
            await gate;
          }
          return unavailable;
        },
        async read() {
          return null;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => false,
      now: () => new Date("2026-09-21T11:00:00.000Z"),
    });
    await runtime.restore();
    reads = 0;
    holdReads = true;
    const burst = Promise.all(Array.from({ length: 8 }, () => runtime.refreshRegister()));
    release();
    await burst;
    expect(reads).toBe(1);
    expect(runtime.getState().presentationOnly).toBe(true);
    expect(runtime.getState().assignedRegisterIds).toEqual(["reg_a"]);
  });

  test("CAN-05 register timeout stays unavailable authority, not zero assignments or sign-out", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    registers.getImpl = async () => {
      await gate;
      return fail("INTEGRATION_UNAVAILABLE", "Warp server error: Thread killed by timeout manager");
    };
    registers.got.length = 0;
    const burst = Promise.all(Array.from({ length: 8 }, () => runtime.refreshRegister()));
    release();
    await burst;
    const state = runtime.getState();
    expect(registers.got).toEqual(["reg_a", "reg_a"]);
    expect(state.status).toBe("ready");
    expect(state.session?.actorId).toBe("cashier_a");
    expect(state.assignedRegisterIds).toEqual(["reg_a"]);
    expect(state.register?.id).toBe("reg_a");
    expect(state.shiftOpen).toBe(true);
    expect(state.errorMessage).toContain("timeout manager");
  });

  test("CAN-05 repeated restore shares one session read", async () => {
    let reads = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sessionResult = ok({
      session: SESSION,
      assignedLocationIds: ["loc_a1"],
      assignedRegisterIds: ["reg_a"],
    });
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return sessionResult;
        },
        async readContext() {
          reads += 1;
          await gate;
          return sessionResult;
        },
        async read() {
          return SESSION;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers: stubRegisters(),
    });
    const burst = Promise.all([runtime.restore(), runtime.restore(), runtime.restore()]);
    release();
    await burst;
    expect(reads).toBe(1);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      register: { id: "reg_a" },
      shiftOpen: true,
    });
  });

  test("CAN-05 an older refresh does not overwrite a newer shift", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalGet = registers.getImpl;
    registers.getImpl = async (id) => {
      calls += 1;
      if (calls >= 2) {
        await gate;
      }
      return originalGet(id);
    };
    const pending = runtime.refreshRegister();
    const replacement: Shift = {
      ...SHIFT_A,
      id: "80c80173-ce30-4ab7-9461-697ee625ceb5",
    };
    runtime.applyShift(replacement);
    release();
    await pending;
    expect(runtime.getState().shift?.id).toBe(replacement.id);
    expect(runtime.getState().register?.id).toBe("reg_a");
    expect(runtime.getState().shiftOpen).toBe(true);
  });

  test("CAN-05 A slow register switch plus sign-out drops a forbidden hydration", async () => {
    const watched = watchRegisterPreference("reg_a");
    const registers = stubRegisters();
    const { runtime } = controller(registers, ["reg_a", "reg_b"], watched.store);
    await runtime.restore();
    const held = holdRegisterSwitch(registers, "forbidden");
    const pending = runtime.selectRegister("reg_b");
    await runtime.signOut();
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      register: null,
      selectedRegisterId: null,
    });
    expect(watched.writes).toEqual([]);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 B slow register switch plus sign-out drops a timeout hydration", async () => {
    const watched = watchRegisterPreference("reg_a");
    const registers = stubRegisters();
    const { runtime } = controller(registers, ["reg_a", "reg_b"], watched.store);
    await runtime.restore();
    const held = holdRegisterSwitch(registers, "timeout");
    const pending = runtime.selectRegister("reg_b");
    await runtime.signOut();
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      register: null,
    });
    expect(watched.writes).toEqual([]);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 C slow register switch plus sign-out drops a successful hydration", async () => {
    const watched = watchRegisterPreference("reg_a");
    const registers = stubRegisters();
    const { runtime } = controller(registers, ["reg_a", "reg_b"], watched.store);
    await runtime.restore();
    const held = holdRegisterSwitch(registers, "success");
    const pending = runtime.selectRegister("reg_b");
    await runtime.signOut();
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      register: null,
      selectedRegisterId: null,
    });
    expect(watched.writes).toEqual([]);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 D slow register switch does not publish over a newer sign-in", async () => {
    const watched = watchRegisterPreference("reg_a");
    const registers = stubRegisters();
    const sessionB: Session = {
      actorId: "cashier_b",
      displayName: "Cashier B",
      organizationId: "org_b",
      locationIds: ["loc_b1"],
      capabilities: ["ui.hint.only"],
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    let active = ok({
      session: SESSION,
      assignedLocationIds: ["loc_a1"],
      assignedRegisterIds: ["reg_a", "reg_b"],
    });
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          active = ok({
            session: sessionB,
            assignedLocationIds: ["loc_b1"],
            assignedRegisterIds: ["reg_a", "reg_b"],
          });
          return active;
        },
        async readContext() {
          return active;
        },
        async read() {
          return active.ok ? active.data.session : null;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers,
      selectedRegisterStore: watched.store,
    });
    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      session: { actorId: "cashier_a", organizationId: "org_a" },
      selectedRegisterId: "reg_a",
    });
    const held = holdRegisterSwitch(registers, "success");
    const pending = runtime.selectRegister("reg_b");
    await runtime.signIn();
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_b", organizationId: "org_b" },
      selectedRegisterId: null,
      register: null,
    });
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_b", organizationId: "org_b" },
      register: null,
      selectedRegisterId: null,
    });
    expect(watched.writes).toEqual([]);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
    expect(watched.store.read("org_b", "cashier_b")).toBeNull();
    expect(watched.store.read("org_a", "cashier_b")).toBeNull();
    expect(watched.store.read("org_b", "cashier_a")).toBeNull();
  });

  test("CAN-05 E current-session register switch still persists", async () => {
    const watched = watchRegisterPreference();
    const registers = stubRegisters();
    const { runtime } = controller(registers, ["reg_a", "reg_b"], watched.store);
    await runtime.restore();
    await runtime.selectRegister("reg_a");
    watched.writes.length = 0;
    const accepted = await runtime.selectRegister("reg_b");
    expect(accepted).toBe(true);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a" },
      selectedRegisterId: "reg_b",
      register: { id: "reg_b" },
      shift: { id: SHIFT_B.id },
      shiftOpen: true,
    });
    expect(watched.writes).toEqual([
      { organizationId: "org_a", actorId: "cashier_a", registerId: "reg_b" },
    ]);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_b");
  });

  test("CAN-05 late NOT_FOUND after sign-out does not clear the stored register", async () => {
    const watched = watchRegisterPreference("reg_a");
    const registers = stubRegisters();
    const { runtime } = controller(registers, ["reg_a", "reg_b"], watched.store);
    await runtime.restore();
    const held = holdRegisterSwitch(registers, "missing");
    const pending = runtime.selectRegister("reg_b");
    await runtime.signOut();
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      register: null,
    });
    expect(watched.writes).toEqual([]);
    expect(watched.clears).toEqual([]);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 late NOT_FOUND does not clear a newer same-actor preference", async () => {
    const watched = watchRegisterPreference("reg_a");
    const registers = stubRegisters();
    const renewed: Session = { ...SESSION, expiresAt: "2099-06-01T00:00:00.000Z" };
    let active = ok({
      session: SESSION,
      assignedLocationIds: ["loc_a1"],
      assignedRegisterIds: ["reg_a", "reg_b"],
    });
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          active = ok({
            session: renewed,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a", "reg_b"],
          });
          return active;
        },
        async readContext() {
          return active;
        },
        async read() {
          return active.ok ? active.data.session : null;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers,
      selectedRegisterStore: watched.store,
    });
    await runtime.restore();
    const held = holdRegisterSwitch(registers, "missing");
    const pending = runtime.selectRegister("reg_b");
    await runtime.signIn();
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a", expiresAt: renewed.expiresAt },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
    });
    const writesAfterRenewal = watched.writes.length;
    const clearsAfterRenewal = watched.clears.length;
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a", expiresAt: renewed.expiresAt },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
    });
    expect(watched.writes).toHaveLength(writesAfterRenewal);
    expect(watched.clears).toHaveLength(clearsAfterRenewal);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 current explicit NOT_FOUND keeps the previously selected register", async () => {
    const watched = watchRegisterPreference("reg_a");
    const registers = stubRegisters();
    const originalGet = registers.getImpl;
    registers.getImpl = async (id) =>
      id === "reg_b" ? fail("NOT_FOUND", "register was not found") : originalGet(id);
    const { runtime } = controller(registers, ["reg_a", "reg_b"], watched.store);
    await runtime.restore();
    watched.writes.length = 0;
    watched.clears.length = 0;
    const accepted = await runtime.selectRegister("reg_b");
    expect(accepted).toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a" },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
      shift: { id: SHIFT_A.id },
      shiftOpen: true,
    });
    expect(runtime.getState().errorMessage).toContain("not found");
    expect(watched.writes).toEqual([]);
    expect(watched.clears).toEqual([]);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 restore clears a stored register the server no longer has", async () => {
    const store = createMemorySelectedRegisterStore({
      [selectedRegisterStorageKey("org_a", "cashier_a")]: "reg_b",
    });
    const registers = stubRegisters();
    const originalGet = registers.getImpl;
    registers.getImpl = async (id) =>
      id === "reg_b" ? fail("NOT_FOUND", "register was not found") : originalGet(id);
    const { runtime } = controller(registers, ["reg_a", "reg_b"], store);
    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a" },
      selectedRegisterId: null,
      register: null,
      shift: null,
    });
    expect(store.read("org_a", "cashier_a")).toBeNull();
  });

  test("CAN-05 stale explicit switch AUTH_REQUIRED keeps the newer offline snapshot", async () => {
    const watched = watchRegisterPreference("reg_a");
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const registers = stubRegisters();
    const renewed: Session = { ...SESSION, expiresAt: "2099-06-01T00:00:00.000Z" };
    const { runtime } = cashierRuntime({
      registers,
      assigned: ["reg_a", "reg_b"],
      store: watched.store,
      offlineStore,
      onEstablish: () => renewed,
    });
    await runtime.restore();
    const held = holdAuthClosedLookup(registers, "register", "reg_b");
    const pending = runtime.selectRegister("reg_b");
    await held.started;
    await runtime.signIn();
    const snapshot = offlineStore.serializedSnapshot();
    const writesAfterRenewal = watched.writes.length;
    const clearsAfterRenewal = watched.clears.length;
    expect(snapshot).toContain(renewed.expiresAt);
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a", expiresAt: renewed.expiresAt },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
    });
    expect(offlineStore.serializedSnapshot()).toBe(snapshot);
    expect(watched.writes).toHaveLength(writesAfterRenewal);
    expect(watched.clears).toHaveLength(clearsAfterRenewal);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 stale active-shift AUTH_REQUIRED keeps the newer offline snapshot", async () => {
    const watched = watchRegisterPreference("reg_a");
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const registers = stubRegisters();
    const renewed: Session = { ...SESSION, expiresAt: "2099-07-01T00:00:00.000Z" };
    const { runtime } = cashierRuntime({
      registers,
      assigned: ["reg_a", "reg_b"],
      store: watched.store,
      offlineStore,
      onEstablish: () => renewed,
    });
    await runtime.restore();
    const held = holdAuthClosedLookup(registers, "shift", "reg_b");
    const pending = runtime.selectRegister("reg_b");
    await held.started;
    await runtime.signIn();
    const snapshot = offlineStore.serializedSnapshot();
    expect(snapshot).toContain(renewed.expiresAt);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", expiresAt: renewed.expiresAt },
      selectedRegisterId: "reg_a",
    });
    held.release();
    await expect(pending).resolves.toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a", expiresAt: renewed.expiresAt },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
    });
    expect(offlineStore.serializedSnapshot()).toBe(snapshot);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 stale live refresh AUTH_REQUIRED keeps the newer offline snapshot", async () => {
    const watched = watchRegisterPreference("reg_a");
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const registers = stubRegisters();
    const renewed: Session = { ...SESSION, expiresAt: "2099-08-01T00:00:00.000Z" };
    const { runtime } = cashierRuntime({
      registers,
      assigned: ["reg_a", "reg_b"],
      store: watched.store,
      offlineStore,
      onEstablish: () => renewed,
    });
    await runtime.restore();
    const held = holdAuthClosedLookup(registers, "register", "reg_a", 1);
    const pending = runtime.refreshRegister();
    await held.started;
    await runtime.signIn();
    const snapshot = offlineStore.serializedSnapshot();
    expect(snapshot).toContain(renewed.expiresAt);
    held.release();
    await pending;
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a", organizationId: "org_a", expiresAt: renewed.expiresAt },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
    });
    expect(offlineStore.serializedSnapshot()).toBe(snapshot);
    expect(watched.store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("CAN-05 current register GET AUTH_REQUIRED retires offline presentation", async () => {
    await expectCurrentAuthClosed("register");
  });

  test("CAN-05 current active-shift AUTH_REQUIRED retires offline presentation", async () => {
    await expectCurrentAuthClosed("shift");
  });

  test("CAN-05 stale restore does not apply a selected-register decision", async () => {
    const watched = watchRegisterPreference();
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const registers = stubRegisters();
    const held = holdAuthClosedLookup(registers, "register", "reg_a");
    const { runtime } = cashierRuntime({
      registers,
      assigned: ["reg_a"],
      store: watched.store,
      offlineStore,
    });
    const pending = runtime.restore();
    await held.started;
    await runtime.signOut();
    held.release();
    await pending;
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
    });
    expect(watched.writes).toEqual([]);
    expect(watched.clears).toEqual([]);
    expect(watched.store.read("org_a", "cashier_a")).toBeNull();
    expect(offlineStore.serializedSnapshot()).toBeNull();
  });

  test("successful register and open shift become ready authority", async () => {
    const { runtime } = controller(stubRegisters());
    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      register: { id: "reg_a" },
      selectedRegisterId: "reg_a",
      shiftOpen: true,
      shift: { id: SHIFT_A.id },
    });
  });

  test("refresh picks up a cashier register assignment and later revocation", async () => {
    let assigned: readonly string[] = [];
    const { runtime } = controller(stubRegisters(), () => assigned);
    await runtime.restore();
    expect(runtime.getState().assignedRegisterIds).toEqual([]);
    expect(runtime.getState().register).toBeNull();

    assigned = ["reg_a"];
    await runtime.refreshRegister();
    expect(runtime.getState().assignedRegisterIds).toEqual(["reg_a"]);
    expect(runtime.getState().register?.id).toBe("reg_a");

    assigned = [];
    await runtime.refreshRegister();
    expect(runtime.getState().assignedRegisterIds).toEqual([]);
    expect(runtime.getState().register).toBeNull();
    expect(runtime.getState().shiftOpen).toBe(false);
  });

  test("transient register GET failure preserves previously verified authority", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    registers.getImpl = async () => fail("INTEGRATION_UNAVAILABLE", "register lookup timed out");
    await runtime.refreshRegister();
    const state = runtime.getState();
    expect(state.status).toBe("ready");
    expect(state.register?.id).toBe("reg_a");
    expect(state.shift?.id).toBe(SHIFT_A.id);
    expect(state.shiftOpen).toBe(true);
    expect(state.errorMessage).toContain("timed out");
  });

  test("transient activeShift failure preserves previous shift", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    registers.shiftImpl = async () => fail("INTEGRATION_UNAVAILABLE", "active shift lookup timed out");
    await runtime.refreshRegister();
    const state = runtime.getState();
    expect(state.register?.id).toBe("reg_a");
    expect(state.shift?.id).toBe(SHIFT_A.id);
    expect(state.shiftOpen).toBe(true);
    expect(state.errorMessage).toContain("timed out");
  });

  test("authoritative null active shift clears shift", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    registers.shiftImpl = async () => ok(null);
    await runtime.refreshRegister();
    expect(runtime.getState().shift).toBeNull();
    expect(runtime.getState().shiftOpen).toBe(false);
    expect(runtime.getState().register?.id).toBe("reg_a");
  });

  test("expired session on register GET fails closed and clears authority", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers);
    await runtime.restore();
    registers.getImpl = async () => fail("AUTH_REQUIRED", "staff session is expired or revoked");
    await runtime.refreshRegister();
    expect(runtime.getState()).toMatchObject({
      status: "expired",
      session: null,
      register: null,
      shift: null,
      shiftOpen: false,
    });
  });

  test("forbidden register GET clears only the selection and keeps the staff session", async () => {
    const registers = stubRegisters();
    const { runtime, store } = controller(registers);
    await runtime.restore();
    registers.getImpl = async () => fail("FORBIDDEN", "register is out of staff scope");
    await runtime.refreshRegister();
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
      selectedRegisterId: null,
      register: null,
      shift: null,
      shiftOpen: false,
    });
    expect(store.read("org_a", "cashier_a")).toBeNull();
    expect(runtime.getState().errorMessage).toContain("not permitted");
  });

  test("explicit sign-out clears state", async () => {
    const { runtime } = controller(stubRegisters());
    await runtime.restore();
    await runtime.signOut();
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      register: null,
      shift: null,
      shiftOpen: false,
    });
  });
});

describe("offline cold-start presentation continuity", () => {
  test("offline session transport failure restores the last verified presentation but never checkout authority", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const verifiedAuthority = {
      status: "ready" as const,
      session: SESSION,
      assignedLocationIds: ["loc_a1"],
      assignedRegisterIds: ["reg_a"],
      assignedRegisters: [REGISTER_A],
      selectedRegisterId: "reg_a",
      register: REGISTER_A,
      shift: SHIFT_A,
      shiftOpen: true,
    };
    const verifiedAt = new Date("2026-09-21T10:00:00.000Z");
    offlineStore.write(verifiedAuthority, verifiedAt);

    let online = false;
    let sessionResult: ApiResult<{
      session: Session;
      assignedLocationIds: readonly string[];
      assignedRegisterIds: readonly string[];
    }> = fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");

    const gateway = {
      async establish() {
        return sessionResult;
      },
      async readContext() {
        return sessionResult;
      },
      async read() {
        return sessionResult.ok ? sessionResult.data.session : null;
      },
      async clear() {
        return;
      },
    };

    const runtime = createStaffRuntimeController({
      gateway,
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => online,
      now: () => new Date("2026-09-21T11:00:00.000Z"),
    });

    await runtime.restore();
    const offline = runtime.getState();
    expect(offline).toMatchObject({
      status: "ready",
      presentationOnly: true,
      session: { actorId: "cashier_a" },
      register: { id: "reg_a" },
      shift: { id: SHIFT_A.id },
    });
    expect(checkoutScopeFromStaffAuthority(offline)).toBeUndefined();

    online = true;
    sessionResult = ok({
      session: SESSION,
      assignedLocationIds: ["loc_a1"],
      assignedRegisterIds: ["reg_a"],
    });
    await runtime.refreshRegister();

    const restored = runtime.getState();
    expect(restored.status).toBe("ready");
    expect(restored.presentationOnly).not.toBe(true);
    expect(restored.register?.id).toBe("reg_a");
    expect(restored.shift?.id).toBe(SHIFT_A.id);
    expect(checkoutScopeFromStaffAuthority(restored)).toEqual({
      registerId: "reg_a",
      shiftId: SHIFT_A.id,
      deviceId: SHIFT_A.deviceId,
    });
  });

  test("transport failure restores cached presentation even when browser connectivity reports online", async () => {
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

    const unavailableResult: ApiResult<{
      session: Session;
      assignedLocationIds: readonly string[];
      assignedRegisterIds: readonly string[];
    }> = fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
    const gateway = {
      async establish() {
        return unavailableResult;
      },
      async readContext() {
        return unavailableResult;
      },
      async read() {
        return null;
      },
      async clear() {
        return;
      },
    };

    const runtime = createStaffRuntimeController({
      gateway,
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => true,
      now: () => new Date("2026-09-21T11:00:00.000Z"),
    });

    await runtime.restore();
    const degraded = runtime.getState();
    expect(degraded).toMatchObject({
      status: "ready",
      presentationOnly: true,
      session: { actorId: "cashier_a" },
      register: { id: "reg_a" },
      shift: { id: SHIFT_A.id },
    });
    expect(degraded.errorMessage).toContain("Connection unavailable");
    expect(checkoutScopeFromStaffAuthority(degraded)).toBeUndefined();
  });

  test("explicit sign-out clears the offline presentation cache", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const registers = stubRegisters();
    const runtime = createStaffRuntimeController({
      gateway: createBffStaffSessionGateway({
        fetchImpl: sessionFetch(() => ["reg_a"]),
        correlationId: () => CORRELATION,
      }),
      auth: authStub(),
      registers,
      offlinePresentationStore: offlineStore,
      isOnline: () => true,
      now: () => new Date("2026-09-21T11:00:00.000Z"),
    });

    await runtime.restore();
    expect(offlineStore.read(new Date("2026-09-21T11:01:00.000Z"))).not.toBeNull();
    await runtime.signOut();
    expect(offlineStore.read(new Date("2026-09-21T11:01:00.000Z"))).toBeNull();
  });

  test("offline cold start after online session expiry still presents the cashier inside grace", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const verifiedAt = new Date("2026-09-21T10:00:00.000Z");
    offlineStore.write(
      {
        status: "ready",
        session: { ...SESSION, expiresAt: "2026-09-21T12:00:00.000Z" },
        assignedLocationIds: ["loc_a1"],
        assignedRegisterIds: ["reg_a"],
        assignedRegisters: [REGISTER_A],
        selectedRegisterId: "reg_a",
        register: REGISTER_A,
        shift: SHIFT_A,
        shiftOpen: true,
      },
      verifiedAt,
    );
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
        },
        async readContext() {
          return fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
        },
        async read() {
          return null;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => false,
      now: () => new Date("2026-09-21T13:00:00.000Z"),
    });

    await runtime.restore();
    const state = runtime.getState();
    expect(state).toMatchObject({
      status: "ready",
      presentationOnly: true,
      session: { actorId: "cashier_a", organizationId: "org_a" },
      register: { id: "reg_a" },
      lastVerifiedAt: "2026-09-21T10:00:00.000Z",
    });
    expect(state.errorMessage).toContain("Offline — staff access last verified at");
    expect(state.errorMessage).not.toContain("Signed in");
    expect(checkoutScopeFromStaffAuthority(state)).toBeUndefined();
    expect(await runtime.selectRegister("reg_a")).toBe(false);
    runtime.applyShift(SHIFT_A);
    expect(runtime.getState().presentationOnly).toBe(true);
  });

  test("elapsed offline grace requires sign-in and does not revive after the clock moves backward", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const verifiedAt = new Date("2026-09-21T10:00:00.000Z");
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
      verifiedAt,
    );
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
        },
        async readContext() {
          return fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
        },
        async read() {
          return null;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => false,
      now: () => new Date(verifiedAt.getTime() + OFFLINE_STAFF_PRESENTATION_MAX_AGE_MS + 1),
    });

    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "expired",
      session: null,
      errorMessage: OFFLINE_GRACE_EXPIRED_MESSAGE,
    });
    expect(offlineStore.read(new Date(verifiedAt.getTime() + 60_000))).toBeNull();
  });

  test("authoritative session denial retires the cached presentation", async () => {
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
          return fail("AUTH_REQUIRED", "staff session is expired or revoked");
        },
        async readContext() {
          return fail("FORBIDDEN", "staff access is disabled");
        },
        async read() {
          return null;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => true,
      now: () => new Date("2026-09-21T13:00:00.000Z"),
    });

    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "unauthorized",
      session: null,
    });
    expect(offlineStore.read(new Date("2026-09-21T13:00:00.000Z"))).toBeNull();
  });

  test("expired register authority retires the cached presentation", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const registers = stubRegisters();
    const runtime = createStaffRuntimeController({
      gateway: createBffStaffSessionGateway({
        fetchImpl: sessionFetch(() => ["reg_a"]),
        correlationId: () => CORRELATION,
      }),
      auth: authStub(),
      registers,
      offlinePresentationStore: offlineStore,
      now: () => new Date("2026-09-21T11:00:00.000Z"),
    });

    await runtime.restore();
    expect(offlineStore.read(new Date("2026-09-21T11:00:00.000Z"))?.session?.actorId).toBe("cashier_a");
    registers.getImpl = async () => fail("AUTH_REQUIRED", "staff session is expired or revoked");
    await runtime.refreshRegister();
    expect(runtime.getState().status).toBe("expired");
    expect(offlineStore.read(new Date("2026-09-21T11:00:00.000Z"))).toBeNull();
  });

  test("successful verification of cashier B replaces cashier A's cached presentation", async () => {
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
    const sessionB: Session = { ...SESSION, actorId: "cashier_b", displayName: "Cashier B" };
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          return ok({
            session: sessionB,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a"],
          });
        },
        async readContext() {
          return ok({
            session: sessionB,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a"],
          });
        },
        async read() {
          return sessionB;
        },
        async clear() {
          return;
        },
      },
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => true,
      now: () => new Date("2026-09-21T12:00:00.000Z"),
    });

    await runtime.restore();
    expect(runtime.getState().session?.actorId).toBe("cashier_b");
    expect(runtime.getState().presentationOnly).not.toBe(true);
    const cached = offlineStore.read(new Date("2026-09-21T12:30:00.000Z"));
    expect(cached?.session?.actorId).toBe("cashier_b");
    expect(cached?.session?.displayName).toBe("Cashier B");
    expect(cached?.presentationOnly).toBe(true);
  });
});

describe("explicit sign-out retires local authority before remote logout", () => {
  const verifiedAt = new Date("2026-09-21T10:00:00.000Z");
  const later = new Date("2026-09-21T11:00:00.000Z");

  function commercialEvidence() {
    return {
      drafts: [{ cartId: "11111111-1111-4111-8111-111111111111" }],
      journal: [{ id: "22222222-2222-4222-8222-222222222222", status: "pending" }],
      checkoutAttempt: { transactionId: "tx-1", idempotencyKey: "idem-1" },
    };
  }

  function seedPresentation(store: ReturnType<typeof createMemoryOfflineStaffPresentationStore>) {
    store.write(
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
      verifiedAt,
    );
  }

  function unavailableGateway(clear: () => Promise<void>) {
    return {
      async establish() {
        return fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
      },
      async readContext() {
        return fail("INTEGRATION_UNAVAILABLE", "staff session transport failed");
      },
      async read() {
        return null;
      },
      clear,
    };
  }

  test("gateway clear rejection still retires local presentation and keeps commercial evidence", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const evidence = commercialEvidence();
    seedPresentation(offlineStore);
    const runtime = createStaffRuntimeController({
      gateway: unavailableGateway(async () => {
        throw new Error("session gateway unreachable");
      }),
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => false,
      now: () => later,
    });

    await runtime.signOut();
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      errorMessage: REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE,
    });
    expect(offlineStore.read(later)).toBeNull();
    await runtime.restore();
    expect(runtime.getState().session).toBeNull();
    expect(runtime.getState().status).not.toBe("ready");
    expect(evidence).toEqual(commercialEvidence());

    await runtime.signOut();
    expect(runtime.getState().session).toBeNull();
    expect(offlineStore.read(later)).toBeNull();
    expect(evidence).toEqual(commercialEvidence());
  });

  test("auth provider sign-out rejection still retires local presentation", async () => {
    // The production Supabase adapter's signOut() returns without a network call,
    // so that adapter cannot reject. StaffAuthProvider.signOut() can reject, and
    // this is the runtime boundary that must stay local-first.
    await expect(createPublicSupabaseStaffAuthProvider().signOut()).resolves.toBeUndefined();

    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const evidence = commercialEvidence();
    seedPresentation(offlineStore);
    const runtime = createStaffRuntimeController({
      gateway: unavailableGateway(async () => undefined),
      auth: {
        async signIn() {
          return { accessToken: "staff-access-token", correlationId: CORRELATION };
        },
        async signOut() {
          expect(offlineStore.read(later)).toBeNull();
          expect(runtime.getState().status).toBe("signed_out");
          expect(runtime.getState().session).toBeNull();
          throw new Error("provider sign-out failed");
        },
      },
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => false,
      now: () => later,
    });

    await runtime.signOut();
    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      errorMessage: REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE,
    });
    expect(offlineStore.read(later)).toBeNull();
    await runtime.restore();
    expect(runtime.getState().session).toBeNull();
    expect(runtime.getState().presentationOnly).not.toBe(true);
    expect(evidence).toEqual(commercialEvidence());
  });

  test("AppShell lock still retires local authority when identity sign-out rejects", async () => {
    const offlineStore = createMemoryOfflineStaffPresentationStore();
    const evidence = commercialEvidence();
    seedPresentation(offlineStore);
    const runtime = createStaffRuntimeController({
      gateway: unavailableGateway(async () => {
        throw new Error("runtime gateway unreachable");
      }),
      auth: authStub(),
      registers: stubRegisters(),
      offlinePresentationStore: offlineStore,
      isOnline: () => false,
      now: () => later,
    });
    const identity = createStaffIdentityPort({
      gateway: {
        async read() {
          return null;
        },
        async clear() {
          expect(offlineStore.read(later)).toBeNull();
          expect(runtime.getState().status).toBe("signed_out");
          expect(runtime.getState().session).toBeNull();
          throw new Error("identity session clear failed");
        },
      },
      correlationId: () => CORRELATION,
      localWork: { drafts: evidence.drafts, journal: evidence.journal },
    });

    let locked = Promise.resolve();
    const onLock = () => {
      locked = lockStaffSession({ identity, runtime });
    };
    const click = findLockClick(renderElement(AppShell({
      activeRoute: "sell",
      cashierDisplayName: "Cashier A",
      onLock,
      children: "Sell",
    })));
    expect(click).toBeTypeOf("function");
    click?.();
    await locked;

    expect(runtime.getState()).toMatchObject({
      status: "signed_out",
      session: null,
      errorMessage: REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE,
    });
    expect(offlineStore.read(later)).toBeNull();
    await runtime.restore();
    expect(runtime.getState().session).toBeNull();
    expect(runtime.getState().status).not.toBe("ready");
    expect(evidence).toEqual(commercialEvidence());

    const again = lockStaffSession({ identity, runtime });
    await expect(again).resolves.toBeUndefined();
    expect(runtime.getState().session).toBeNull();
    expect(offlineStore.read(later)).toBeNull();
    expect(evidence).toEqual(commercialEvidence());
  });
});

describe("assigned register selection", () => {
  test("A. one assignment auto-selects A and loads A plus active shift A", async () => {
    const registers = stubRegisters();
    const { runtime } = controller(registers, ["reg_a"]);
    await runtime.restore();
    expect(registers.got).toContain("reg_a");
    expect(registers.shifted).toContain("reg_a");
    expect(runtime.getState()).toMatchObject({
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
      shift: { id: SHIFT_A.id, registerId: "reg_a" },
      shiftOpen: true,
    });
  });

  test("B. two assignments with no stored choice do not auto-select the first register", async () => {
    const registers = stubRegisters();
    const { runtime, store } = controller(registers, ["reg_a", "reg_b"]);
    await runtime.restore();
    const state = runtime.getState();
    expect(state.selectedRegisterId).toBeNull();
    expect(state.register).toBeNull();
    expect(state.shift).toBeNull();
    expect(state.shiftOpen).toBe(false);
    expect(store.read("org_a", "cashier_a")).toBeNull();
    expect(registers.shifted).toEqual([]);
  });

  test("C. explicit select B loads B, activeShift(B), and persists B", async () => {
    const registers = stubRegisters();
    const { runtime, store } = controller(registers, ["reg_a", "reg_b"]);
    await runtime.restore();
    const accepted = await runtime.selectRegister("reg_b");
    expect(accepted).toBe(true);
    expect(runtime.getState()).toMatchObject({
      selectedRegisterId: "reg_b",
      register: { id: "reg_b", name: "Back Counter" },
      shift: { id: SHIFT_B.id, registerId: "reg_b" },
      shiftOpen: true,
    });
    expect(store.read("org_a", "cashier_a")).toBe("reg_b");
    expect(registers.shifted).toContain("reg_b");
  });

  test("D. refresh restores stored B with authoritative B register and shift", async () => {
    const store = createMemorySelectedRegisterStore({
      [selectedRegisterStorageKey("org_a", "cashier_a")]: "reg_b",
    });
    const registers = stubRegisters();
    const { runtime } = controller(registers, ["reg_a", "reg_b"], store);
    await runtime.restore();
    expect(runtime.getState().selectedRegisterId).toBe("reg_b");
    expect(runtime.getState().register?.id).toBe("reg_b");
    expect(runtime.getState().shift?.id).toBe(SHIFT_B.id);
    await runtime.refreshRegister();
    expect(runtime.getState().selectedRegisterId).toBe("reg_b");
    expect(runtime.getState().register?.id).toBe("reg_b");
    expect(runtime.getState().shift?.id).toBe(SHIFT_B.id);
  });

  test("E. deassignment clears stored B and does not keep B's shift", async () => {
    const store = createMemorySelectedRegisterStore({
      [selectedRegisterStorageKey("org_a", "cashier_a")]: "reg_b",
    });
    let assigned: readonly string[] = ["reg_a", "reg_b"];
    const registers = stubRegisters();
    const { runtime } = controller(registers, () => assigned, store);
    await runtime.restore();
    expect(runtime.getState().shift?.id).toBe(SHIFT_B.id);
    assigned = ["reg_a"];
    await runtime.restore();
    expect(runtime.getState().selectedRegisterId).toBe("reg_a");
    expect(runtime.getState().register?.id).toBe("reg_a");
    expect(runtime.getState().shift?.id).toBe(SHIFT_A.id);
    expect(runtime.getState().shift?.registerId).toBe("reg_a");
    expect(store.read("org_a", "cashier_a")).toBe("reg_a");
  });

  test("F. unauthorized select C is rejected without mutation or persistence", async () => {
    const registers = stubRegisters();
    const { runtime, store } = controller(registers, ["reg_a", "reg_b"]);
    await runtime.restore();
    const before = runtime.getState();
    const accepted = await runtime.selectRegister("reg_c");
    expect(accepted).toBe(false);
    expect(runtime.getState()).toEqual(before);
    expect(store.read("org_a", "cashier_a")).toBeNull();
  });

  test("G. forbidden explicit register selection is rejected without poisoning preference or signing out", async () => {
    const registers = stubRegisters();
    const originalGet = registers.getImpl;
    registers.getImpl = async (id) =>
      id === "reg_b" ? fail("FORBIDDEN", "register is out of staff scope") : originalGet(id);
    const { runtime, store } = controller(registers, ["reg_a", "reg_b"]);

    await runtime.restore();
    const accepted = await runtime.selectRegister("reg_b");

    expect(accepted).toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
      selectedRegisterId: null,
      register: null,
      shift: null,
      shiftOpen: false,
    });
    expect(store.read("org_a", "cashier_a")).toBeNull();
  });

  test("H. forbidden explicit switch preserves previously valid register and preference", async () => {
    const store = createMemorySelectedRegisterStore({
      [selectedRegisterStorageKey("org_a", "cashier_a")]: "reg_a",
    });
    const registers = stubRegisters();
    const originalGet = registers.getImpl;
    registers.getImpl = async (id) =>
      id === "reg_b" ? fail("FORBIDDEN", "register is out of staff scope") : originalGet(id);
    const { runtime } = controller(registers, ["reg_a", "reg_b"], store);

    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
      shift: { id: SHIFT_A.id },
      shiftOpen: true,
    });

    const accepted = await runtime.selectRegister("reg_b");

    expect(accepted).toBe(false);
    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
      selectedRegisterId: "reg_a",
      register: { id: "reg_a" },
      shift: { id: SHIFT_A.id },
      shiftOpen: true,
    });
    expect(store.read("org_a", "cashier_a")).toBe("reg_a");
    expect(runtime.getState().errorMessage).toContain("not permitted");
  });

  test("I. poisoned forbidden stored register is cleared on restore without sign-in loop", async () => {
    const store = createMemorySelectedRegisterStore({
      [selectedRegisterStorageKey("org_a", "cashier_a")]: "reg_b",
    });
    const registers = stubRegisters();
    const originalGet = registers.getImpl;
    registers.getImpl = async (id) =>
      id === "reg_b" ? fail("FORBIDDEN", "register is out of staff scope") : originalGet(id);
    const { runtime } = controller(registers, ["reg_a", "reg_b"], store);

    await runtime.restore();

    expect(runtime.getState()).toMatchObject({
      status: "ready",
      session: { actorId: "cashier_a" },
      selectedRegisterId: null,
      register: null,
      shift: null,
      shiftOpen: false,
    });
    expect(store.read("org_a", "cashier_a")).toBeNull();
  });

  test("J. checkout scope uses selected B / shift B, not A", async () => {
    const { runtime } = controller(stubRegisters(), ["reg_a", "reg_b"]);
    await runtime.restore();
    await runtime.selectRegister("reg_b");
    const scope = checkoutScopeFromStaffAuthority(runtime.getState());
    expect(scope).toEqual({
      registerId: "reg_b",
      shiftId: SHIFT_B.id,
      deviceId: SHIFT_B.deviceId,
    });
    expect(scope?.registerId).not.toBe("reg_a");
    expect(scope?.shiftId).not.toBe(SHIFT_A.id);
  });

  test("checkout stays fail-closed until a register is selected", () => {
    expect(
      checkoutScopeFromStaffAuthority(
        {
          status: "ready",
          session: SESSION,
          assignedLocationIds: ["loc_a1"],
          assignedRegisterIds: ["reg_a", "reg_b"],
          assignedRegisters: [REGISTER_A, REGISTER_B],
          selectedRegisterId: null,
          register: null,
          shift: null,
          shiftOpen: false,
        },
      ),
    ).toBeUndefined();
  });

  test("a shift belonging to another register is not reusable as checkout scope", () => {
    expect(
      checkoutScopeFromStaffAuthority(
        {
          status: "ready",
          session: SESSION,
          assignedLocationIds: ["loc_a1"],
          assignedRegisterIds: ["reg_a", "reg_b"],
          assignedRegisters: [REGISTER_A, REGISTER_B],
          selectedRegisterId: "reg_b",
          register: REGISTER_B,
          shift: SHIFT_A,
          shiftOpen: true,
        },
      ),
    ).toBeUndefined();
  });
});

type RenderedNode = {
  type?: unknown;
  props?: {
    onClick?: () => void;
    "aria-label"?: string;
    children?: unknown;
  };
};

function renderElement(node: unknown): unknown {
  if (Array.isArray(node)) return node.map((child) => renderElement(child));
  if (!node || typeof node !== "object") return node;
  const element = node as RenderedNode;
  if (typeof element.type === "function") {
    return renderElement((element.type as (props: unknown) => unknown)(element.props));
  }
  if (!element.props?.children) return element;
  return {
    type: element.type,
    props: {
      ...element.props,
      children: renderElement(element.props.children),
    },
  };
}

function findLockClick(node: unknown): (() => void) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findLockClick(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const element = node as RenderedNode;
  if (element.props?.["aria-label"] === "Lock register" && element.props.onClick) {
    return element.props.onClick;
  }
  return findLockClick(element.props?.children);
}

function stubRegisters(): RegisterPort & {
  got: string[];
  shifted: string[];
  getImpl: (id: string) => Promise<ApiResult<Register>>;
  shiftImpl: (id: string) => Promise<ApiResult<Shift | null>>;
} {
  const byId: Record<string, Register> = { reg_a: REGISTER_A, reg_b: REGISTER_B };
  const shiftById: Record<string, Shift> = { reg_a: SHIFT_A, reg_b: SHIFT_B };
  const port = {
    got: [] as string[],
    shifted: [] as string[],
    getImpl: async (id: string): Promise<ApiResult<Register>> => {
      const register = byId[id];
      return register ? ok(register) : fail("NOT_FOUND", "register was not found");
    },
    shiftImpl: async (id: string): Promise<ApiResult<Shift | null>> => ok(shiftById[id] ?? null),
    async get(id: string) {
      port.got.push(id);
      return port.getImpl(id);
    },
    async activeShift(id: string) {
      port.shifted.push(id);
      return port.shiftImpl(id);
    },
    open: async () => ok(SHIFT_A),
    cashMovement: async () => fail("INTEGRATION_UNAVAILABLE", "unused"),
    close: async () => ok(SHIFT_A),
    report: async () => fail("INTEGRATION_UNAVAILABLE", "unused"),
  };
  return port;
}
