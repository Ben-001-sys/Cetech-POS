import { describe, expect, test } from "vitest";
import type { Session } from "../../../../../docs/contracts/domain.generated";
import type { PosRestFetch } from "../http/server-fetch";
import { createMemoryAssignmentDirectory } from "../auth/assignments";
import { createEphemeralInMemoryStaffSessionStore } from "../auth/session-store";
import { createMemoryControlPlaneDirectory } from "./control-plane-directory";
import { handleGetManagementReturnsAttention, presentManagementReturnsAttention } from "./handle-management-returns-attention";
import {
  createMemoryManagementReturnsAttentionDirectory,
  createSupabaseManagementReturnsAttentionDirectory,
  describeManagementReturnsAttention,
  MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT,
  selectManagementReturnsAttention,
  type ManagementReturnsAttentionDirectory,
  type ManagementReturnsAttentionItem,
} from "./management-returns-attention-directory";

const NOW = new Date("2026-09-22T16:00:00.000Z");
const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function item(
  overrides: Partial<ManagementReturnsAttentionItem> & Pick<ManagementReturnsAttentionItem, "id" | "priority" | "category">,
): ManagementReturnsAttentionItem {
  return {
    intervention: "required",
    organizationId: "org_a",
    locationId: "loc_a1",
    locationName: "Accra Main Store",
    registerId: "reg_a",
    registerName: "Register A",
    persistedStatus: "requires_attention",
    statusLabel: "Return needs attention",
    summary: "This return did not finish cleanly.",
    nextAction: "Review the existing return.",
    updatedAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

const rows: readonly ManagementReturnsAttentionItem[] = [
  item({
    id: "return:completed",
    category: "return",
    priority: "informational",
    intervention: "informational",
    persistedStatus: "completed",
    statusLabel: "Return completed",
    returnId: "11111111-1111-4111-8111-111111111111",
    transactionId: "22222222-2222-4222-8222-222222222222",
    saleId: "sale_a",
    amount: { minor: 2500, currency: "GHS" },
    updatedAt: "2026-09-22T15:00:00.000Z",
  }),
  item({
    id: "return:attention",
    category: "return",
    priority: "needs_attention",
    returnId: "33333333-3333-4333-8333-333333333333",
    transactionId: "44444444-4444-4444-8444-444444444444",
    saleId: "sale_attention",
    amount: { minor: 1500, currency: "GHS" },
    updatedAt: "2026-09-22T10:00:00.000Z",
    locationId: "loc_a2",
    locationName: "Tema Harbour",
  }),
  item({
    id: "refund:pending",
    category: "refund_reconciliation",
    priority: "awaiting_reconciliation",
    intervention: "blocked",
    persistedStatus: "pending",
    statusLabel: "Refund awaiting reconciliation",
    refundId: "55555555-5555-4555-8555-555555555555",
    returnId: "33333333-3333-4333-8333-333333333333",
    updatedAt: "2026-09-22T11:00:00.000Z",
  }),
  item({
    id: "org-b",
    category: "return",
    priority: "needs_attention",
    organizationId: "org_b",
    locationId: "loc_b1",
    locationName: "Other Org",
    returnId: "66666666-6666-4666-8666-666666666666",
  }),
];

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

async function cookieFor(actorId: string, locationIds: readonly string[] = ["loc_a1"]) {
  const sessions = createEphemeralInMemoryStaffSessionStore();
  const id = await sessions.create(session(actorId, locationIds), "csrf", new Date("2026-09-22T17:00:00.000Z"));
  return { sessions, cookieHeader: `cetech_pos_sid=${id}` };
}

function directory() {
  return createMemoryManagementReturnsAttentionDirectory(rows);
}

describe("ADMIN-105 returns and attention oversight", () => {
  test("owner sees organization-wide rows in priority order", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      returnsAttention: directory(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected rows");
    expect(result.data.scope).toEqual({ kind: "organization" });
    expect(result.data.rows.map((row) => row.id)).toEqual([
      "return:attention",
      "refund:pending",
      "return:completed",
    ]);
    expect(result.data.rows.some((row) => row.organizationId === "org_b")).toBe(false);
  });

  test("admin sees organization-wide rows", async () => {
    const { sessions, cookieHeader } = await cookieFor("admin_a", []);
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "admin_a", controlRole: "admin", status: "active" },
      ]),
      returnsAttention: directory(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected rows");
    expect(result.data.rows.map((row) => row.locationId)).toEqual(["loc_a2", "loc_a1", "loc_a1"]);
  });

  test("manager sees only the verified managed location", async () => {
    const { sessions, cookieHeader } = await cookieFor("manager_a", ["loc_a1", "loc_a2"]);
    const result = await handleGetManagementReturnsAttention({
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
      returnsAttention: directory(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected rows");
    expect(result.data.scope).toEqual({ kind: "locations", locationIds: ["loc_a1"] });
    expect(result.data.rows.every((row) => row.locationId === "loc_a1")).toBe(true);
    expect(result.data.rows.map((row) => row.id)).not.toContain("return:attention");
  });

  test("manager location query cannot widen scope", async () => {
    const { sessions, cookieHeader } = await cookieFor("manager_a", ["loc_a1", "loc_a2"]);
    const returnsAttention: ManagementReturnsAttentionDirectory = {
      async listOrganization() {
        throw new Error("unauthorized location must not be queried");
      },
    };
    const result = await handleGetManagementReturnsAttention({
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
      returnsAttention,
      locationId: "loc_a2",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected forbidden");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  test("support cannot access returns and approvals", async () => {
    const { sessions, cookieHeader } = await cookieFor("support_a", []);
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "support_a", controlRole: "support", status: "active" },
      ]),
      returnsAttention: directory(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected forbidden");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  test("cashier is forbidden", async () => {
    const { sessions, cookieHeader } = await cookieFor("cashier_a");
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([
        {
          actorId: "cashier_a",
          organizationId: "org_a",
          locationRoles: [{ locationId: "loc_a1", role: "cashier" }],
          registerIds: ["reg_a"],
        },
      ]),
      controlPlane: createMemoryControlPlaneDirectory([]),
      returnsAttention: directory(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected forbidden");
    expect(result.error.code).toBe("FORBIDDEN");
  });

  test("organization A cannot see organization B rows when the directory leaks them", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const leaky: ManagementReturnsAttentionDirectory = {
      async listOrganization() {
        return { rows, truncated: false };
      },
    };
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      returnsAttention: leaky,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected rows");
    expect(result.data.rows.some((row) => row.id === "org-b" || row.organizationId !== "org_a")).toBe(false);
  });

  test("data-store failure is unavailable rather than an empty success", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      returnsAttention: { async listOrganization() { return "unavailable"; } },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected unavailable");
    expect(result.error.code).toBe("INTEGRATION_UNAVAILABLE");
  });

  test("an authorized organization with no work is an empty success", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      returnsAttention: createMemoryManagementReturnsAttentionDirectory([]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected empty");
    expect(result.data.rows).toEqual([]);
    expect(result.data.limit).toBe(MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT);
  });

  test("identities stay intact and the read does not expose an effect command", async () => {
    const { sessions, cookieHeader } = await cookieFor("admin_a", []);
    let reads = 0;
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "admin_a", controlRole: "admin", status: "active" },
      ]),
      returnsAttention: {
        async listOrganization(input) {
          reads += 1;
          expect(input.organizationId).toBe("org_a");
          return { rows, truncated: false };
        },
      },
    });
    expect(reads).toBe(1);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected rows");
    const attention = result.data.rows.find((row) => row.id === "return:attention");
    expect(attention?.returnId).toBe("33333333-3333-4333-8333-333333333333");
    expect(attention?.transactionId).toBe("44444444-4444-4444-8444-444444444444");
    expect(attention?.saleId).toBe("sale_attention");
    expect(attention?.amount).toEqual({ minor: 1500, currency: "GHS" });
    expect(result.data.rows.find((row) => row.id === "refund:pending")?.refundId).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(JSON.stringify(result.data)).not.toContain("execute");
    expect(JSON.stringify(result.data)).not.toContain("restock");
  });

  test("stored statuses keep their real meaning", () => {
    expect(describeManagementReturnsAttention({
      category: "return",
      persistedStatus: "approval_required",
    })?.statusLabel).toBe("Approval required");
    expect(describeManagementReturnsAttention({
      category: "return",
      persistedStatus: "approved",
    })).toBeUndefined();
    expect(describeManagementReturnsAttention({
      category: "refund_reconciliation",
      persistedStatus: "pending",
    })?.priority).toBe("awaiting_reconciliation");
    expect(describeManagementReturnsAttention({
      category: "return_operation",
      persistedStatus: "requires_attention",
      operation: "bridge.stock_disposition",
    })?.statusLabel).toBe("Stock update needs attention");
  });

  test("selection is deterministic and bounded", () => {
    const many = Array.from({ length: MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT + 5 }, (_, index) =>
      item({
        id: `return:${String(index).padStart(3, "0")}`,
        category: "return",
        priority: "needs_attention",
        updatedAt: `2026-09-22T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
      }),
    );
    const selected = selectManagementReturnsAttention({ rows: many, organizationId: "org_a" });
    expect(selected.rows).toHaveLength(MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT);
    expect(selected.truncated).toBe(true);
    const updated = selected.rows.map((row) => row.updatedAt);
    expect([...updated].sort().reverse()).toEqual(updated);
  });
});

describe("management return action truth", () => {
  function preview(overrides: Partial<ManagementReturnsAttentionItem> = {}) {
    return item({
      id: "return:approval", category: "return", priority: "pending",
      persistedStatus: "approval_required", approvalState: "required",
      returnId: "33333333-3333-4333-8333-333333333333",
      previewExpiresAt: "2026-09-22T16:15:00.000Z",
      ...overrides,
    });
  }

  test("only a current approval-required preview at a managed location is approvable", () => {
    expect(presentManagementReturnsAttention(preview(), NOW, true).canApprove).toBe(true);
    const ownerOnly = presentManagementReturnsAttention(preview(), NOW, false);
    expect(ownerOnly.canApprove).toBe(false);
    expect(ownerOnly.actionUnavailableReason).toContain("Manager assignment");
    const nonApproval = presentManagementReturnsAttention(preview({ persistedStatus: "previewed", approvalState: undefined }), NOW, true);
    expect(nonApproval.canApprove).toBe(false);
    expect(nonApproval.actionUnavailableReason).toContain("not a pending approval");
    expect(presentManagementReturnsAttention(preview({ approvalState: "recorded" }), NOW, true).canApprove).toBe(false);
  });

  test("expired previews move into history with an explanation, not pending approvals", () => {
    for (const previewExpiresAt of [NOW.toISOString(), "2026-09-21T16:15:00.000Z"]) {
      const presented = presentManagementReturnsAttention(preview({ previewExpiresAt }), NOW, true);
      expect(presented.canApprove).toBe(false);
      expect(presented.previewState).toBe("expired");
      expect(presented.priority).toBe("informational");
      expect(presented.statusLabel).toBe("Return preview expired");
      expect(presented.actionUnavailableReason).toContain("cannot be approved or completed");
      expect(presented.persistedStatus).toBe("approval_required");
    }
  });

  test("missing or invalid expiry cannot imply an approvable preview", () => {
    for (const previewExpiresAt of [undefined, "invalid"]) {
      const presented = presentManagementReturnsAttention(preview({ previewExpiresAt }), NOW, true);
      expect(presented.canApprove).toBe(false);
      expect(presented.previewState).toBe("unavailable");
      expect(presented.actionUnavailableReason).toContain("could not be confirmed");
    }
  });

  test("old preview expiry does not remove existing executed-return attention", () => {
    const presented = presentManagementReturnsAttention(preview({
      persistedStatus: "requires_attention", priority: "needs_attention", approvalState: undefined,
      previewExpiresAt: "2026-09-21T16:15:00.000Z",
    }), NOW, true);
    expect(presented.priority).toBe("needs_attention");
    expect(presented.canApprove).toBe(false);
    expect(presented.previewState).toBeUndefined();
    expect(presented.canReview).toBe(true);
  });

  test("refund check remains scoped and a missing exact return reference is explained", () => {
    const refund = item({ id: "refund:a", category: "refund_reconciliation", priority: "awaiting_reconciliation", persistedStatus: "pending", refundId: "55555555-5555-4555-8555-555555555555" });
    expect(presentManagementReturnsAttention(refund, NOW, true).canReconcile).toBe(true);
    expect(presentManagementReturnsAttention(refund, NOW, false).canReconcile).toBe(false);
    const missing = presentManagementReturnsAttention(item({ id: "operation:a", category: "return_operation", priority: "needs_attention" }), NOW, true);
    expect(missing.canReview).toBe(false);
    expect(missing.reviewUnavailableReason).toContain("no exact return reference");
  });

  test("handler reranks expired previews below genuine attention and returns scoped action flags", async () => {
    const { sessions, cookieHeader } = await cookieFor("manager_a");
    const result = await handleGetManagementReturnsAttention({
      correlationId: CORRELATION, cookieHeader, now: NOW, sessions,
      assignments: createMemoryAssignmentDirectory([{ actorId: "manager_a", organizationId: "org_a", locationRoles: [{ locationId: "loc_a1", role: "manager" }], registerIds: ["reg_a"] }]),
      controlPlane: createMemoryControlPlaneDirectory([]),
      returnsAttention: createMemoryManagementReturnsAttentionDirectory([
        preview({ id: "expired", previewExpiresAt: NOW.toISOString() }),
        preview({ id: "current" }),
        item({ id: "attention", category: "return", priority: "needs_attention", returnId: "33333333-3333-4333-8333-333333333333" }),
      ]),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected view");
    expect(result.data.rows.map((row) => row.id)).toEqual(["attention", "current", "expired"]);
    expect(result.data.rows.find((row) => row.id === "current")?.canApprove).toBe(true);
    expect(result.data.rows.find((row) => row.id === "expired")?.canApprove).toBe(false);
  });
});

describe("ADMIN-105 returns attention supabase read model", () => {
  test("normalizes stored return, refund, and operation rows without executing them", async () => {
    const calls: string[] = [];
    const fetchImpl: PosRestFetch = async (url, init) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      expect(init.method ?? "GET").toBe("GET");
      return { ok: true, status: 200, json: async () => bodyFor(url) };
    };
    const listed = await createSupabaseManagementReturnsAttentionDirectory({
      url: "https://example.test",
      serviceRoleKey: "service-role",
      fetchImpl,
    }).listOrganization({ organizationId: "org_a", locationIds: ["loc_a1"] });
    expect(listed).not.toBe("unavailable");
    if (listed === "unavailable") throw new Error("expected rows");
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
    expect(calls.every((call) => call.includes("organization_id=eq.org_a"))).toBe(true);
    expect(calls.some((call) => call.includes("location_id=in.(loc_a1)"))).toBe(true);
    expect(calls.some((call) => call.includes("loc_a2"))).toBe(false);
    const attention = listed.rows.find((row) => row.persistedStatus === "requires_attention" && row.category === "return");
    expect(attention?.returnId).toBe("33333333-3333-4333-8333-333333333333");
    expect(attention?.amount).toEqual({ minor: 1500, currency: "GHS" });
    expect(attention?.locationName).toBe("Accra Main Store and Service Counter");
    expect(attention?.previewExpiresAt).toBe("2026-09-22T16:15:00.000Z");
    expect(calls.some((call) => call.includes("preview_expires_at"))).toBe(true);
    expect(listed.rows.find((row) => row.category === "refund_reconciliation")?.refundId).toBe(
      "55555555-5555-4555-8555-555555555555",
    );
    expect(listed.rows.map((row) => row.category)).toEqual([
      "commercial_refund",
      "return",
      "refund_reconciliation",
      "return_operation",
      "return",
    ]);
  });

  test("a failed return query is unavailable", async () => {
    const fetchImpl: PosRestFetch = async (url) => {
      if (url.includes("pos_returns") && url.includes("status=in.")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => [] };
    };
    await expect(createSupabaseManagementReturnsAttentionDirectory({
      url: "https://example.test",
      serviceRoleKey: "service-role",
      fetchImpl,
    }).listOrganization({ organizationId: "org_a" })).resolves.toBe("unavailable");
  });
});

function bodyFor(url: string): unknown {
  if (url.includes("pos_locations")) {
    return [{ id: "loc_a1", name: "Accra Main Store and Service Counter" }];
  }
  if (url.includes("pos_registers")) {
    return [{ id: "reg_a", name: "Front Register A" }];
  }
  if (url.includes("pos_returns") && url.includes("status=eq.completed")) {
    return [returnRow("completed", "2026-09-21T18:00:00.000Z")];
  }
  if (url.includes("pos_returns")) {
    return [returnRow("requires_attention", "2026-09-22T10:00:00.000Z")];
  }
  if (url.includes("pos_tender_refunds")) {
    return [{
      refund_id: "55555555-5555-4555-8555-555555555555",
      return_id: "33333333-3333-4333-8333-333333333333",
      organization_id: "org_a",
      location_id: "loc_a1",
      transaction_id: "44444444-4444-4444-8444-444444444444",
      status: "pending",
      amount_minor: "1500",
      currency: "GHS",
      updated_at: "2026-09-22T11:00:00.000Z",
    }];
  }
  if (url.includes("pos_commercial_refunds")) {
    return [{
      commercial_refund_id: "77777777-7777-4777-8777-777777777777",
      return_id: "33333333-3333-4333-8333-333333333333",
      organization_id: "org_a",
      location_id: "loc_a1",
      transaction_id: "44444444-4444-4444-8444-444444444444",
      sale_id: "sale_attention",
      status: "requires_attention",
      amount_minor: 1500,
      currency: "GHS",
      updated_at: "2026-09-22T11:30:00.000Z",
    }];
  }
  if (url.includes("pos_stock_dispositions")) return [];
  if (url.includes("pos_pending_operations")) {
    return [{
      organization_id: "org_a",
      location_id: "loc_a1",
      register_id: "reg_a",
      transaction_id: "44444444-4444-4444-8444-444444444444",
      operation: "refund.resolve",
      status: "response_unknown",
      created_at: "2026-09-22T09:00:00.000Z",
      last_attempt_at: "2026-09-22T09:05:00.000Z",
    }];
  }
  return [];
}

function returnRow(status: string, updatedAt: string) {
  return {
    return_id: status === "completed"
      ? "11111111-1111-4111-8111-111111111111"
      : "33333333-3333-4333-8333-333333333333",
    organization_id: "org_a",
    location_id: "loc_a1",
    register_id: "reg_a",
    transaction_id: "44444444-4444-4444-8444-444444444444",
    sale_id: "sale_attention",
    status,
    preview_expires_at: "2026-09-22T16:15:00.000Z",
    refund_total_minor: "1500",
    refund_currency: "GHS",
    updated_at: updatedAt,
  };
}
