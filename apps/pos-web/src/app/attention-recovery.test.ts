import "fake-indexeddb/auto";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ApiResult, PaymentPort, SalesPort } from "../../../../docs/contracts/ports";
import type { PaymentState, SaleResolution } from "../../../../docs/contracts/domain.generated";
import type { AttentionItemView } from "../ui/operational";
import {
  checkoutBlockedByLocalRecovery,
  attentionRecoveryFeedback,
  boundedRecoveryFetch,
  createAttentionAuthRefreshGate,
  createAttentionRecoveryLock,
  createRecoveryScanGate,
  hasBlockingLocalTransactionRecovery,
  loadLocalJournalAttentionItems,
  localRecoverySellBanner,
  type LocalRecoveryContext,
  mergeAttentionItems,
  recoverAttentionItem,
  recoveryRequiresSignIn,
  runAttentionRecovery,
} from "./attention-recovery";
import {
  assessUpdateActivation,
  closePosLocalDatabase,
  createOperationJournal,
  createTenderActivityPort,
  deletePosLocalDatabase,
  hasActiveTender,
  listUnresolvedJournalRecords,
  openPosLocalDatabase,
} from "../local";
import { createStaffRuntimeController } from "../core/identity/staff-runtime";
import type { RegisterPort } from "../../../../docs/contracts/ports";
import { createBrowserCashCheckoutPorts } from "./checkout-client";
import { attentionFromOperation } from "../server/attention/attention-view";
import { UNKNOWN_ORGANIZATION_RECOVERY_COPY } from "../local/journal-recovery-scope";

const TX = "11111111-1111-4111-8111-111111111077";
const PAYMENT = "22222222-2222-4222-8222-222222222077";
const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOCAL_CHECKOUT_SCOPE = {
  registerId: "reg-test",
  shiftId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  deviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
} as const;

const DBS: string[] = [];

afterEach(async () => {
  await Promise.all(DBS.splice(0).map((name) => deletePosLocalDatabase(name)));
});

function uniqueDbName(): string {
  const name = `cetech-pos-r9-reload-${crypto.randomUUID()}`;
  DBS.push(name);
  return name;
}

function paymentOk(status: PaymentState["status"] = "pending"): ApiResult<PaymentState> {
  return {
    ok: true,
    correlationId: CORRELATION,
    data: {
      transactionId: TX,
      paymentId: PAYMENT,
      tender: "mobile_money",
      status,
      amount: { minor: 1000, currency: "GHS" },
      nextAction: status === "verified" ? "none" : "resolve",
      ...(status === "verified" ? { verifiedAt: "2026-09-19T12:00:00.000Z" as const } : {}),
    } as PaymentState,
  };
}

function saleOk(status: SaleResolution["status"] = "requires_attention"): ApiResult<SaleResolution> {
  return {
    ok: true,
    correlationId: CORRELATION,
    data: { transactionId: TX, status },
  };
}

const paymentItem: AttentionItemView = {
  id: `payment:${PAYMENT}`,
  title: "Payment awaiting verification",
  summary: "This payment is still being checked.",
  typeLabel: "payment",
  severity: "medium",
  transactionReference: "TX-PENDING-1",
  transactionId: TX,
  paymentId: PAYMENT,
  resolveAllowed: true,
  recoverKind: "payment",
};

const saleItem: AttentionItemView = {
  id: `sale:${TX}`,
  title: "Sale needs review",
  summary: "Resolve the existing transaction.",
  typeLabel: "sale",
  severity: "critical",
  transactionReference: "#attn",
  transactionId: TX,
  resolveAllowed: true,
  recoverKind: "sale",
};

const refundItem: AttentionItemView = {
  id: `operation:payment.refund:${TX}`,
  title: "Operation needs recovery",
  summary: "This operation needs manager or reconciliation review.",
  typeLabel: "operation",
  severity: "critical",
  transactionReference: TX,
  transactionId: TX,
  resolveAllowed: false,
  recoverKind: "return",
};

describe("server operation attention identity", () => {
  test("uncertain shift open remains visible without a transaction id", () => {
    const item = attentionFromOperation({
      organizationId: "org_a",
      locationId: "loc_a1",
      registerId: "reg_a",
      operation: "shift.open",
    });
    expect(item).toMatchObject({
      id: "operation:shift.open:reg_a",
      title: "Register opening needs review",
      transactionReference: "reg_a",
      recoverKind: "shift",
      resolveAllowed: false,
    });
    expect(item.transactionId).toBeUndefined();
    expect(item.summary).toContain("Do not open another shift");
  });
});

