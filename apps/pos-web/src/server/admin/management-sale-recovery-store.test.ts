import { describe, expect, test } from "vitest";
import { createSupabaseManagementSaleRecoveryStore } from "./management-sale-recovery-store";
import type { PosRestFetch } from "../http/server-fetch";

const TX = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const row = {
  organization_id: "org_a", location_id: "loc_a1", register_id: "reg_a", shift_id: "33333333-3333-4333-8333-333333333333",
  transaction_id: TX, idempotency_key: KEY, request_hash: "a".repeat(64), payload_version: "1.0.0", status: "requires_attention",
  intent_snapshot: { kind: "sale.prepare.presentation", transactionId: TX, quoteId: "q-original", quoteFingerprint: "0123456789abcdef0123456789abcdef", lineIds: [TX],
    lines: [{ name: "Frozen item", quantity: "1", unitPrice: { minor: 500, currency: "GHS" }, subtotal: { minor: 500, currency: "GHS" }, discount: { minor: 0, currency: "GHS" }, tax: { minor: 0, currency: "GHS" }, total: { minor: 500, currency: "GHS" } }] },
  outcome: { effectCertainty: "unknown" },
};

function store(body: unknown, onFetch?: (url: string, init: Parameters<PosRestFetch>[1]) => void) {
  return createSupabaseManagementSaleRecoveryStore({ url: "https://db.example.test", serviceRoleKey: "server-only-test-key", async fetchImpl(url, init) {
    onFetch?.(url, init); return { ok: true, status: 200, async json() { return body; } };
  } });
}

describe("read-only manager original-sale evidence store", () => {
  test("tenant-scoped single GET selects only original proof fields with bounded deadline", async () => {
    const evidence = await store([row], (url, init) => {
      expect(url).toContain("organization_id=eq.org_a&transaction_id=eq.");
      expect(url).toContain("operation=eq.sale.prepare"); expect(url).toContain("&limit=2");
      expect(url).not.toContain("select=*"); expect(init.method).toBe("GET"); expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }).getOriginal("org_a", TX);
    expect(evidence && evidence !== "unavailable" && evidence.requestHash).toBe(row.request_hash);
    expect(evidence && evidence !== "unavailable" && evidence.idempotencyKey).toBe(KEY);
  });
  test.each([
    [{ ...row, organization_id: "org_b" }], [{ ...row, transaction_id: KEY }],
    [{ ...row, request_hash: "invalid" }], [{ ...row, intent_snapshot: null }],
    [{ ...row, payload_version: "2.0.0" }], [{ ...row, idempotency_key: "new-key" }],
    [row, row], null,
  ])("fails closed on invalid or ambiguous evidence %j", async (body) => {
    expect(await store(body).getOriginal("org_a", TX)).toBe("unavailable");
  });
  test("missing row remains missing", async () => {
    expect(await store([]).getOriginal("org_a", TX)).toBeUndefined();
  });
  test("network and HTTP failures remain unavailable", async () => {
    for (const mode of ["network", "http"]) {
      const evidence = createSupabaseManagementSaleRecoveryStore({ url: "https://db.example.test", serviceRoleKey: "server-only-test-key", async fetchImpl() {
        if (mode === "network") throw new Error("offline");
        return { ok: false, status: 500, async json() { return []; } };
      } });
      expect(await evidence.getOriginal("org_a", TX)).toBe("unavailable");
    }
  });
});
