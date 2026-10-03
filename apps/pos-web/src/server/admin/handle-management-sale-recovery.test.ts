import { describe, expect, test, vi } from "vitest";
import type { PreparedSale, Quote, SaleResolution, Session } from "../../../../../docs/contracts/domain.generated";
import type { ApiResult, SalesPort } from "../../../../../docs/contracts/ports";
import type { CheckoutStore } from "../../core/checkout/types";
import { createInMemoryCheckoutStore } from "../../core/checkout/in-memory-store";
import { createMemoryCatalogPresentationLookup } from "../../core/receipt/catalog-presentation";
import { buildPrepareIntentSnapshot } from "../../core/receipt/prepare-intent";
import { canonicalJson, sha256Hex } from "../../local/canonical";
import { createMemoryAssignmentDirectory } from "../auth/assignments";
import { createEphemeralInMemoryStaffSessionStore } from "../auth/session-store";
import { prepareSale } from "../sales/prepare-sale";
import { createMemoryAdminAuditStore } from "./admin-audit-store";
import { createMemoryControlPlaneDirectory } from "./control-plane-directory";
import { handleGetManagementSaleRecovery, handleRepairManagementSale } from "./handle-management-sale-recovery";
import type { OriginalManagementPrepare } from "./management-sale-recovery-store";

const TX = "11111111-1111-4111-8111-111111111111";
const KEY = "22222222-2222-4222-8222-222222222222";
const CORR = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT = "33333333-3333-4333-8333-333333333333";
const DEVICE = "44444444-4444-4444-8444-444444444444";
const PAYMENT = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-10-03T08:00:00Z");
const ORIGIN = "https://pos.example.test";
const FINGERPRINT = "0123456789abcdef0123456789abcdef";
const ghs = (minor: number) => ({ minor, currency: "GHS" });
const request = { transactionId: TX, registerId: "reg_a", shiftId: SHIFT, deviceId: DEVICE, quoteId: "q-original", quoteFingerprint: FINGERPRINT };

function quote(): Quote {
  return {
    id: request.quoteId, fingerprint: FINGERPRINT, cartId: TX, cartRevision: 1, customer: { kind: "walkin" },
    locationId: "loc_a1", currency: "GHS", calculatedAt: "2026-10-03T02:00:00Z", expiresAt: "2026-10-03T02:15:00Z", purchasable: true,
    lines: [{ lineId: TX, productId: "p-original", quantity: "1", unitPrice: ghs(500), subtotal: ghs(500), discount: ghs(0), tax: ghs(0), total: ghs(500), stockStatus: "in_stock", purchasable: true, problems: [] }],
    subtotal: ghs(500), discount: ghs(0), tax: ghs(0), total: ghs(500),
  };
}
function prepared(): PreparedSale {
  return { transactionId: TX, saleId: "sale-original", orderReference: "50104", quoteFingerprint: FINGERPRINT,
    total: ghs(500), status: "prepared", stockCommitment: "reserved", preparedAt: NOW.toISOString(), expiresAt: "2026-10-03T08:20:00Z" };
}
function remote(status: SaleResolution["status"] = "requires_attention", extra: Partial<SaleResolution> = {}): ApiResult<SaleResolution> {
  return { ok: true, correlationId: CORR, data: { transactionId: TX, status, saleId: "sale-original", orderReference: "50104",
    ...(status === "requires_attention" ? { message: "This existing order cannot yet be safely opened for payment." } : {}), ...extra } };
}

