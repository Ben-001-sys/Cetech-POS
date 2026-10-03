import { describe, expect, test } from "vitest";
import { createMemoryManagementTopologyDirectory, createSupabaseManagementTopologyDirectory } from "./management-topology-directory";

const shared = { organizationId: "org_a", actorId: "owner_a", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

describe("durable topology lifecycle failures", () => {
  test.each([
    [{ code: "55000", message: "unresolved shifts prevent topology change" }, "busy"],
    [{ code: "23514", message: "parent location is inactive" }, "inactive-parent"],
    [{ code: "23503", message: "location is outside the organization" }, "outside"],
    [{ code: "23514", message: "register currency cannot change after creation" }, "invalid"],
  ] as const)("preserves a specific failure instead of misclassifying it", async (body, expected) => {
    const directory = createSupabaseManagementTopologyDirectory({
      url: "https://test.supabase.co", serviceRoleKey: "synthetic",
      fetchImpl: async () => ({ ok: false, status: 400, json: async () => body }),
    });
    expect(await directory.saveLocation({ ...shared, locationId: "loc_a", name: "Shop", status: "inactive" })).toBe(expected);
  });

  test("inactive location cannot gain active registers or devices; history stays listed", async () => {
    const directory = createMemoryManagementTopologyDirectory([{
      id: "loc_a", name: "Closed branch", status: "inactive", registers: [], devices: [],
    }]);
    expect(await directory.saveRegister({ ...shared, locationId: "loc_a", name: "Front", currency: "GHS", status: "active" })).toBe("inactive-parent");
    expect(await directory.saveDevice({ ...shared, locationId: "loc_a", label: "Tablet", status: "active" })).toBe("inactive-parent");
    expect(await directory.listOrganization({ organizationId: "org_a" })).toEqual([{
      id: "loc_a", name: "Closed branch", status: "inactive", registers: [], devices: [],
    }]);
  });
});
