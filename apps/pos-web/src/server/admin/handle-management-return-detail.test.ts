import { describe, expect, test, vi } from "vitest";
import type { Session } from "../../../../../docs/contracts/domain.generated";
import type { PosSaleRecord } from "../../core/checkout/types";
import { createInMemoryReturnStore } from "../../core/returns/in-memory-store";
import type { StoredReturnRecord } from "../../core/returns/types";
import { createMemoryAssignmentDirectory } from "../auth/assignments";
import { createEphemeralInMemoryStaffSessionStore } from "../auth/session-store";
import { createMemoryControlPlaneDirectory } from "./control-plane-directory";
import { handleGetManagementReturnDetail } from "./handle-management-return-detail";

const NOW = new Date("2026-10-03T07:00:00.000Z");
const RETURN_ID = "33333333-3333-4333-8333-333333333333";
const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FINGERPRINT = "0123456789abcdef0123456789abcdef";

function savedReturn(overrides: Partial<StoredReturnRecord> = {}): StoredReturnRecord {
  return {
    returnId: RETURN_ID,
    organizationId: "org_a",
    locationId: "loc_a1",
    registerId: "reg_a",
    actorId: "cashier_a",
    transactionId: "44444444-4444-4444-8444-444444444444",
    saleId: "sale_a",
    economicsVersion: "hv1",
    fingerprint: FINGERPRINT,
    previewExpiresAt: "2026-10-03T07:15:00.000Z",
    approvalRequired: true,
    refundTotal: { minor: 999, currency: "GHS" },
    status: "approval_required",
    historicLines: [],
    historicTenders: [],
    requestedLines: [{
      orderLineId: "line_a",
      quantity: "1",
      requestedQuantity: "1",
      remainingReturnableQuantity: "1",
      reason: "Damaged packaging",
      condition: "damaged",
      intendedDisposition: "no_automatic_restock",
      dispositionPolicy: "mandatory_no_automatic_restock",
      allocatedHistoricAmount: { minor: 999, currency: "GHS" },
    }],
    ...overrides,
  };
}

async function setup(options: {
  readonly controlRole?: "owner" | "admin" | "support";
  readonly managerLocations?: readonly string[];
  readonly stored?: StoredReturnRecord;
} = {}) {
  const sessions = createEphemeralInMemoryStaffSessionStore();
  const sessionId = await sessions.create({
    actorId: "operator_a",
    displayName: "Staging Manager",
    organizationId: "org_a",
    locationIds: options.managerLocations ?? [],
    capabilities: [],
    expiresAt: "2026-10-03T08:00:00.000Z",
  } satisfies Session, "csrf", new Date("2026-10-03T08:00:00.000Z"));
  const returns = createInMemoryReturnStore();
  await returns.insertPreview(options.stored ?? savedReturn());
  return {
    correlationId: CORRELATION,
    cookieHeader: `cetech_pos_sid=${sessionId}`,
    now: NOW,
    sessions,
    assignments: createMemoryAssignmentDirectory([{
      actorId: "operator_a",
      organizationId: "org_a",
      locationRoles: (options.managerLocations ?? []).map((locationId) => ({ locationId, role: "manager" as const })),
      registerIds: [],
    }]),
    controlPlane: createMemoryControlPlaneDirectory(options.controlRole ? [{
      organizationId: "org_a", actorId: "operator_a", controlRole: options.controlRole, status: "active",
    }] : []),
    returns,
    returnId: RETURN_ID,
  };
}