async function fixture() {
  const store = createInMemoryCheckoutStore();
  await store.seedRegister({ id: "reg_a", name: "Register A", organizationId: "org_a", locationId: "loc_a1", currency: "GHS", status: "active" });
  await store.seedDevice({ id: DEVICE, organizationId: "org_a", locationId: "loc_a1", status: "active" });
  await store.insertOpenShift({ id: SHIFT, registerId: "reg_a", deviceId: DEVICE, cashierId: "cashier_a", organizationId: "org_a", locationId: "loc_a1", status: "open", openingFloat: ghs(1000), openedAt: "2026-10-03T01:00:00Z" });
  const frozen = quote();
  await store.saveQuote(frozen);
  const hash = await sha256Hex(canonicalJson(request));
  await store.claimIdempotency("org_a", "sale.prepare", KEY, hash, "loc_a1", { registerId: "reg_a", shiftId: SHIFT, transactionId: TX });
  const intent = buildPrepareIntentSnapshot({ quote: frozen, transactionId: TX, lines: [{ name: "Original item", quantity: "1", unitPrice: ghs(500), subtotal: ghs(500), discount: ghs(0), tax: ghs(0), total: ghs(500) }] });
  await store.bindPrepareIntent("org_a", "sale.prepare", KEY, intent);
  await store.recordPrepareDiagnostic({ organizationId: "org_a", operation: "sale.prepare", idempotencyKey: KEY, status: "requires_attention", attemptedAt: "2026-10-03T02:00:00Z", countAttempt: true, errorCode: "REQUIRES_ATTENTION", outcome: { effectCertainty: "unknown", transactionId: TX, idempotencyKey: KEY, errorCode: "REQUIRES_ATTENTION", remoteStatus: "requires_attention" } });
  let row: OriginalManagementPrepare = { organizationId: "org_a", locationId: "loc_a1", registerId: "reg_a", shiftId: SHIFT, transactionId: TX, idempotencyKey: KEY, requestHash: hash, status: "requires_attention", intent, outcome: undefined };
  const originals = {
    async getOriginal(org: string, tx: string) {
      if (org !== row.organizationId || tx !== row.transactionId) return undefined;
      const current = await store.findSalePrepareOperation(TX);
      return { ...row, status: current?.status ?? row.status, outcome: current?.outcome };
    },
  };
  const sessions = createEphemeralInMemoryStaffSessionStore();
  const sid = await sessions.create({ actorId: "manager_a", displayName: "Manager A", organizationId: "org_a", locationIds: ["loc_a1"], capabilities: [], expiresAt: "2026-10-03T10:00:00Z" } satisfies Session, "csrf", new Date("2026-10-03T10:00:00Z"));
  let preparedRemote = false;
  const seen: { request: typeof request; key: string }[] = [];
  const salesPort: Pick<SalesPort, "prepare" | "resolve"> = {
    async resolve() { return remote(preparedRemote ? "prepared" : "requires_attention"); },
    async prepare(body, context) { seen.push({ request: body, key: context.idempotencyKey }); preparedRemote = true; return { ok: true, data: prepared(), correlationId: context.correlationId }; },
  };
  const input = {
    transactionId: TX, correlationId: CORR, now: NOW, cookieHeader: `cetech_pos_sid=${sid}`, sessions,
    assignments: createMemoryAssignmentDirectory([{ actorId: "manager_a", organizationId: "org_a", locationRoles: [{ locationId: "loc_a1", role: "manager" }], registerIds: [] }]),
    controlPlane: createMemoryControlPlaneDirectory([]), originals, checkoutStore: store, salesPort,
    catalogLookup: createMemoryCatalogPresentationLookup({ org_a: [] }), audit: createMemoryAdminAuditStore(),
    protection: { origin: ORIGIN, referer: null, csrfCookie: "csrf", csrfHeader: "csrf", allowedOrigins: [ORIGIN] },
  };
  return { input, store, seen, setRow(value: Partial<OriginalManagementPrepare>) { row = { ...row, ...value }; } };
}

