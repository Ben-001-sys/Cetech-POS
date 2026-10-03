import { describe, expect, test } from "vitest";
import { createSupabaseCheckoutStore } from "./supabase-checkout-store";

describe("register parent lifecycle truth", () => {
  test("reads inactive parent without hiding a historical register", async () => {
    const store = createSupabaseCheckoutStore({ url: "https://test.supabase.co", serviceRoleKey: "synthetic",
      fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => url.includes("pos_locations?")
        ? [{ name: "Closed branch", status: "inactive" }]
        : [{ id: "reg_a", organization_id: "org_a", location_id: "loc_a", name: "Front", currency: "GHS", status: "active" }],
      }),
    });
    expect(await store.getRegister("reg_a")).toMatchObject({ id: "reg_a", locationStatus: "inactive", locationName: "Closed branch" });
  });

  test("missing lifecycle truth fails closed instead of treating the parent as active", async () => {
    const store = createSupabaseCheckoutStore({ url: "https://test.supabase.co", serviceRoleKey: "synthetic",
      fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => url.includes("pos_locations?")
        ? [{ name: "Shop" }]
        : [{ id: "reg_a", organization_id: "org_a", location_id: "loc_a", name: "Front", currency: "GHS", status: "active" }],
      }),
    });
    await expect(store.getRegister("reg_a")).rejects.toThrow("durable location lifecycle is unavailable");
  });
});
