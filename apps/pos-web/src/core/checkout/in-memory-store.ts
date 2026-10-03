import type { Id, PendingOperation, Quote, ReceiptSnapshot, ShiftReport, Uuid } from "../../../../../docs/contracts/domain.generated";
import { isPrepareIntentSnapshot, type PrepareIntentSnapshot } from "../receipt/prepare-intent";
import { claimKindForExistingPrepare } from "./prepare-claim";
import { mergeStoredPayment, mergeStoredSale } from "./monotonic";
import type {
  CommandScopeBinding,
  FaultInjectingCheckoutStore,
  OutboxEvent,
  PosSaleRecord,
  PrepareOperationDiagnostic,
  StoredCashMovement,
  StoredDevice,
  StoredPayment,
  StoredProviderEvent,
  StoredRegister,
  StoredShift,
} from "./types";

type IdempotencyRow = {
  readonly organizationId: Id;
  readonly operation: PendingOperation["operation"];
  readonly idempotencyKey: Uuid;
  requestHash: string;
  status: PendingOperation["status"];
  outcome?: unknown;
  intentSnapshot?: PrepareIntentSnapshot;
  attempts: number;
  lastAttemptAt?: string;
  lastErrorCode?: string;
  locationId?: Id;
  registerId?: Id;
  shiftId?: Uuid;
  transactionId?: Uuid;
};

function idempKey(organizationId: Id, operation: PendingOperation["operation"], key: Uuid): string {
  return `${organizationId}\0${operation}\0${key}`;
}

function scopeKey(operation: PendingOperation["operation"], transactionId: Uuid): string {
  return `${operation}\0${transactionId}`;
}

function diagnosticFromRow(row: IdempotencyRow): PrepareOperationDiagnostic {
  return {
    organizationId: row.organizationId,
    idempotencyKey: row.idempotencyKey,
    transactionId: row.transactionId,
    status: row.status,
    attempts: row.attempts ?? 0,
    lastAttemptAt: row.lastAttemptAt,
    lastErrorCode: row.lastErrorCode,
    outcome: row.outcome,
    intentPresent: row.intentSnapshot !== undefined,
  };
}

