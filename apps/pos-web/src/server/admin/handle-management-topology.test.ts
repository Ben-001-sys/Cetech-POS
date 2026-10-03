import { describe, expect, test } from "vitest";
import type { Session } from "../../../../../docs/contracts/domain.generated";
import { createMemoryAssignmentDirectory } from "../auth/assignments";
import { createEphemeralInMemoryStaffSessionStore } from "../auth/session-store";
import { createMemoryControlPlaneDirectory } from "./control-plane-directory";
import { handleGetManagementTopology, handleSaveManagementTopology } from "./handle-management-topology";
import { createMemoryManagementTopologyDirectory } from "./management-topology-directory";

const NOW = new Date("2026-09-22T16:00:00.000Z");
const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const topology = createMemoryManagementTopologyDirectory([
  {
    id: "loc_a1",
    name: "Accra",
    registers: [
      { id: "reg_a", name: "Register A", currency: "GHS", status: "active" },
      { id: "reg_a2", name: "Register A2", currency: "GHS", status: "active" },
    ],
    devices: [{ id: "device-a", label: "Counter tablet", status: "active" }],
  },
  {
    id: "loc_a2",
    name: "Tema",
    registers: [
      { id: "reg_b", name: "Register B", currency: "GHS", status: "active" },
    ],
    devices: [{ id: "device-b", label: "Tema terminal", status: "inactive" }],
  },
]);

function session(actorId: string, locationIds: readonly string[]): Session {
  return {
    actorId,
    displayName: actorId,
    organizationId: "org_a",
    locationIds,
    capabilities: [],
    expiresAt: "2026-09-22T17:00:00.000Z",
  };
}

async function cookieFor(actorId: string, locationIds: readonly string[]) {
  const sessions = createEphemeralInMemoryStaffSessionStore();
  const id = await sessions.create(
    session(actorId, locationIds),
    "csrf",
    new Date("2026-09-22T17:00:00.000Z"),
  );
  return { sessions, cookieHeader: `cetech_pos_sid=${id}` };
}

describe("ADMIN-105 management topology", () => {
  test("organization owner sees full organization topology", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const result = await handleGetManagementTopology({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        {
          organizationId: "org_a",
          actorId: "owner_a",
          controlRole: "owner",
          status: "active",
        },
      ]),
      topology,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected topology");
    expect(result.data.map((row) => row.id)).toEqual(["loc_a1", "loc_a2"]);
    expect(result.data[0]?.devices).toEqual([
      { id: "device-a", label: "Counter tablet", status: "active" },
    ]);
    expect(result.data[0]?.registers[0]).not.toHaveProperty("devices");
  });

  test("operational manager scope follows current durable manager assignments", async () => {
    const { sessions, cookieHeader } = await cookieFor("manager_a", ["loc_a1"]);
    const result = await handleGetManagementTopology({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([
        {
          actorId: "manager_a",
          organizationId: "org_a",
          locationRoles: [
            { locationId: "loc_a1", role: "manager" },
            { locationId: "loc_a2", role: "manager" },
          ],
          registerIds: ["reg_a", "reg_a2", "reg_b"],
        },
      ]),
      controlPlane: createMemoryControlPlaneDirectory([]),
      topology,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected topology");
    expect(result.data.map((row) => row.id)).toEqual(["loc_a1", "loc_a2"]);
  });

  test("support diagnostics role does not gain operational topology access", async () => {
    const { sessions, cookieHeader } = await cookieFor("support_a", []);
    const result = await handleGetManagementTopology({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        {
          organizationId: "org_a",
          actorId: "support_a",
          controlRole: "support",
          status: "active",
        },
      ]),
      topology,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected forbidden");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  test("owner can rename a location and cannot change a register currency", async () => {
    const directory = createMemoryManagementTopologyDirectory([
      {
        id: "loc_a1",
        name: "Accra",
        registers: [{ id: "reg_a", name: "Front", currency: "GHS", status: "active" }],
        devices: [],
      },
    ]);
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const saved = await handleSaveManagementTopology({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      topology: directory,
      change: { kind: "location", locationId: "loc_a1", name: "Accra Main", status: "active" },
      protection: {
        origin: "https://pos.example.test",
        referer: null,
        csrfCookie: "csrf",
        csrfHeader: "csrf",
        allowedOrigins: ["https://pos.example.test"],
      },
    });
    expect(saved.ok).toBe(true);
    const currency = await handleSaveManagementTopology({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      topology: directory,
      change: {
        kind: "register",
        registerId: "reg_a",
        locationId: "loc_a1",
        name: "Front",
        currency: "USD",
        status: "active",
      },
      protection: {
        origin: "https://pos.example.test",
        referer: null,
        csrfCookie: "csrf",
        csrfHeader: "csrf",
        allowedOrigins: ["https://pos.example.test"],
      },
    });
    expect(currency.ok).toBe(false);
    if (currency.ok) throw new Error("currency change must fail");
    expect(currency.error.code).toBe("VALIDATION_ERROR");
  });

  test("manager cannot change organization locations", async () => {
    const { sessions, cookieHeader } = await cookieFor("manager_a", ["loc_a1"]);
    const result = await handleSaveManagementTopology({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([
        {
          actorId: "manager_a",
          organizationId: "org_a",
          locationRoles: [{ locationId: "loc_a1", role: "manager" }],
          registerIds: ["reg_a"],
        },
      ]),
      controlPlane: createMemoryControlPlaneDirectory([]),
      topology,
      change: { kind: "location", name: "New store", status: "active" },
      protection: {
        origin: "https://pos.example.test",
        referer: null,
        csrfCookie: "csrf",
        csrfHeader: "csrf",
        allowedOrigins: ["https://pos.example.test"],
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("manager must not create locations");
    expect(result.error.code).toBe("FORBIDDEN");
  });
  test.each([
    ["busy", "SHIFT_CONFLICT", "Close or resolve affected shifts"],
    ["inactive-parent", "VALIDATION_ERROR", "Reactivate the location"],
  ] as const)("topology mutation %s returns an actionable, scoped failure", async (failure, code, message) => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const result = await handleSaveManagementTopology({
      correlationId: CORRELATION, cookieHeader, now: NOW, sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([{ organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" }]),
      topology: { ...topology, saveLocation: async () => failure },
      change: { kind: "location", locationId: "loc_a1", name: "Shop", status: "inactive" },
      protection: { origin: "https://pos.example.test", referer: null, csrfCookie: "csrf", csrfHeader: "csrf", allowedOrigins: ["https://pos.example.test"] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) { expect(result.error.code).toBe(code); expect(result.error.message).toContain(message); }
  });

});