describe("manager server-owned original sale repair", () => {
  test("GET proves an expired original quote without repairing, acknowledging or changing diagnostics", async () => {
    const f = await fixture();
    const before = await f.store.findSalePrepareOperation(TX);
    const result = await handleGetManagementSaleRecovery(f.input);
    expect(result.ok && result.data.status).toBe("eligible");
    expect(f.seen).toEqual([]);
    expect(await f.store.getSale(TX)).toBeUndefined();
    expect(await f.store.findSalePrepareOperation(TX)).toEqual(before);
    expect(f.input.audit.events).toEqual([]);
  });

  test("manager repairs the original key/request without browser attempt or register assignment, then safe replay has no new bridge prepare", async () => {
    const f = await fixture();
    const first = await handleRepairManagementSale(f.input);
    expect(first.ok && first.data).toEqual(prepared());
    expect(f.seen).toEqual([{ request, key: KEY }]);
    const saved = await f.store.getSale(TX);
    expect(saved?.cashierId).toBe("manager_a");
    expect(saved?.cashierName).toBe("Manager A");
    expect(await f.store.getPaymentForTransaction(TX)).toBeUndefined();
    expect(await f.store.listCashSales(TX)).toEqual([]);
    expect(await f.store.getReceipt(TX)).toBeUndefined();
    expect(f.input.audit.events.map((event) => event.action)).toEqual(["sale.recovery.requested", "sale.recovery.result"]);
    const check = await handleGetManagementSaleRecovery(f.input);
    expect(check.ok && check.data.status).toBe("ready");
    expect((await handleRepairManagementSale(f.input)).ok).toBe(true);
    expect(f.seen).toHaveLength(1);
    expect(await f.store.getSale(TX)).toEqual(saved);
  });

  test.each(["cashier", "other-location", "owner-only"])("rejects %s authority before remote access", async (scenario) => {
    const f = await fixture();
    const resolve = vi.fn(f.input.salesPort.resolve);
    const result = await handleRepairManagementSale({ ...f.input,
      salesPort: { ...f.input.salesPort, resolve },
      assignments: createMemoryAssignmentDirectory([{ actorId: "manager_a", organizationId: "org_a", locationRoles: [{ locationId: scenario === "other-location" ? "loc_a2" : "loc_a1", role: scenario === "other-location" ? "manager" : "cashier" }], registerIds: ["reg_a"] }]),
      controlPlane: createMemoryControlPlaneDirectory(scenario === "owner-only" ? [{ actorId: "manager_a", organizationId: "org_a", controlRole: "owner", status: "active" }] : []),
    });
    expect(result.ok).toBe(false);
    expect(resolve).not.toHaveBeenCalled();
    expect(f.seen).toEqual([]);
  });

  test("foreign organization original is withheld", async () => {
    const f = await fixture(); f.setRow({ organizationId: "org_b" });
    const result = await handleGetManagementSaleRecovery(f.input);
    expect(!result.ok && result.error.code).toBe("NOT_FOUND");
  });

  test.each(["csrf", "origin"])("rejects invalid %s before effect", async (kind) => {
    const f = await fixture();
    const result = await handleRepairManagementSale({ ...f.input, protection: { ...f.input.protection, ...(kind === "csrf" ? { csrfHeader: "wrong" } : { origin: "https://other.test" }) } });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN");
    expect(f.seen).toEqual([]);
    expect(f.input.audit.events).toEqual([]);
  });

  test("missing optional customer presentation fails original hash proof without current customer lookup", async () => {
    const f = await fixture();
    f.setRow({ requestHash: await sha256Hex(canonicalJson({ ...request, customerSnapshot: { id: "customer-original", kind: "retail", displayName: "Frozen customer" } })) });
    const result = await handleGetManagementSaleRecovery(f.input);
    expect(result.ok && result.data.status).toBe("blocked");
    expect(result.ok && result.data.message).toContain("exact original");
    expect(f.seen).toEqual([]);
  });

  test.each(["device", "shift", "register", "lines", "fingerprint"])("blocks changed original %s", async (kind) => {
    const f = await fixture();
    if (kind === "device") await f.store.seedDevice({ id: DEVICE, organizationId: "org_b", locationId: "loc_a1", status: "active" });
    if (kind === "shift") await f.store.closeShift({ shiftId: SHIFT, countedCash: ghs(1000), status: "closed" });
    if (kind === "register") await f.store.seedRegister({ id: "reg_a", name: "Register", organizationId: "org_a", locationId: "loc_a2", currency: "GHS", status: "active" });
    if (kind === "lines") await f.store.saveQuote({ ...quote(), lines: quote().lines.map((line) => ({ ...line, quantity: "2" })) });
    if (kind === "fingerprint") f.setRow({ intent: { ...((await f.input.originals.getOriginal("org_a", TX))!.intent), quoteFingerprint: "different" } });
    const result = await handleRepairManagementSale(f.input);
    expect(result.ok).toBe(false); expect(f.seen).toEqual([]);
  });

  test.each(["payment", "cash-command", "electronic-command", "cancel", "finalize"])("blocks existing %s evidence", async (kind) => {
    const f = await fixture();
    if (kind === "payment") await f.store.savePayment({ transactionId: TX, paymentId: PAYMENT, saleId: "sale-original", tender: "cash", status: "failed", amount: ghs(500), actorId: "cashier_a" });
    else await f.store.claimIdempotency("org_a", kind === "cancel" ? "sale.cancel" : kind === "finalize" ? "sale.finalize" : kind === "cash-command" ? "payment.cash" : "payment.initialize", PAYMENT, "f".repeat(64), "loc_a1", { transactionId: TX });
    expect((await handleRepairManagementSale(f.input)).ok).toBe(false); expect(f.seen).toEqual([]);
  });

  test.each(["not_found", "completed", "payment_pending", "wrong-sale", "unknown-attention"])("does not repair remote %s", async (kind) => {
    const f = await fixture();
    const result = await handleRepairManagementSale({ ...f.input, salesPort: { ...f.input.salesPort,
      async resolve() { return kind === "wrong-sale" ? remote("requires_attention", { transactionId: PAYMENT })
        : kind === "unknown-attention" ? remote("requires_attention", { message: "Unknown remote effect" })
          : remote(kind as SaleResolution["status"]); },
    } });
    expect(result.ok).toBe(false); expect(f.seen).toEqual([]);
  });

  test("connection failure gives a concrete blocked capability", async () => {
    const f = await fixture();
    const result = await handleGetManagementSaleRecovery({ ...f.input, salesPort: { ...f.input.salesPort, async resolve() { throw new Error("offline"); } } });
    expect(result.ok && result.data.status).toBe("blocked");
    expect(result.ok && result.data.message).toContain("connection");
  });

  test("payment appearing during remote check blocks repair", async () => {
    const f = await fixture();
    const result = await handleRepairManagementSale({ ...f.input, salesPort: { ...f.input.salesPort, async resolve() {
      await f.store.savePayment({ transactionId: TX, paymentId: PAYMENT, saleId: "sale-original", tender: "cash", status: "pending", amount: ghs(500), actorId: "cashier_a" });
      return remote();
    } } });
    expect(result.ok).toBe(false); expect(f.seen).toEqual([]);
  });

  test("audit request failure stops repair before commercial dispatch", async () => {
    const f = await fixture();
    const result = await handleRepairManagementSale({ ...f.input, audit: { async append() { return "unavailable" as const; } } });
    expect(!result.ok && result.error.code).toBe("INTEGRATION_UNAVAILABLE"); expect(f.seen).toEqual([]);
  });

  test("lost bridge response is checked and repaired with the same key; the bridge keeps one order", async () => {
    const f = await fixture(); let bridgeReady = false; let calls = 0; let orderEffects = 0;
    const salesPort: Pick<SalesPort, "prepare" | "resolve"> = {
      async resolve() { return remote(bridgeReady ? "prepared" : "requires_attention"); },
      async prepare(body, command) {
        expect(body).toEqual(request); expect(command.idempotencyKey).toBe(KEY);
        if (!bridgeReady) { bridgeReady = true; orderEffects += 1; }
        if (++calls === 1) throw new Error("response lost after existing-order repair");
        return { ok: true, data: prepared(), correlationId: CORR };
      },
    };
    const first = await handleRepairManagementSale({ ...f.input, salesPort });
    expect(first.ok).toBe(false); expect(await f.store.getSale(TX)).toBeUndefined();
    const second = await handleRepairManagementSale({ ...f.input, salesPort });
    expect(second.ok).toBe(true); expect(orderEffects).toBe(1); expect(calls).toBe(2);
    expect(await f.store.getPaymentForTransaction(TX)).toBeUndefined();
  });

  test("concurrent managers on a store without local locking retain the original bridge identity and one saved sale", async () => {
    const f = await fixture(); const keys = new Set<string>(); let calls = 0;
    const checkoutStore: CheckoutStore = { ...f.store, async withLock(_key, fn) { return fn(); } };
    const salesPort: Pick<SalesPort, "prepare" | "resolve"> = {
      async resolve() { return remote(keys.size ? "prepared" : "requires_attention"); },
      async prepare(body, command) { calls++; expect(body).toEqual(request); keys.add(command.idempotencyKey); return { ok: true, data: prepared(), correlationId: CORR }; },
    };
    const results = await Promise.all([handleRepairManagementSale({ ...f.input, checkoutStore, salesPort }), handleRepairManagementSale({ ...f.input, checkoutStore, salesPort })]);
    expect(results.some((result) => result.ok)).toBe(true);
    expect(keys).toEqual(new Set([KEY])); expect(calls).toBeGreaterThan(0);
    expect((await f.store.getSale(TX))?.prepared).toEqual(prepared());
    expect(await f.store.getPaymentForTransaction(TX)).toBeUndefined();
  });

  test("prepared reservation expires during read-only remote check and is not offered as ready", async () => {
    const f = await fixture(); expect((await handleRepairManagementSale(f.input)).ok).toBe(true);
    const started = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(started);
    try {
      const result = await handleGetManagementSaleRecovery({ ...f.input, salesPort: { ...f.input.salesPort, async resolve() {
        clock.mockReturnValue(started + 21 * 60_000); return remote("prepared");
      } } });
      expect(result.ok && result.data.status).toBe("blocked");
    } finally { clock.mockRestore(); }
  });

  test("original metadata changing after remote check blocks audit and dispatch", async () => {
    const f = await fixture();
    const result = await handleRepairManagementSale({ ...f.input, salesPort: { ...f.input.salesPort, async resolve() {
      f.setRow({ requestHash: "f".repeat(64) }); return remote();
    } } });
    expect(result.ok).toBe(false); expect(f.seen).toEqual([]); expect(f.input.audit.events).toEqual([]);
  });

  test.each(["paymentId", "receiptId"])("stored diagnostic %s evidence blocks even if remote omits it", async (field) => {
    const f = await fixture();
    await f.store.markIdempotencyRequiresAttention("org_a", "sale.prepare", KEY, { effectCertainty: "unknown", [field]: PAYMENT });
    const result = await handleRepairManagementSale(f.input);
    expect(result.ok).toBe(false); expect(f.seen).toEqual([]);
  });

  test("missing/failed original evidence is not turned into a new sale", async () => {
    const f = await fixture();
    for (const value of [undefined, "unavailable" as const]) {
      const result = await handleRepairManagementSale({ ...f.input, originals: { async getOriginal() { return value; } } });
      expect(result.ok).toBe(false);
    }
    expect(f.seen).toEqual([]);
  });

  test("unrecorded result leaves saved sale and demands same-sale check", async () => {
    const f = await fixture(); let calls = 0;
    const result = await handleRepairManagementSale({ ...f.input, audit: { async append() { return ++calls === 1 ? "ok" as const : "unavailable" as const; } } });
    expect(!result.ok && result.error.code).toBe("REQUIRES_ATTENTION");
    expect(await f.store.getSale(TX)).toBeDefined(); expect(f.seen).toHaveLength(1);
  });

  test("authority revoked during capability check prevents audit or repair", async () => {
    const f = await fixture(); let reads = 0;
    const original = f.input.assignments;
    const result = await handleRepairManagementSale({ ...f.input, assignments: { async lookup(input) {
      if (++reads > 1) return { locationIds: [], registerIds: [], locationRoles: [] };
      return original.lookup(input);
    } } });
    expect(result.ok).toBe(false); expect(f.seen).toEqual([]); expect(f.input.audit.events).toEqual([]);
  });

  test("manager authority revoked while requested audit waits is rechecked before repair and recorded", async () => {
    const f = await fixture(); let revoked = false;
    const directory = f.input.assignments;
    const result = await handleRepairManagementSale({ ...f.input,
      assignments: { async lookup(input) { return revoked ? { locationIds: [], registerIds: [], locationRoles: [] } : directory.lookup(input); } },
      audit: { async append(event) { const saved = await f.input.audit.append(event); if (event.action === "sale.recovery.requested") revoked = true; return saved; } },
    });
    expect(!result.ok && result.error.code).toBe("FORBIDDEN"); expect(f.seen).toEqual([]);
    expect(f.input.audit.events.map((event) => event.action)).toEqual(["sale.recovery.requested", "sale.recovery.result"]);
    expect(f.input.audit.events[1]?.afterState).toEqual({ status: "requires_attention", errorCode: "FORBIDDEN" });
  });

  test("repair-only flag rejects absent and acquired original before normal new prepare flow", async () => {
    const f = await fixture();
    const store: CheckoutStore = { ...f.store, async findSalePrepareOperation() { return undefined; } };
    const result = await prepareSale({ store, salesPort: f.input.salesPort, catalogLookup: f.input.catalogLookup,
      actor: { actorId: "manager_a", displayName: "Manager", organizationId: "org_a", locationIds: ["loc_a1"] },
      request, context: { idempotencyKey: KEY, correlationId: CORR }, now: NOW, requireOriginalRepair: true });
    expect(result.ok).toBe(false); expect(f.seen).toEqual([]);
    const acquired: CheckoutStore = { ...f.store, async claimIdempotency() { return { kind: "acquired" }; } };
    const second = await prepareSale({ store: acquired, salesPort: f.input.salesPort, catalogLookup: f.input.catalogLookup,
      actor: { actorId: "manager_a", displayName: "Manager", organizationId: "org_a", locationIds: ["loc_a1"] },
      request, context: { idempotencyKey: KEY, correlationId: CORR }, now: NOW, requireOriginalRepair: true });
    expect(second.ok).toBe(false); expect(f.seen).toEqual([]);
  });
});