export function createInMemoryCheckoutStore(): FaultInjectingCheckoutStore {
  const registers = new Map<Id, StoredRegister>();
  const devices = new Map<Uuid, StoredDevice>();
  const shifts = new Map<Uuid, StoredShift>();
  const activeByRegister = new Map<Id, Uuid>();
  const movements: StoredCashMovement[] = [];
  const quotes = new Map<Id, Quote>();
  const sales = new Map<Uuid, PosSaleRecord>();
  const payments = new Map<Uuid, StoredPayment>();
  const paymentsByTx = new Map<Uuid, Uuid>();
  const paymentsByProviderRef = new Map<string, Uuid>();
  const providerEvents = new Map<string, StoredProviderEvent>();
  const receipts = new Map<Uuid, ReceiptSnapshot>();
  const outbox: OutboxEvent[] = [];
  const reports = new Map<string, ShiftReport>();
  const idempotency = new Map<string, IdempotencyRow>();
  const scopeByTransaction = new Map<string, CommandScopeBinding>();
  const chains = new Map<string, Promise<void>>();

  const store: FaultInjectingCheckoutStore = {
    failNextReceiptWrite: false,
    failNextPaymentWrite: false,
    failNextSaleWrite: false,
    failNextCommercialConfirmedWrite: false,
    failNextIntentWrite: false,
    receiptWriteAttempts: 0,

    async withLock(key, fn) {
      const previous = chains.get(key) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      chains.set(
        key,
        previous.then(() => gate),
      );
      await previous;
      try {
        return await fn();
      } finally {
        release();
      }
    },

    async seedRegister(register) {
      registers.set(register.id, register);
    },

    async seedDevice(device) {
      devices.set(device.id, device);
    },

    async getRegister(id) {
      return registers.get(id);
    },

    async getDevice(id) {
      return devices.get(id);
    },

    async getActiveShift(registerId) {
      const shiftId = activeByRegister.get(registerId);
      return shiftId ? shifts.get(shiftId) : undefined;
    },

    async getShift(id) {
      return shifts.get(id);
    },

    async insertOpenShift(shift) {
      if (activeByRegister.has(shift.registerId)) {
        return "conflict";
      }
      shifts.set(shift.id, shift);
      activeByRegister.set(shift.registerId, shift.id);
      return "ok";
    },

    async closeShift(input) {
      const shift = shifts.get(input.shiftId);
      if (!shift) {
        return "missing";
      }
      if (shift.status === "closed") {
        return "already_closed";
      }
      if (shift.status !== "open" && shift.status !== "closing" && shift.status !== "requires_attention") {
        return "not_open";
      }
      const expected = shift.expectedCash ?? shift.openingFloat;
      const next = {
        ...shift,
        status: input.status,
        countedCash: input.countedCash,
        expectedCash: expected,
        variance: {
          minor: input.countedCash.minor - expected.minor,
          currency: expected.currency,
        },
        closedAt: input.status === "closed" ? input.closedAt : undefined,
        zReportId: input.status === "closed" ? input.zReportId : undefined,
      };
      shifts.set(shift.id, next);
      if (input.status === "closed") {
        activeByRegister.delete(shift.registerId);
      }
      return "ok";
    },

    async appendCashMovement(movement) {
      const shift = shifts.get(movement.shiftId);
      if (!shift || shift.status !== "open") {
        return "shift_required";
      }
      if (movement.kind === "cash_sale" && movement.transactionId) {
        const duplicate = movements.some(
          (row) => row.kind === "cash_sale" && row.transactionId === movement.transactionId,
        );
        if (duplicate) {
          return "duplicate_sale";
        }
      }
      if (movement.kind === "cash_refund" && movement.refundId) {
        const duplicate = movements.some(
          (row) => row.kind === "cash_refund" && row.refundId === movement.refundId,
        );
        if (duplicate) {
          return "duplicate_refund";
        }
      }
      if (movement.kind !== "opening_float") {
        const next = (shift.expectedCash?.minor ?? 0) + movement.signedAmount.minor;
        if (next < 0) {
          return "negative_expected";
        }
        shifts.set(shift.id, {
          ...shift,
          expectedCash: { minor: next, currency: shift.openingFloat.currency },
        });
      }
      movements.push(movement);
      return "ok";
    },

    async listCashSales(transactionId) {
      return movements.filter((row) => row.kind === "cash_sale" && row.transactionId === transactionId);
    },

    async listCashRefunds(refundId) {
      return movements.filter((row) => row.kind === "cash_refund" && row.refundId === refundId);
    },

    async expectedCash(shiftId) {
      return shifts.get(shiftId)?.expectedCash;
    },

    async saveShiftReport(report) {
      const key = `${report.shiftId}\0${report.kind}`;
      const existing = reports.get(key);
      if (existing) {
        return existing.id === report.id ? "ok" : "duplicate";
      }
      reports.set(key, report);
      return "ok";
    },

    async getShiftReport(shiftId, kind) {
      return reports.get(`${shiftId}\0${kind}`);
    },

    async saveQuote(quote) {
      quotes.set(quote.id, quote);
    },

    async getQuote(quoteId) {
      return quotes.get(quoteId);
    },

    async seedPreparedSale(input) {
      const existing = sales.get(input.prepared.transactionId);
      if (existing) return { ...existing };
      const record: PosSaleRecord = {
        ...input,
        status: "prepared",
        commercialConfirmed: false,
      };
      sales.set(input.prepared.transactionId, record);
      return record;
    },

    async getSale(transactionId) {
      const row = sales.get(transactionId);
      return row ? { ...row } : undefined;
    },

    async getSaleBySaleId(organizationId, saleId) {
      for (const row of sales.values()) {
        if (row.organizationId === organizationId && row.prepared.saleId === saleId) {
          return { ...row };
        }
      }
      return undefined;
    },

    async listRecentSales(input) {
      const limit = input.limit ?? 80;
      const locationIds = input.locationIds;
      return [...sales.values()]
        .filter((row) => {
          if (row.organizationId !== input.organizationId) return false;
          if (locationIds && locationIds.length > 0 && !locationIds.includes(row.locationId)) return false;
          return true;
        })
        .sort((left, right) => right.prepared.preparedAt.localeCompare(left.prepared.preparedAt))
        .slice(0, limit)
        .map((row) => ({ ...row }));
    },

    async saveSale(sale) {
      if (store.failNextSaleWrite) {
        store.failNextSaleWrite = false;
        throw new Error("injected POS sale persistence failure");
      }
      if (sale.commercialConfirmed && store.failNextCommercialConfirmedWrite) {
        store.failNextCommercialConfirmedWrite = false;
        throw new Error("injected POS commercial-confirmed persistence failure");
      }
      sales.set(
        sale.prepared.transactionId,
        mergeStoredSale(sales.get(sale.prepared.transactionId), { ...sale }),
      );
    },

    async getPayment(paymentId) {
      return payments.get(paymentId);
    },

    async getPaymentForTransaction(transactionId) {
      const paymentId = paymentsByTx.get(transactionId);
      return paymentId ? payments.get(paymentId) : undefined;
    },

    async getPaymentByProviderReference(provider, reference) {
      const paymentId = paymentsByProviderRef.get(`${provider}\0${reference}`);
      return paymentId ? payments.get(paymentId) : undefined;
    },

    async listUncertainPayments(input) {
      const uncertain: ReadonlySet<StoredPayment["status"]> = new Set([
        "initializing",
        "awaiting_customer",
        "pending",
        "reconciling",
        "requires_attention",
      ]);
      const locationByTx = new Map(
        [...sales.values()].map((sale) => [sale.prepared.transactionId, sale] as const),
      );
      const limit = input.limit ?? 80;
      return [...payments.values()]
        .filter((payment) => {
          if (!uncertain.has(payment.status)) return false;
          const sale = locationByTx.get(payment.transactionId);
          if (!sale || sale.organizationId !== input.organizationId) return false;
          if (input.locationIds && input.locationIds.length > 0 && !input.locationIds.includes(sale.locationId)) {
            return false;
          }
          return true;
        })
        .slice(0, limit);
    },

    async listAttentionShifts(input) {
      const locationIds = input.locationIds;
      const limit = input.limit ?? 40;
      return [...shifts.values()]
        .filter((shift) => {
          if (shift.organizationId !== input.organizationId) return false;
          if (shift.status !== "requires_attention") return false;
          if (locationIds && locationIds.length > 0 && !locationIds.includes(shift.locationId)) return false;
          return true;
        })
        .slice(0, limit);
    },

    async listAttentionOperations(input) {
      const locationIds = input.locationIds;
      const limit = input.limit ?? 40;
      const rows: CommandScopeBinding[] = [];
      for (const row of idempotency.values()) {
        if (row.organizationId !== input.organizationId) continue;
        if (row.status !== "requires_attention" && row.status !== "response_unknown" && row.status !== "sent") continue;
        if (!row.transactionId || !row.locationId) continue;
        if (locationIds && locationIds.length > 0 && !locationIds.includes(row.locationId)) continue;
        rows.push({
          organizationId: row.organizationId,
          locationId: row.locationId,
          registerId: row.registerId,
          shiftId: row.shiftId,
          transactionId: row.transactionId,
          operation: row.operation,
        });
        if (rows.length >= limit) break;
      }
      return rows;
    },

    async savePayment(payment) {
      if (store.failNextPaymentWrite) {
        store.failNextPaymentWrite = false;
        throw new Error("injected POS payment persistence failure");
      }
      const existingTx = paymentsByTx.get(payment.transactionId);
      if (existingTx && existingTx !== payment.paymentId) {
        throw new Error("one payment intent per transaction");
      }
      if (payment.provider && payment.providerReference) {
        const refKey = `${payment.provider}\0${payment.providerReference}`;
        const existingRef = paymentsByProviderRef.get(refKey);
        if (existingRef && existingRef !== payment.paymentId) {
          throw new Error("provider reference already exists");
        }
        paymentsByProviderRef.set(refKey, payment.paymentId);
      }
      const merged = mergeStoredPayment(payments.get(payment.paymentId), payment);
      payments.set(merged.paymentId, merged);
      paymentsByTx.set(merged.transactionId, merged.paymentId);
    },

    async saveProviderEvent(event) {
      const key = `${event.provider}\0${event.eventFingerprint}`;
      if (providerEvents.has(key)) {
        return "duplicate";
      }
      providerEvents.set(key, event);
      return "inserted";
    },

    async getProviderEvent(provider, fingerprint) {
      return providerEvents.get(`${provider}\0${fingerprint}`);
    },

    async getReceipt(transactionId) {
      return receipts.get(transactionId);
    },

    async saveReceipt(receipt) {
      store.receiptWriteAttempts += 1;
      if (store.failNextReceiptWrite) {
        store.failNextReceiptWrite = false;
        throw new Error("injected POS receipt persistence failure");
      }
      const existing = receipts.get(receipt.transactionId);
      if (existing && existing.id !== receipt.id) {
        return "duplicate";
      }
      receipts.set(receipt.transactionId, receipt);
      return "ok";
    },

    async enqueueOutbox(event) {
      outbox.push(event);
    },

    async listOutbox(aggregateId) {
      return outbox.filter((event) => event.aggregateId === aggregateId);
    },

    async lookupCommandScope(input) {
      return scopeByTransaction.get(scopeKey(input.operation, input.transactionId));
    },

    async claimIdempotency(organizationId, operation, idempotencyKey, requestHash, locationId, scope) {
      const key = idempKey(organizationId, operation, idempotencyKey);
      const row = idempotency.get(key);
      if (!row) {
        const created: IdempotencyRow = {
          organizationId,
          operation,
          idempotencyKey,
          requestHash,
          status: "pending",
          attempts: 0,
          locationId,
          registerId: scope?.registerId,
          shiftId: scope?.shiftId,
          transactionId: scope?.transactionId,
        };
        idempotency.set(key, created);
        if (scope?.transactionId && locationId) {
          const boundKey = scopeKey(operation, scope.transactionId);
          if (!scopeByTransaction.has(boundKey)) {
            scopeByTransaction.set(boundKey, {
              organizationId,
              locationId,
              registerId: scope.registerId,
              shiftId: scope.shiftId,
              transactionId: scope.transactionId,
              operation,
            });
          }
        }
        return { kind: "acquired" };
      }
      if (row.requestHash !== requestHash) {
        return { kind: "conflict" };
      }
      const kind = claimKindForExistingPrepare({
        status: row.status,
        outcome: row.outcome,
        intentPresent: isPrepareIntentSnapshot(row.intentSnapshot),
      });
      if (kind === "in_progress") {
        return { kind: "in_progress" };
      }
      if (kind === "replay") {
        return { kind: "replay", outcome: row.outcome };
      }
      if (kind === "repair") {
        return { kind: "repair", outcome: row.outcome };
      }
      return { kind: "acquired" };
    },

    async markIdempotencySent(organizationId, operation, idempotencyKey) {
      const row = idempotency.get(idempKey(organizationId, operation, idempotencyKey));
      if (row) {
        row.status = "sent";
      }
    },

    async bindPrepareIntent(organizationId, operation, idempotencyKey, snapshot) {
      if (store.failNextIntentWrite) {
        store.failNextIntentWrite = false;
        throw new Error("injected prepare-intent write failure");
      }
      const row = idempotency.get(idempKey(organizationId, operation, idempotencyKey));
      if (!row) {
        throw new Error("prepare intent requires a claimed operation");
      }
      if (row.intentSnapshot !== undefined) {
        if (!isPrepareIntentSnapshot(row.intentSnapshot)) {
          throw new Error("durable prepare intent is present but invalid");
        }
        return row.intentSnapshot;
      }
      row.intentSnapshot = snapshot;
      return snapshot;
    },

    async getPrepareIntent(organizationId, operation, idempotencyKey) {
      const row = idempotency.get(idempKey(organizationId, operation, idempotencyKey));
      return row?.intentSnapshot && isPrepareIntentSnapshot(row.intentSnapshot) ? row.intentSnapshot : undefined;
    },

    async acknowledgeIdempotency(organizationId, operation, idempotencyKey, outcome) {
      const row = idempotency.get(idempKey(organizationId, operation, idempotencyKey));
      if (row) {
        row.status = "acknowledged";
        row.outcome = outcome;
      }
    },

    async markIdempotencyRequiresAttention(organizationId, operation, idempotencyKey, outcome) {
      const row = idempotency.get(idempKey(organizationId, operation, idempotencyKey));
      if (row) {
        row.status = "requires_attention";
        row.outcome = outcome;
      }
    },

    async releaseIdempotency(organizationId, operation, idempotencyKey) {
      const row = idempotency.get(idempKey(organizationId, operation, idempotencyKey));
      if (row && row.status === "sent") {
        row.status = "pending";
      }
    },

    async recordPrepareDiagnostic(input) {
      const row = idempotency.get(idempKey(input.organizationId, input.operation, input.idempotencyKey));
      if (!row) {
        return;
      }
      const current = row.attempts ?? 0;
      row.attempts = input.countAttempt ? current + 1 : Math.max(current, input.errorCode ? 1 : current);
      row.lastAttemptAt = input.attemptedAt;
      row.status = input.status;
      if (input.errorCode !== undefined) {
        row.lastErrorCode = input.errorCode;
      }
      if (input.outcome !== undefined) {
        row.outcome = input.outcome;
      }
    },

    async readPrepareDiagnostic(organizationId, operation, idempotencyKey) {
      const row = idempotency.get(idempKey(organizationId, operation, idempotencyKey));
      return row ? diagnosticFromRow(row) : undefined;
    },

    async findSalePrepareOperation(transactionId) {
      for (const row of idempotency.values()) {
        if (row.operation === "sale.prepare" && row.transactionId === transactionId) {
          return diagnosticFromRow(row);
        }
      }
      return undefined;
    },

    async peekIdempotency(organizationId, operation, idempotencyKey) {
      return idempotency.get(idempKey(organizationId, operation, idempotencyKey))?.status;
    },
  };

  return store;
}