describe("automatic attention auth refresh", () => {
  const context: LocalRecoveryContext = {
    organizationId: "org_a", actorId: "cashier_a", registerId: "reg_a", deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
  };
  const auth: ApiResult<unknown> = { ok: false, correlationId: CORRELATION, error: {
    code: "AUTH_REQUIRED", nextAction: "reauthenticate", retryable: false, message: "session required",
  } };

  test("persistent unauthorized inbox reads stop after one refresh even when refresh publishes a new valid session", async () => {
    const gate = createAttentionAuthRefreshGate();
    let session = { organizationId: context.organizationId, actorId: context.actorId };
    const inbox = vi.fn(async () => auth);
    const refresh = vi.fn(async () => {
      session = { ...session };
    });
    async function loadAttention(): Promise<void> {
      const result = await inbox();
      const scanned = { ...context, ...session };
      if (gate.shouldRefresh(scanned, result)) {
        await refresh();
        // The new ready session object triggers the app's next inbox effect.
        await loadAttention();
      }
    }
    const initialSession = session;
    await loadAttention();
    expect(session).not.toBe(initialSession);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(inbox).toHaveBeenCalledTimes(2);
    await loadAttention();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(inbox).toHaveBeenCalledTimes(3);

    gate.shouldRefresh({ ...context, ...session }, { ok: true, correlationId: CORRELATION, data: { items: [] } });
    await loadAttention();
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(inbox).toHaveBeenCalledTimes(5);
  });

  test("real recovery context changes and sign-in boundaries permit a new bounded refresh", () => {
    const gate = createAttentionAuthRefreshGate();
    for (const next of [
      context,
      { ...context, actorId: "cashier_b" },
      { ...context, organizationId: "org_b" },
      { ...context, registerId: "reg_b" },
      { ...context, deviceId: "another-device" },
    ]) {
      expect(gate.shouldRefresh(next, auth)).toBe(true);
      expect(gate.shouldRefresh({ ...next }, auth)).toBe(false);
    }
    gate.reset();
    expect(gate.shouldRefresh({ ...context, deviceId: "another-device" }, auth)).toBe(true);
    expect(gate.shouldRefresh({ ...context, deviceId: "another-device" }, auth)).toBe(false);
  });

  test("a spent automatic gate keeps explicit operator recovery sign-in available", async () => {
    const gate = createAttentionAuthRefreshGate();
    gate.shouldRefresh(context, auth);
    const refresh = vi.fn(async () => undefined);
    await runAttentionRecovery({
      item: saleItem, lock: createAttentionRecoveryLock(),
      ports: { payments: { resolve: vi.fn() }, sales: { resolve: async () => auth as ApiResult<SaleResolution> } },
      reload: async () => undefined,
      onOutcome: async (outcome) => { if (recoveryRequiresSignIn(outcome)) await refresh(); },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(gate.shouldRefresh(context, auth)).toBe(false);
  });
});

describe("UX-04 attention recovery identity", () => {
  test("expired sale recovery preserves its auth result and prompts sign-in instead of reporting a resolution", async () => {
    const auth: ApiResult<SaleResolution> = { ok: false, correlationId: CORRELATION, error: {
      code: "AUTH_REQUIRED", nextAction: "reauthenticate", retryable: false, message: "internal session token diagnostics",
    } };
    const outcome = await recoverAttentionItem(saleItem, { payments: { resolve: vi.fn() }, sales: { resolve: vi.fn(async () => auth) } });
    expect(outcome).toEqual({ status: "attempted", kind: "sale", result: auth });
    expect(recoveryRequiresSignIn(outcome)).toBe(true);
    expect(attentionRecoveryFeedback(outcome)).toContain("Your session ended. Sign in again.");
    expect(attentionRecoveryFeedback(outcome)).toContain("saved transaction was kept");
    expect(attentionRecoveryFeedback(outcome)).not.toContain("token diagnostics");
  });

  test("a failed local payment status lookup does not issue a dependent sale request", async () => {
    const salesResolve = vi.fn();
    const auth: ApiResult<PaymentState> = { ok: false, correlationId: CORRELATION, error: {
      code: "AUTH_REQUIRED", nextAction: "reauthenticate", retryable: false, message: "session required",
    } };
    const outcome = await recoverAttentionItem({ ...paymentItem, id: "local-journal:payment-row" }, {
      payments: { resolve: vi.fn(async () => auth) }, sales: { resolve: salesResolve },
    });
    expect(recoveryRequiresSignIn(outcome)).toBe(true);
    expect(salesResolve).not.toHaveBeenCalled();
  });

  test("nonterminal sale feedback remains explicit without displaying backend text", async () => {
    const outcome = await recoverAttentionItem(saleItem, { payments: { resolve: vi.fn() }, sales: { resolve: async () => ({
      ok: true, correlationId: CORRELATION, data: { transactionId: TX, status: "requires_attention", message: "WooCommerce provider internal diagnostics" },
    }) } });
    expect(attentionRecoveryFeedback(outcome)).toContain("still needs checking");
    expect(attentionRecoveryFeedback(outcome)).toContain("Do not take payment again");
    expect(attentionRecoveryFeedback(outcome)).not.toContain("WooCommerce");
  });

  test("an unexpected port failure reports a safe failed outcome and always releases the lock", async () => {
    const lock = createAttentionRecoveryLock();
    const onOutcome = vi.fn();
    const reload = vi.fn(async () => undefined);
    await runAttentionRecovery({ item: saleItem, lock, ports: { payments: { resolve: vi.fn() }, sales: { resolve: async () => { throw new Error("unexpected provider failure"); } } }, reload, onOutcome });
    expect(onOutcome).toHaveBeenCalledWith({ status: "failed" });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(lock.inFlightId()).toBeNull();
  });

  test("a recovery deadline aborts one request without retrying it", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    await expect(boundedRecoveryFetch(fetchImpl, 5)("/api/pos/v1/sales/original")).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  test("reload rediscovers an ambiguous prepare only from the durable journal and resolves before the gate opens", async () => {
    const name = uniqueDbName();
    const firstDb = openPosLocalDatabase(name);
    const firstJournal = createOperationJournal(firstDb, {
      createdByActorId: "cashier_a",
      organizationId: "org_a",
      registerId: LOCAL_CHECKOUT_SCOPE.registerId,
    });
    const firstTenderActivity = createTenderActivityPort(firstDb);

    const firstPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        throw new TypeError("simulated lost prepare response");
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal: firstJournal,
      tenderActivity: firstTenderActivity,
    });

    await firstPorts.checkout.prepare(
      {
        transactionId: TX,
        registerId: LOCAL_CHECKOUT_SCOPE.registerId,
        shiftId: LOCAL_CHECKOUT_SCOPE.shiftId,
        deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
        quoteId: "quote-reload",
        quoteFingerprint: "0123456789abcdef0123456789abcdef",
      },
      { idempotencyKey: "44444444-4444-4444-8444-444444444444", correlationId: CORRELATION },
    );

    expect((await firstJournal.pending())[0]?.status).toBe("response_unknown");
    expect(await hasActiveTender(firstDb)).toBe(true);

    await closePosLocalDatabase(name);

    // Simulate mounted runtime recreation: no old checkout controller or transaction state is retained.
    const reloadedDb = openPosLocalDatabase(name);
    const reloadedJournal = createOperationJournal(reloadedDb);
    const reloadedTenderActivity = createTenderActivityPort(reloadedDb);
    const sameOrgViewer = {
      actorId: "cashier_a",
      registerId: LOCAL_CHECKOUT_SCOPE.registerId,
      organizationId: "org_a",
    };
    const recoveredItems = await loadLocalJournalAttentionItems(reloadedJournal, sameOrgViewer, reloadedDb);

    expect(recoveredItems).toHaveLength(1);
    expect(recoveredItems[0]).toMatchObject({
      recoverKind: "sale",
      transactionId: TX,
      resolveAllowed: true,
    });
    expect(hasBlockingLocalTransactionRecovery(recoveredItems)).toBe(true);

    const requestedUrls: string[] = [];
    const recoveryPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async (input) => {
        requestedUrls.push(String(input));
        return new Response(
          JSON.stringify({
            ok: true,
            correlationId: CORRELATION,
            data: {
              transactionId: TX,
              status: "not_found",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal: reloadedJournal,
      tenderActivity: reloadedTenderActivity,
    });

    let afterRecoveryItems: readonly AttentionItemView[] = recoveredItems;
    const status = await runAttentionRecovery({
      item: recoveredItems[0]!,
      lock: createAttentionRecoveryLock(),
      ports: { payments: recoveryPorts.payments, sales: recoveryPorts.sales },
      reload: async () => {
        afterRecoveryItems = await loadLocalJournalAttentionItems(reloadedJournal, sameOrgViewer, reloadedDb);
      },
    });

    expect(status).toBe("attempted");
    expect(requestedUrls).toEqual([`/api/pos/v1/sales/${TX}`]);
    expect(await reloadedJournal.pending()).toHaveLength(0);
    expect(afterRecoveryItems).toHaveLength(0);
    expect(hasBlockingLocalTransactionRecovery(afterRecoveryItems)).toBe(false);
    const terminalTenderActive = await hasActiveTender(reloadedDb);
    expect(terminalTenderActive).toBe(false);
    const terminalUpdateDecision = assessUpdateActivation({
      activeTender: terminalTenderActive,
      criticalOperationCount: 0,
      syncMutationInProgress: false,
      localMigrationInProgress: false,
      activeWindow: true,
      appBuild: "recovery-test",
    });
    expect(terminalUpdateDecision.safe).toBe(true);
  });

  test("reload recovery acknowledges a safely prepared sale and keeps the tender lease", async () => {
    const name = uniqueDbName();
    const firstDb = openPosLocalDatabase(name);
    const firstJournal = createOperationJournal(firstDb, {
      createdByActorId: "cashier_a",
      organizationId: "org_a",
      registerId: LOCAL_CHECKOUT_SCOPE.registerId,
    });
    const firstTenderActivity = createTenderActivityPort(firstDb);

    const firstPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        throw new TypeError("simulated lost prepare response");
      },
      scope: LOCAL_CHECKOUT_SCOPE,
      journal: firstJournal,
      tenderActivity: firstTenderActivity,
    });

    await firstPorts.checkout.prepare(
      {
        transactionId: TX,
        registerId: LOCAL_CHECKOUT_SCOPE.registerId,
        shiftId: LOCAL_CHECKOUT_SCOPE.shiftId,
        deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
        quoteId: "quote-reload-nonterminal",
        quoteFingerprint: "0123456789abcdef0123456789abcdef",
      },
      { idempotencyKey: "55555555-5555-4555-8555-555555555555", correlationId: CORRELATION },
    );

    expect(await hasActiveTender(firstDb)).toBe(true);
    await closePosLocalDatabase(name);

    const reloadedDb = openPosLocalDatabase(name);
    const reloadedJournal = createOperationJournal(reloadedDb);
    const reloadedTenderActivity = createTenderActivityPort(reloadedDb);
    const sameOrgViewer = {
      actorId: "cashier_a",
      registerId: LOCAL_CHECKOUT_SCOPE.registerId,
      organizationId: "org_a",
    };
    const recoveredItems = await loadLocalJournalAttentionItems(reloadedJournal, sameOrgViewer, reloadedDb);
    expect(recoveredItems).toHaveLength(1);

    const recoveryPorts = createBrowserCashCheckoutPorts({
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            correlationId: CORRELATION,
            data: {
              transactionId: TX,
              status: "prepared",
              saleId: "sale-reloaded",
              orderReference: "ORDER-RELOADED",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      scope: LOCAL_CHECKOUT_SCOPE,
      journal: reloadedJournal,
      tenderActivity: reloadedTenderActivity,
    });

    let afterRecoveryItems: readonly AttentionItemView[] = recoveredItems;
    await runAttentionRecovery({
      item: recoveredItems[0]!,
      lock: createAttentionRecoveryLock(),
      ports: { payments: recoveryPorts.payments, sales: recoveryPorts.sales },
      reload: async () => {
        afterRecoveryItems = await loadLocalJournalAttentionItems(reloadedJournal, sameOrgViewer, reloadedDb);
      },
    });

    expect(await reloadedJournal.pending()).toHaveLength(0);
    expect((await reloadedDb.journal.get("55555555-5555-4555-8555-555555555555"))?.status).toBe("acknowledged");
    expect(hasBlockingLocalTransactionRecovery(afterRecoveryItems)).toBe(false);
    const nonterminalTenderActive = await hasActiveTender(reloadedDb);
    expect(nonterminalTenderActive).toBe(true);
    const nonterminalUpdateDecision = assessUpdateActivation({
      activeTender: nonterminalTenderActive,
      criticalOperationCount: 0,
      syncMutationInProgress: false,
      localMigrationInProgress: false,
      activeWindow: true,
      appBuild: "recovery-test",
    });
    expect(nonterminalUpdateDecision.safe).toBe(false);
    if (nonterminalUpdateDecision.safe) {
      throw new Error("nonterminal tender recovery unexpectedly became update-safe");
    }
    expect(nonterminalUpdateDecision.reasons).toContain("ACTIVE_TENDER");
  });

  test("local payment recovery checks payment then sale using the persisted transaction identity", async () => {
    const localPayment: AttentionItemView = {
      id: "local-journal:payment-op",
      title: paymentItem.title,
      summary: paymentItem.summary,
      typeLabel: paymentItem.typeLabel,
      severity: paymentItem.severity,
      transactionId: TX,
      resolveAllowed: true,
      recoverKind: "payment",
    };
    const paymentResolve = vi.fn(async () => paymentOk("verified"));
    const salesResolve = vi.fn(async () => saleOk("completed"));

    const outcome = await recoverAttentionItem(localPayment, {
      payments: { resolve: paymentResolve },
      sales: { resolve: salesResolve },
    });

    expect(outcome.status).toBe("attempted");
    expect(paymentResolve).toHaveBeenCalledWith({ transactionId: TX, paymentId: undefined });
    expect(salesResolve).toHaveBeenCalledWith(TX);
  });

  test("local recovery identity wins when server attention overlaps the same transaction", () => {
    const localSale: AttentionItemView = {
      id: "local-journal:sale-op",
      title: saleItem.title,
      summary: saleItem.summary,
      typeLabel: saleItem.typeLabel,
      severity: saleItem.severity,
      transactionId: TX,
      resolveAllowed: true,
      recoverKind: "sale",
    };
    const merged = mergeAttentionItems([saleItem], [localSale], []);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("local-journal:sale-op");
  });

  test("payment Check / Recover calls PaymentPort.resolve once for the same transaction/payment and never initialize", async () => {
    const initialize = vi.fn();
    const resolve = vi.fn(async () => paymentOk());
    const salesResolve = vi.fn();
    const payments = { initialize, resolve } as Pick<PaymentPort, "resolve"> & { initialize: typeof initialize };
    const sales = { resolve: salesResolve } as Pick<SalesPort, "resolve">;
    const outcome = await recoverAttentionItem(paymentItem, { payments, sales });
    expect(outcome.status).toBe("attempted");
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith({ transactionId: TX, paymentId: PAYMENT });
    expect(initialize).not.toHaveBeenCalled();
    expect(salesResolve).not.toHaveBeenCalled();
  });

  test("sale Check / Recover calls SalesPort.resolve for the same transaction", async () => {
    const paymentResolve = vi.fn();
    const salesResolve = vi.fn(async () => saleOk());
    await recoverAttentionItem(saleItem, {
      payments: { resolve: paymentResolve },
      sales: { resolve: salesResolve },
    });
    expect(salesResolve).toHaveBeenCalledTimes(1);
    expect(salesResolve).toHaveBeenCalledWith(TX);
    expect(paymentResolve).not.toHaveBeenCalled();
  });

  test("refund/return operations are not treated as sale recovery", async () => {
    const paymentResolve = vi.fn();
    const salesResolve = vi.fn();
    const outcome = await recoverAttentionItem(refundItem, {
      payments: { resolve: paymentResolve },
      sales: { resolve: salesResolve },
    });
    expect(outcome.status).toBe("unsupported");
    expect(paymentResolve).not.toHaveBeenCalled();
    expect(salesResolve).not.toHaveBeenCalled();
  });

  test("attention reload runs after recovery and unresolved durable state remains", async () => {
    const inbox = [paymentItem];
    const resolve = vi.fn(async () => paymentOk("requires_attention"));
    const reload = vi.fn(async () => undefined);
    const lock = createAttentionRecoveryLock();
    const status = await runAttentionRecovery({
      item: paymentItem,
      lock,
      ports: { payments: { resolve }, sales: { resolve: vi.fn() } },
      reload,
    });
    expect(status).toBe("attempted");
    expect(reload).toHaveBeenCalledTimes(1);
    expect(inbox).toHaveLength(1);
    expect(lock.inFlightId()).toBeNull();
  });

  test("resolved durable read result is what removes the item, not the request itself", async () => {
    let inbox: AttentionItemView[] = [paymentItem];
    const resolve = vi.fn(async () => paymentOk("verified"));
    await runAttentionRecovery({
      item: paymentItem,
      lock: createAttentionRecoveryLock(),
      ports: { payments: { resolve }, sales: { resolve: vi.fn() } },
      reload: async () => {
        inbox = [];
      },
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(inbox).toEqual([]);
  });

  test("repeated recover while in-flight does not issue a duplicate resolve", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    const resolve = vi.fn(async () => {
      await gate;
      return paymentOk();
    });
    const reload = vi.fn(async () => undefined);
    const lock = createAttentionRecoveryLock();
    const ports = { payments: { resolve }, sales: { resolve: vi.fn() } };
    const first = runAttentionRecovery({ item: paymentItem, lock, ports, reload });
    const second = await runAttentionRecovery({ item: paymentItem, lock, ports, reload });
    expect(second).toBe("in_flight");
    expect(resolve).toHaveBeenCalledTimes(1);
    release?.();
    await first;
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

const CASHIER_A = "cashier_a";
const CASHIER_B = "cashier_b";
const REGISTER_A = "reg_a";
const REGISTER_B = "reg_b";
const PREPARE_KEY = "44444444-4444-4444-8444-444444444444";

describe("CAN-01 local recovery scope", () => {
  test("cashier B keeps A's unresolved sale, without inheriting authorship, and is blocked only on that register", async () => {
    const name = uniqueDbName();
    const db = openPosLocalDatabase(name);
    const journal = createOperationJournal(db, {
      createdByActorId: CASHIER_A,
      organizationId: "org_a",
      locationId: "loc_a1",
      registerId: REGISTER_A,
      deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
    });
    await createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        throw new TypeError("simulated lost prepare response");
      },
      scope: { ...LOCAL_CHECKOUT_SCOPE, registerId: REGISTER_A },
      journal,
      tenderActivity: createTenderActivityPort(db),
    }).checkout.prepare(
      {
        transactionId: TX,
        registerId: REGISTER_A,
        shiftId: LOCAL_CHECKOUT_SCOPE.shiftId,
        deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
        quoteId: "quote-can-01",
        quoteFingerprint: "0123456789abcdef0123456789abcdef",
      },
      { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
    );

    const stored = await listUnresolvedJournalRecords(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.pending.status).toBe("response_unknown");
    expect(stored[0]?.pending.idempotencyKey).toBe(PREPARE_KEY);
    expect(stored[0]?.scope.createdByActorId).toBe(CASHIER_A);

    const sameRegister = await loadLocalJournalAttentionItems(journal, {
      actorId: CASHIER_B,
      registerId: REGISTER_A,
      organizationId: "org_a",
    }, db);
    expect(sameRegister).toHaveLength(1);
    expect(sameRegister[0]?.localRecoveryOwner).toBe("other");
    expect(localRecoverySellBanner(true, sameRegister)?.title).toBe("This register needs a status check.");
    expect(sameRegister[0]?.summary).toContain("Another cashier");
    expect(sameRegister[0]?.summary).toContain("not started in your current sign-in");
    expect(sameRegister[0]?.summary).not.toContain(CASHIER_B);
    expect(sameRegister[0]?.summary).not.toMatch(/OperationJournal|IndexedDB|request hash|sale\.prepare/i);
    expect(hasBlockingLocalTransactionRecovery(sameRegister)).toBe(true);

    const otherRegister = await loadLocalJournalAttentionItems(journal, {
      actorId: CASHIER_B,
      registerId: REGISTER_B,
      organizationId: "org_a",
    }, db);
    expect(otherRegister[0]?.summary).toContain("different register");
    expect(localRecoverySellBanner(true, otherRegister)).toBeNull();
    expect(hasBlockingLocalTransactionRecovery(otherRegister)).toBe(false);

    const ownReload = await loadLocalJournalAttentionItems(journal, {
      actorId: CASHIER_A,
      registerId: REGISTER_A,
      organizationId: "org_a",
    }, db);
    expect(ownReload[0]?.localRecoveryOwner).toBe("viewer");
    expect(ownReload[0]?.summary).toContain("This sale needs a status check");
    expect(localRecoverySellBanner(true, ownReload)?.title).toBe("Previous transaction needs a status check.");
    expect(hasBlockingLocalTransactionRecovery(ownReload)).toBe(true);

    const requested: string[] = [];
    const recovery = createBrowserCashCheckoutPorts({
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(JSON.stringify({
          ok: true,
          correlationId: CORRELATION,
          data: { transactionId: TX, status: "not_found" },
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
      scope: { ...LOCAL_CHECKOUT_SCOPE, registerId: REGISTER_A },
      journal,
      tenderActivity: createTenderActivityPort(db),
    });
    await runAttentionRecovery({
      item: sameRegister[0]!,
      lock: createAttentionRecoveryLock(),
      ports: { payments: recovery.payments, sales: recovery.sales },
      reload: async () => undefined,
    });
    expect(requested.some((url) => url.includes("/sales/prepare"))).toBe(false);
    expect(requested.some((url) => url.includes(`/sales/${TX}`))).toBe(true);
    const after = await db.journal.get(PREPARE_KEY);
    expect(after?.status).toBe("acknowledged");
    expect(after?.idempotencyKey).toBe(PREPARE_KEY);
  });

  test("a second device database does not invent the first device's local evidence", async () => {
    const firstName = uniqueDbName();
    const secondName = uniqueDbName();
    const first = openPosLocalDatabase(firstName);
    const journal = createOperationJournal(first, { createdByActorId: CASHIER_A, registerId: REGISTER_A });
    await journal.appendBeforeSend(
      {
        id: PREPARE_KEY,
        transactionId: TX,
        operation: "sale.prepare",
        idempotencyKey: PREPARE_KEY,
        requestHash: await (async () => {
          const payload = {
            payloadVersion: "1.0.0",
            operation: "sale.prepare",
            transactionId: TX,
            request: { transactionId: TX, registerId: REGISTER_A },
          };
          const { sha256Hex, canonicalJson } = await import("../local/canonical");
          return sha256Hex(canonicalJson(payload));
        })(),
        payloadVersion: "1.0.0",
        status: "response_unknown",
        attempts: 1,
        createdAt: "2026-09-25T09:00:00.000Z",
      },
      JSON.stringify({
        payloadVersion: "1.0.0",
        operation: "sale.prepare",
        transactionId: TX,
        request: { transactionId: TX, registerId: REGISTER_A },
      }),
    );
    const second = openPosLocalDatabase(secondName);
    const secondItems = await loadLocalJournalAttentionItems(
      createOperationJournal(second),
      { actorId: CASHIER_B, registerId: REGISTER_A },
      second,
    );
    expect(secondItems).toEqual([]);
    expect(await second.journal.count()).toBe(0);
    expect(await first.journal.count()).toBe(1);
  });

  test("sign-out does not delete unresolved evidence or rotate its idempotency key", async () => {
    const name = uniqueDbName();
    const db = openPosLocalDatabase(name);
    const journal = createOperationJournal(db, { createdByActorId: CASHIER_A, registerId: REGISTER_A });
    const payload = { payloadVersion: "1.0.0", operation: "sale.prepare", transactionId: TX, request: { registerId: REGISTER_A } };
    const { sha256Hex, canonicalJson } = await import("../local/canonical");
    const requestHash = await sha256Hex(canonicalJson(payload));
    await journal.appendBeforeSend({
      id: PREPARE_KEY,
      transactionId: TX,
      operation: "sale.prepare",
      idempotencyKey: PREPARE_KEY,
      requestHash,
      payloadVersion: "1.0.0",
      status: "response_unknown",
      attempts: 1,
      createdAt: "2026-09-25T09:00:00.000Z",
    }, JSON.stringify(payload));
    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          throw new Error("unused");
        },
        async readContext() {
          throw new Error("unused");
        },
        async read() {
          return null;
        },
        async clear() {
          return;
        },
      },
      auth: {
        async signIn() {
          return { accessToken: "token", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        },
        async signOut() {
          return;
        },
      },
      registers: {} as RegisterPort,
    });
    await runtime.signOut();
    const row = await db.journal.get(PREPARE_KEY);
    expect(row?.status).toBe("response_unknown");
    expect(row?.idempotencyKey).toBe(PREPARE_KEY);
    expect(await db.journal.count()).toBe(1);
    await journal.markAcknowledged(PREPARE_KEY);
    await journal.markAcknowledged(PREPARE_KEY);
    const acknowledged = await db.journal.get(PREPARE_KEY);
    expect(acknowledged?.idempotencyKey).toBe(PREPARE_KEY);
    expect(acknowledged?.status).toBe("acknowledged");
  });

  test("legacy rows with unknown organization stay stored and are not shown to a known organization", async () => {
    const name = uniqueDbName();
    const db = openPosLocalDatabase(name);
    const payload = JSON.stringify({ kind: "sale.prepare", note: "historic" });
    const { sha256Hex, canonicalJson } = await import("../local/canonical");
    const requestHash = await sha256Hex(canonicalJson(JSON.parse(payload)));
    await db.journal.add({
      id: PREPARE_KEY,
      transactionId: TX,
      operation: "sale.prepare",
      idempotencyKey: PREPARE_KEY,
      requestHash,
      payloadVersion: "1.0.0",
      status: "response_unknown",
      attempts: 1,
      createdAt: "2026-09-20T22:10:14.444Z",
      payload,
      attemptHistory: [{ at: "2026-09-20T22:10:14.444Z", status: "response_unknown" }],
    });
    const items = await loadLocalJournalAttentionItems(
      createOperationJournal(db),
      { actorId: CASHIER_B, registerId: REGISTER_B, organizationId: "org_a" },
      db,
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.quarantine).toBe(true);
    expect(items[0]?.summary).toBe(UNKNOWN_ORGANIZATION_RECOVERY_COPY);
    expect(items[0]?.transactionId).toBeUndefined();
    expect(items[0]?.resolveAllowed).toBe(false);
    expect(items[0]?.summary).not.toContain(CASHIER_B);
    expect(items[0]?.summary).not.toContain(TX);
    expect(items[0]?.summary).not.toContain(PREPARE_KEY);
    expect(items[0]?.summary).not.toContain("org_a");
    expect(items[0]?.summary).not.toMatch(/sale\.prepare|IndexedDB|OperationJournal/i);
    expect(hasBlockingLocalTransactionRecovery(items)).toBe(true);
    expect(localRecoverySellBanner(true, items)?.detail).toBe(UNKNOWN_ORGANIZATION_RECOVERY_COPY);
    const stored = await listUnresolvedJournalRecords(db);
    expect(stored).toHaveLength(1);
    expect(stored[0]?.scope.createdByActorId).toBeUndefined();
    expect(stored[0]?.scope.organizationId).toBeUndefined();
    expect(stored[0]?.pending.status).toBe("response_unknown");
    expect(stored[0]?.pending.idempotencyKey).toBe(PREPARE_KEY);
    const raw = await db.journal.get(PREPARE_KEY);
    expect(raw?.recoveryScope?.organizationId).toBeUndefined();
    expect(raw?.status).toBe("response_unknown");
  });

  test("a known different organization does not see or block on the other organization's unresolved sale", async () => {
    const name = uniqueDbName();
    const db = openPosLocalDatabase(name);
    const journal = createOperationJournal(db, {
      createdByActorId: CASHIER_A,
      organizationId: "org_a",
      locationId: "loc_a1",
      registerId: REGISTER_A,
      deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
    });
    await createBrowserCashCheckoutPorts({
      fetchImpl: async () => {
        throw new TypeError("simulated lost prepare response");
      },
      scope: { ...LOCAL_CHECKOUT_SCOPE, registerId: REGISTER_A },
      journal,
      tenderActivity: createTenderActivityPort(db),
    }).checkout.prepare(
      {
        transactionId: TX,
        registerId: REGISTER_A,
        shiftId: LOCAL_CHECKOUT_SCOPE.shiftId,
        deviceId: LOCAL_CHECKOUT_SCOPE.deviceId,
        quoteId: "quote-org-boundary",
        quoteFingerprint: "0123456789abcdef0123456789abcdef",
      },
      { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
    );

    const orgB = await loadLocalJournalAttentionItems(journal, {
      actorId: CASHIER_B,
      registerId: REGISTER_A,
      organizationId: "org_b",
    }, db);
    expect(orgB).toEqual([]);
    expect(hasBlockingLocalTransactionRecovery(orgB)).toBe(false);
    expect(localRecoverySellBanner(true, orgB)).toBeNull();

    const collidingRegister = await loadLocalJournalAttentionItems(journal, {
      actorId: CASHIER_B,
      registerId: REGISTER_A,
      organizationId: "org_b",
    }, db);
    expect(collidingRegister).toEqual([]);

    const runtime = createStaffRuntimeController({
      gateway: {
        async establish() {
          throw new Error("unused");
        },
        async readContext() {
          throw new Error("unused");
        },
        async read() {
          return null;
        },
        async clear() {
          return;
        },
      },
      auth: {
        async signIn() {
          return { accessToken: "token", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        },
        async signOut() {
          return;
        },
      },
      registers: {} as RegisterPort,
    });
    await runtime.signOut();

    const persisted = await db.journal.get(PREPARE_KEY);
    expect(persisted?.status).toBe("response_unknown");
    expect(persisted?.idempotencyKey).toBe(PREPARE_KEY);
    expect(persisted?.recoveryScope?.organizationId).toBe("org_a");
    expect(persisted?.recoveryScope?.createdByActorId).toBe(CASHIER_A);

    const orgA = await loadLocalJournalAttentionItems(journal, {
      actorId: CASHIER_A,
      registerId: REGISTER_A,
      organizationId: "org_a",
    }, db);
    expect(orgA).toHaveLength(1);
    expect(orgA[0]?.localRecoveryOwner).toBe("viewer");
    expect(orgA[0]?.summary).not.toContain(CASHIER_B);
    expect(hasBlockingLocalTransactionRecovery(orgA)).toBe(true);
    const afterReturn = await db.journal.get(PREPARE_KEY);
    expect(afterReturn?.idempotencyKey).toBe(PREPARE_KEY);
    expect(afterReturn?.recoveryScope?.organizationId).toBe("org_a");
    expect(afterReturn?.status).toBe("response_unknown");
  });

  test("a register change invalidates the previous recovery scan before the next scan resolves", async () => {
    const name = uniqueDbName();
    const db = openPosLocalDatabase(name);
    const deviceId = LOCAL_CHECKOUT_SCOPE.deviceId;
    const journal = createOperationJournal(db, {
      createdByActorId: CASHIER_A,
      organizationId: "org_a",
      registerId: REGISTER_A,
      deviceId,
    });
    const prepareCalls: string[] = [];
    await createBrowserCashCheckoutPorts({
      fetchImpl: async (input) => {
        prepareCalls.push(String(input));
        throw new TypeError("simulated lost prepare response");
      },
      scope: { ...LOCAL_CHECKOUT_SCOPE, registerId: REGISTER_A },
      journal,
      tenderActivity: createTenderActivityPort(db),
    }).checkout.prepare(
      {
        transactionId: TX,
        registerId: REGISTER_A,
        shiftId: LOCAL_CHECKOUT_SCOPE.shiftId,
        deviceId,
        quoteId: "quote-register-switch",
        quoteFingerprint: "0123456789abcdef0123456789abcdef",
      },
      { idempotencyKey: PREPARE_KEY, correlationId: CORRELATION },
    );
    prepareCalls.length = 0;

    const context = (registerId: string): LocalRecoveryContext => ({
      organizationId: "org_a",
      actorId: CASHIER_B,
      registerId,
      deviceId,
    });
    const viewer = (registerId: string) => ({
      actorId: CASHIER_B,
      organizationId: "org_a",
      registerId,
    });
    const registerBItems = await loadLocalJournalAttentionItems(journal, viewer(REGISTER_B), db);
    expect(hasBlockingLocalTransactionRecovery(registerBItems)).toBe(false);
    const scannedRegisterB = context(REGISTER_B);
    expect(checkoutBlockedByLocalRecovery({
      scanned: scannedRegisterB,
      current: context(REGISTER_A),
      items: registerBItems,
    })).toBe(true);

    let releaseRegisterA: (items: readonly AttentionItemView[]) => void = () => undefined;
    const registerAScan = new Promise<readonly AttentionItemView[]>((resolve) => {
      releaseRegisterA = resolve;
    });
    const gate = createRecoveryScanGate();
    const registerBToken = gate.start();
    const registerAToken = gate.start();
    expect(gate.isCurrent(registerBToken)).toBe(false);
    expect(checkoutBlockedByLocalRecovery({
      scanned: scannedRegisterB,
      current: context(REGISTER_A),
      items: registerBItems,
    })).toBe(true);

    const registerAItems = await loadLocalJournalAttentionItems(journal, viewer(REGISTER_A), db);
    releaseRegisterA(registerAItems);
    const appliedRegisterA = await registerAScan;
    expect(gate.isCurrent(registerAToken)).toBe(true);
    expect(hasBlockingLocalTransactionRecovery(appliedRegisterA)).toBe(true);
    expect(appliedRegisterA[0]?.resolveAllowed).toBe(true);
    expect(checkoutBlockedByLocalRecovery({
      scanned: context(REGISTER_A),
      current: context(REGISTER_A),
      items: appliedRegisterA,
    })).toBe(true);
    expect(checkoutBlockedByLocalRecovery({
      scanned: context(REGISTER_A),
      current: context(REGISTER_B),
      items: appliedRegisterA,
    })).toBe(true);
    expect(checkoutBlockedByLocalRecovery({
      scanned: scannedRegisterB,
      current: context(REGISTER_B),
      items: registerBItems,
    })).toBe(false);
    expect(prepareCalls).toEqual([]);
    const row = await db.journal.get(PREPARE_KEY);
    expect(row?.status).toBe("response_unknown");
    expect(row?.idempotencyKey).toBe(PREPARE_KEY);
    expect(row?.recoveryScope?.organizationId).toBe("org_a");
  });
});