describe("exact read-only management return detail", () => {
  test("manager reads persisted lines and settled/uncertain effects without changing records or appending audit", async () => {
    const stored = savedReturn({
      status: "requires_attention",
      executeClaimedAt: "2026-10-02T06:00:00.000Z",
      previewExpiresAt: "2026-10-02T05:00:00.000Z",
      cashRefund: {
        refundId: "55555555-5555-4555-8555-555555555555",
        returnId: RETURN_ID, organizationId: "org_a", locationId: "loc_a1",
        paymentId: "66666666-6666-4666-8666-666666666666",
        transactionId: savedReturn().transactionId,
        amount: { minor: 999, currency: "GHS" }, status: "verified", channel: "cash_ledger",
      },
      stockDisposition: {
        stockDispositionId: "77777777-7777-4777-8777-777777777777",
        returnId: RETURN_ID, organizationId: "org_a", locationId: "loc_a1",
        transactionId: savedReturn().transactionId, saleId: "sale_a", economicsVersion: "hv1",
        fingerprint: FINGERPRINT, status: "requires_attention", message: "Remote stock record needs review.",
      },
    });
    const input = await setup({ managerLocations: ["loc_a1"], stored });
    const save = vi.spyOn(input.returns, "saveReturn");
    const audit = vi.spyOn(input.returns, "appendAudit");
    const claim = vi.spyOn(input.returns, "claimExecution");
    const before = await input.returns.getReturn(RETURN_ID);
    const result = await handleGetManagementReturnDetail(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected read");
    expect(result.data.returnId).toBe(RETURN_ID);
    expect(result.data.lines[0]).toMatchObject({ quantity: "1", condition: "damaged", allocatedAmount: { minor: 999, currency: "GHS" } });
    expect(result.data.effects.map((effect) => effect.status)).toEqual(["verified", "requires_attention"]);
    expect(result.data.effects[1]?.message).toBe("Remote stock record needs review.");
    expect(result.data.previewState).toBeUndefined(); // old expiry does not hide executed recovery
    expect(result.data.canApprove).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    expect(claim).not.toHaveBeenCalled();
    expect(await input.returns.getReturn(RETURN_ID)).toEqual(before);
    expect(await input.returns.listAudit(RETURN_ID)).toEqual([]);
    expect(JSON.stringify(result.data)).not.toContain(FINGERPRINT);
  });

  test("owner reads organization records but needs a location manager assignment to approve", async () => {
    const ownerOnly = await handleGetManagementReturnDetail(await setup({ controlRole: "owner" }));
    const both = await handleGetManagementReturnDetail(await setup({ controlRole: "owner", managerLocations: ["loc_a1"] }));
    expect(ownerOnly.ok).toBe(true);
    expect(both.ok).toBe(true);
    if (!ownerOnly.ok || !both.ok) throw new Error("expected details");
    expect(ownerOnly.data.canApprove).toBe(false);
    expect(ownerOnly.data.actionUnavailableReason).toContain("Manager assignment");
    expect(both.data.canApprove).toBe(true);
  });

  test("expired and unprovable previews cannot be approved even by an owner plus manager", async () => {
    for (const previewExpiresAt of [NOW.toISOString(), "2026-10-02T07:00:00.000Z", "invalid"]) {
      const result = await handleGetManagementReturnDetail(await setup({
        controlRole: "owner", managerLocations: ["loc_a1"], stored: savedReturn({ previewExpiresAt }),
      }));
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected details");
      expect(result.data.canApprove).toBe(false);
      expect(result.data.previewState).toBe(previewExpiresAt === "invalid" ? "unavailable" : "expired");
    }
  });

  test("recorded approval is read and never rebound", async () => {
    const input = await setup({ managerLocations: ["loc_a1"] });
    await input.returns.bindApproval({
      approvalId: "88888888-8888-4888-8888-888888888888", returnId: RETURN_ID,
      fingerprint: FINGERPRINT, organizationId: "org_a", locationId: "loc_a1",
      actorId: "operator_a",
      expiresAt: "2026-10-03T07:10:00.000Z",
    });
    const bind = vi.spyOn(input.returns, "bindApproval");
    const result = await handleGetManagementReturnDetail(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected approval state");
    expect(result.data.approvalState).toBe("recorded");
    expect(result.data.canApprove).toBe(false);
    expect(bind).not.toHaveBeenCalled();
  });

  test("manager cannot open another location and no subordinate sale/approval reads occur", async () => {
    const input = await setup({ managerLocations: ["loc_a2"] });
    const approvals = vi.spyOn(input.returns, "getApprovalForReturn");
    const getSale = vi.fn();
    const result = await handleGetManagementReturnDetail({ ...input, sales: { getSale } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected scope denial");
    expect(result.error.code).toBe("FORBIDDEN");
    expect(approvals).not.toHaveBeenCalled();
    expect(getSale).not.toHaveBeenCalled();
  });

  test("another organization's exact ID is not found even for owner", async () => {
    const input = await setup({ controlRole: "owner", stored: savedReturn({ organizationId: "org_b" }) });
    const result = await handleGetManagementReturnDetail(input);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected tenant denial");
    expect(result.error.code).toBe("NOT_FOUND");
    expect(JSON.stringify(result)).not.toContain("Damaged packaging");
  });

  test("mismatched child effect identities are not exposed through an authorized parent", async () => {
    const input = await setup({ controlRole: "owner", stored: savedReturn({
      stockDisposition: {
        stockDispositionId: "77777777-7777-4777-8777-777777777777",
        returnId: RETURN_ID, organizationId: "org_b", locationId: "loc_b1",
        transactionId: savedReturn().transactionId, saleId: "sale_a", economicsVersion: "hv1",
        fingerprint: FINGERPRINT, status: "requires_attention", message: "Other tenant detail",
      },
    }) });
    const result = await handleGetManagementReturnDetail(input);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected parent detail");
    expect(result.data.effects).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Other tenant detail");
  });

  test("support, missing session and invalid ID fail closed", async () => {
    const input = await setup({ controlRole: "owner" });
    const read = vi.spyOn(input.returns, "getReturn");
    const cases = [
      { ...input, returnId: "sale_a" },
      { ...input, cookieHeader: undefined },
      { ...input, controlPlane: createMemoryControlPlaneDirectory([{ actorId: "operator_a", organizationId: "org_a", controlRole: "support", status: "active" }]) },
    ];
    for (const value of cases) expect((await handleGetManagementReturnDetail(value)).ok).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  test("names come from the matching immutable sale, never a differently scoped sale", async () => {
    const input = await setup({ managerLocations: ["loc_a1"] });
    const sale: PosSaleRecord = {
      organizationId: "org_a", locationId: "loc_a1", registerId: "reg_a",
      locationName: "Location A1", registerName: "Register A",
      deviceId: "99999999-9999-4999-8999-999999999999", shiftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      cashierId: "cashier_a", cashierName: "Cashier A", customer: { kind: "walkin" }, customerLabel: "Walk-in",
      prepared: {
        transactionId: savedReturn().transactionId, saleId: "sale_a", orderReference: "Order 123",
        quoteFingerprint: FINGERPRINT, total: { minor: 999, currency: "GHS" },
        status: "prepared", stockCommitment: "reserved",
        preparedAt: "2026-10-02T06:00:00.000Z", expiresAt: "2026-10-02T06:15:00.000Z",
      },
      lines: [{ name: "Saved product name", quantity: "1", unitPrice: { minor: 999, currency: "GHS" }, subtotal: { minor: 999, currency: "GHS" }, discount: { minor: 0, currency: "GHS" }, tax: { minor: 0, currency: "GHS" }, total: { minor: 999, currency: "GHS" } }],
      orderLines: [{ orderLineId: "line_a", quantity: "1", subtotal: { minor: 999, currency: "GHS" }, discount: { minor: 0, currency: "GHS" }, tax: { minor: 0, currency: "GHS" }, total: { minor: 999, currency: "GHS" } }],
      subtotal: { minor: 999, currency: "GHS" }, discount: { minor: 0, currency: "GHS" }, tax: { minor: 0, currency: "GHS" },
      status: "completed", commercialConfirmed: true,
    };
    const match = await handleGetManagementReturnDetail({ ...input, sales: { getSale: async () => sale } });
    const mismatch = await handleGetManagementReturnDetail({ ...input, sales: { getSale: async () => ({ ...sale, organizationId: "org_b" }) } });
    expect(match.ok && match.data.lines[0]?.name).toBe("Saved product name");
    expect(mismatch.ok && mismatch.data.namesAvailable).toBe(false);
  });

  test("unavailable durable read returns a typed integration error", async () => {
    const input = await setup({ controlRole: "owner" });
    const result = await handleGetManagementReturnDetail({
      ...input,
      returns: { getReturn: async () => { throw new Error("read failed"); }, getApprovalForReturn: input.returns.getApprovalForReturn },
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected unavailable");
    expect(result.error.code).toBe("INTEGRATION_UNAVAILABLE");
  });
});
