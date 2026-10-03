import { describe, expect, test } from "vitest";
import { createInMemoryCheckoutStore } from "../../core/checkout/in-memory-store";
import { openShift } from "./open-shift";

const NOW = new Date("2026-09-18T12:00:00.000Z");
const KEY = "55555555-5555-4555-8555-555555555501";
const CORRELATION = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DEVICE_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_DEVICE = "44444444-4444-4444-8444-444444444445";

const ACTOR = {
  actorId: "cashier_a",
  displayName: "Cashier A",
  organizationId: "org_a",
  locationIds: ["loc_a1"],
};

describe("STG-06 open-shift pre-send idempotency", () => {
  test("an inactive parent location rejects new shifts before idempotency or cash effects", async () => {
    const store = createInMemoryCheckoutStore();
    await store.seedRegister({ id: "reg_a1", name: "Register 1", locationId: "loc_a1", currency: "GHS", status: "active", organizationId: "org_a", locationStatus: "inactive" });
    await store.seedDevice({ id: DEVICE_ID, organizationId: "org_a", locationId: "loc_a1", status: "active" });
    const result = await openShift({ store, actor: ACTOR,
      request: { registerId: "reg_a1", deviceId: DEVICE_ID, openingFloat: { minor: 0, currency: "GHS" } },
      context: { idempotencyKey: KEY, correlationId: CORRELATION }, now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("location is inactive");
    expect(await store.peekIdempotency("org_a", "shift.open", KEY)).toBeUndefined();
    expect(await store.getActiveShift("reg_a1")).toBeUndefined();
  });
  test("device rejection before claim does not leave a pending idempotency row", async () => {
    const store = createInMemoryCheckoutStore();
    await store.seedRegister({
      id: "reg_a1",
      name: "Register 1",
      locationId: "loc_a1",
      currency: "GHS",
      status: "active",
      organizationId: "org_a",
    });
    await store.seedDevice({
      id: DEVICE_ID,
      organizationId: "org_a",
      locationId: "loc_a1",
      status: "active",
    });
    const result = await openShift({
      store,
      actor: ACTOR,
      request: {
        registerId: "reg_a1",
        deviceId: OTHER_DEVICE,
        openingFloat: { minor: 0, currency: "GHS" },
      },
      context: { idempotencyKey: KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
    expect(await store.peekIdempotency("org_a", "shift.open", KEY)).toBeUndefined();
  });

  test("open shift binds the register into the durable operation scope", async () => {
    const store = createInMemoryCheckoutStore();
    await store.seedRegister({
      id: "reg_a1",
      name: "Register 1",
      locationId: "loc_a1",
      currency: "GHS",
      status: "active",
      organizationId: "org_a",
    });
    await store.seedDevice({
      id: DEVICE_ID,
      organizationId: "org_a",
      locationId: "loc_a1",
      status: "active",
    });
    const originalClaim = store.claimIdempotency.bind(store);
    let capturedScope: unknown;
    store.claimIdempotency = async (...args) => {
      capturedScope = args[5];
      return originalClaim(...args);
    };

    const result = await openShift({
      store,
      actor: ACTOR,
      request: {
        registerId: "reg_a1",
        deviceId: DEVICE_ID,
        openingFloat: { minor: 0, currency: "GHS" },
      },
      context: { idempotencyKey: KEY, correlationId: CORRELATION },
      now: NOW,
    });

    expect(result.ok).toBe(true);
    expect(capturedScope).toEqual({ registerId: "reg_a1" });
  });

  test("successful open acknowledges the idempotency row", async () => {
    const store = createInMemoryCheckoutStore();
    await store.seedRegister({
      id: "reg_a1",
      name: "Register 1",
      locationId: "loc_a1",
      currency: "GHS",
      status: "active",
      organizationId: "org_a",
    });
    await store.seedDevice({
      id: DEVICE_ID,
      organizationId: "org_a",
      locationId: "loc_a1",
      status: "active",
    });
    const result = await openShift({
      store,
      actor: ACTOR,
      request: {
        registerId: "reg_a1",
        deviceId: DEVICE_ID,
        openingFloat: { minor: 0, currency: "GHS" },
      },
      context: { idempotencyKey: KEY, correlationId: CORRELATION },
      now: NOW,
    });
    expect(result.ok).toBe(true);
    expect(await store.peekIdempotency("org_a", "shift.open", KEY)).toBe("acknowledged");
  });
});
