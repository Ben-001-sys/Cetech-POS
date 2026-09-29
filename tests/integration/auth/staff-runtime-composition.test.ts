import { describe, expect, test } from "vitest";
import { createBffStaffSessionGateway } from "../../../apps/pos-web/src/core/identity/bff-staff-session-gateway";
import { createStaffRuntimeController } from "../../../apps/pos-web/src/core/identity/staff-runtime";
import { createPublicSupabaseStaffAuthProvider } from "../../../apps/pos-web/src/core/identity/staff-auth-provider";
import { STAFF_CSRF_HEADER } from "../../../apps/pos-web/src/config/auth";
import type { ApiResult, RegisterPort } from "../../../docs/contracts/ports";
import type { Register, Session, Shift } from "../../../docs/contracts/domain.generated";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION: Session = {
  actorId: "cashier_a",
  displayName: "Cashier A",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
  capabilities: ["ui.hint.only"],
  expiresAt: "2099-01-01T00:00:00.000Z",
};
const REGISTER: Register = {
  id: "reg_a",
  name: "Front Counter",
  locationId: "loc_a1",
  currency: "GHS",
  status: "active",
};
const OPEN_SHIFT: Shift = {
  id: "s1111111-1111-4111-8111-111111111111",
  registerId: "reg_a",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  cashierId: "cashier_a",
  status: "open",
  openingFloat: { minor: 50000, currency: "GHS" },
  openedAt: "2026-09-17T08:00:00.000Z",
};

function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data, correlationId: CORRELATION };
}

describe("STG-02 staff runtime composition", () => {
  test("browser mutations send the readable CSRF cookie in x-csrf-token", async () => {
    const cookies = "cetech_pos_csrf=csrf-token-1";
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        cookie: cookies,
      },
    });
    const headers: string[] = [];
    const fetchImpl: typeof fetch = (async (_input, init) => {
      headers.push(new Headers(init?.headers).get(STAFF_CSRF_HEADER) ?? "");
      return new Response(
        JSON.stringify({
          ok: true,
          correlationId: CORRELATION,
          data: { signedOut: true, localWorkPreserved: true },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const gateway = createBffStaffSessionGateway({ fetchImpl, correlationId: () => CORRELATION });
    await gateway.clear();
    expect(headers).toEqual(["csrf-token-1"]);
  });

  test("restore does not invent staff or shift authority when the BFF session is missing", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "staff session is required",
            retryable: false,
            nextAction: "reauthenticate",
          },
          correlationId: CORRELATION,
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const registers = stubRegisters(null);
    const runtime = createStaffRuntimeController({
      gateway: createBffStaffSessionGateway({ fetchImpl, correlationId: () => CORRELATION }),
      auth: {
        async signIn() {
          throw new Error("sign-in must not be invented");
        },
        async signOut() {
          return;
        },
      },
      registers,
    });
    await runtime.restore();
    const state = runtime.getState();
    expect(state.status).toBe("signed_out");
    expect(state.session).toBeNull();
    expect(state.shiftOpen).toBe(false);
    expect(state.register).toBeNull();
  });

  test("authoritative cashier, register and open shift drive runtime state", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: true,
          correlationId: CORRELATION,
          data: {
            session: SESSION,
            assignedLocationIds: ["loc_a1"],
            assignedRegisterIds: ["reg_a"],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const runtime = createStaffRuntimeController({
      gateway: createBffStaffSessionGateway({ fetchImpl, correlationId: () => CORRELATION }),
      auth: {
        async signIn() {
          return { accessToken: "staff-access-token", correlationId: CORRELATION };
        },
        async signOut() {
          return;
        },
      },
      registers: stubRegisters(OPEN_SHIFT),
    });
    await runtime.restore();
    const state = runtime.getState();
    expect(state.status).toBe("ready");
    expect(state.session?.displayName).toBe("Cashier A");
    expect(state.register?.name).toBe("Front Counter");
    expect(state.shiftOpen).toBe(true);
    expect(state.shift?.id).toBe(OPEN_SHIFT.id);

    runtime.applyShift(null);
    expect(runtime.getState().shiftOpen).toBe(false);
  });

  test("expired session restore fails closed and does not claim an open shift", async () => {
    const fetchImpl: typeof fetch = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: {
            code: "AUTH_REQUIRED",
            message: "staff session is expired or revoked",
            retryable: false,
            nextAction: "reauthenticate",
          },
          correlationId: CORRELATION,
        }),
        { status: 401, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const runtime = createStaffRuntimeController({
      gateway: createBffStaffSessionGateway({ fetchImpl, correlationId: () => CORRELATION }),
      auth: {
        async signIn() {
          throw new Error("must not sign in");
        },
        async signOut() {
          return;
        },
      },
      registers: stubRegisters(OPEN_SHIFT),
    });
    await runtime.restore();
    expect(runtime.getState()).toMatchObject({
      status: "expired",
      session: null,
      shiftOpen: false,
    });
  });

  test("public supabase adapter refuses service-role credentials", async () => {
    const provider = createPublicSupabaseStaffAuthProvider({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "service_role_key",
      },
      fetchImpl: (async () => {
        throw new Error("must not call identity provider");
      }) as typeof fetch,
    });
    await expect(provider.signIn({ email: "staff@example.test", password: "secret" })).rejects.toThrow(
      /not configured|could not be verified/,
    );
  });
});

function stubRegisters(shift: Shift | null): RegisterPort {
  return {
    async get() {
      return ok(REGISTER);
    },
    async activeShift() {
      return ok(shift);
    },
    open: async () => ok(OPEN_SHIFT),
    cashMovement: async () => ({
      ok: false,
      error: { code: "INTEGRATION_UNAVAILABLE", message: "unused", retryable: true, nextAction: "resolve" },
      correlationId: CORRELATION,
    }),
    close: async () => ok(OPEN_SHIFT),
    report: async () => ({
      ok: false,
      error: { code: "INTEGRATION_UNAVAILABLE", message: "unused", retryable: true, nextAction: "resolve" },
      correlationId: CORRELATION,
    }),
  };
}
