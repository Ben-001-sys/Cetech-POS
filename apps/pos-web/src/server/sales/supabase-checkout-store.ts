import type {
  Id,
  PendingOperation,
  Quote,
  ReceiptSnapshot,
  ShiftReport,
  Uuid,
} from "../../../../../docs/contracts/domain.generated";
import type { PosRestFetch } from "../http/server-fetch";
import type {
  CheckoutStore,
  CommandScopeBinding,
  IdempotencyClaim,
  OutboxEvent,
  PosSaleRecord,
  PrepareOperationDiagnostic,
  SeedPreparedSaleInput,
  StoredCashMovement,
  StoredDevice,
  StoredPayment,
  StoredProviderEvent,
  StoredRegister,
  StoredShift,
} from "../../core/checkout/types";
import { claimKindForExistingPrepare } from "../../core/checkout/prepare-claim";
import { isPrepareIntentSnapshot, type PrepareIntentSnapshot } from "../../core/receipt/prepare-intent";

export type SupabaseCheckoutStoreOptions = {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8_000;
const CONTRACT_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const PAYMENT_SELECT =
  "payment_id,transaction_id,sale_id,evidence_id,tender,status,amount_minor,amount_currency,cash_received_minor,cash_received_currency,verified_at,verification_source,actor_id,provider,provider_reference,provider_transaction_id,display_reference,access_code,initialize_status,last_verified_at,attention_reason";

type RestRow = Record<string, unknown>;

/** PostgREST timestamptz round-trips as +00:00; frozen v1 Timestamp requires Z. */
function toContractTimestamp(value: string): string | null {
  if (CONTRACT_TIMESTAMP.test(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return new Date(parsed).toISOString();
}

/**
 * Durable CheckoutStore backed by POS operational tables.
 * Concurrency and idempotency use database uniqueness, not process Maps.
 * service_role is infrastructure access, not cashier authorization.
 */
export function createSupabaseCheckoutStore(options: SupabaseCheckoutStoreOptions): CheckoutStore {
  const root = `${options.url.replace(/\/+$/, "")}/rest/v1`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function request(input: {
    readonly path: string;
    readonly method: string;
    readonly body?: unknown;
    readonly prefer?: string;
  }): Promise<{ readonly status: number; readonly body: unknown }> {
    const response = await options.fetchImpl(`${root}/${input.path}`, {
      method: input.method,
      headers: input.prefer ? { ...headers, Prefer: input.prefer } : headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("durable checkout store denied infrastructure access");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  async function getRows(path: string): Promise<RestRow[]> {
    const result = await request({ path, method: "GET" });
    if (!result.status || result.status >= 400) {
      throw new Error("durable checkout store is unavailable");
    }
    if (!Array.isArray(result.body)) {
      throw new Error("durable checkout store is unavailable");
    }
    return result.body.filter((row): row is RestRow => row !== null && typeof row === "object");
  }

  async function getOne(path: string): Promise<RestRow | undefined> {
    const rows = await getRows(path);
    return rows[0];
  }

  async function readLocation(organizationId: string, locationId: string) {
    const row = await getOne(
      `pos_locations?id=eq.${encodeURIComponent(locationId)}&organization_id=eq.${encodeURIComponent(organizationId)}&select=name,status`,
    );
    if (!row || (row.status !== "active" && row.status !== "inactive")) {
      throw new Error("durable location lifecycle is unavailable");
    }
    return {
      locationName: typeof row.name === "string" && row.name.trim() ? row.name.trim() : undefined,
      locationStatus: row.status,
    } as const;
  }

  return {
    async withLock(_key, fn) {
      return fn();
    },

    async seedRegister(register) {
      const result = await request({
        path: "pos_registers?on_conflict=id",
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          id: register.id,
          organization_id: register.organizationId,
          location_id: register.locationId,
          name: register.name,
          currency: register.currency,
          status: register.status,
        },
      });
      if (result.status !== 201 && result.status !== 200) {
        throw new Error("durable checkout store rejected register seed");
      }
    },

    async seedDevice(device) {
      const result = await request({
        path: "pos_devices?on_conflict=id",
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          id: device.id,
          organization_id: device.organizationId,
          location_id: device.locationId,
          label: "POS device",
          status: device.status,
        },
      });
      if (result.status !== 201 && result.status !== 200) {
        throw new Error("durable checkout store rejected device seed");
      }
    },

    async getRegister(id) {
      const row = await getOne(`pos_registers?id=eq.${encodeURIComponent(id)}&select=id,organization_id,location_id,name,currency,status`);
      const register = row ? mapRegister(row) : undefined;
      if (!register) return undefined;
      return { ...register, ...await readLocation(register.organizationId, register.locationId) };
    },

    async getDevice(id) {
      const row = await getOne(`pos_devices?id=eq.${encodeURIComponent(id)}&select=id,organization_id,location_id,status`);
      return row ? mapDevice(row) : undefined;
    },

    async getActiveShift(registerId) {
      const row = await getOne(
        `pos_shifts?register_id=eq.${encodeURIComponent(registerId)}&status=in.(open,closing)&select=id,organization_id,location_id,register_id,device_id,cashier_id,status,opening_float_minor,opening_float_currency,expected_cash_minor,expected_cash_currency,counted_cash_minor,counted_cash_currency,variance_minor,variance_currency,opened_at,closed_at,z_report_id`,
      );
      return row ? mapShift(row) : undefined;
    },

    async getShift(id) {
      const row = await getOne(
        `pos_shifts?id=eq.${encodeURIComponent(id)}&select=id,organization_id,location_id,register_id,device_id,cashier_id,status,opening_float_minor,opening_float_currency,expected_cash_minor,expected_cash_currency,counted_cash_minor,counted_cash_currency,variance_minor,variance_currency,opened_at,closed_at,z_report_id`,
      );
      return row ? mapShift(row) : undefined;
    },

    async insertOpenShift(shift) {
      const result = await request({
        path: "pos_shifts",
        method: "POST",
        prefer: "return=minimal",
        body: {
          id: shift.id,
          register_id: shift.registerId,
          device_id: shift.deviceId,
          cashier_id: shift.cashierId,
          status: "open",
          opening_float_minor: shift.openingFloat.minor,
          opening_float_currency: shift.openingFloat.currency,
          expected_cash_minor: shift.expectedCash?.minor ?? shift.openingFloat.minor,
          expected_cash_currency: shift.openingFloat.currency,
        },
      });
      if (result.status === 201 || result.status === 200) {
        return "ok";
      }
      if (result.status === 409 || constraintName(result.body).includes("pos_shifts_one_active")) {
        return "conflict";
      }
      throw new Error("durable checkout store rejected shift insert");
    },

    async closeShift(input) {
      const existing = await this.getShift(input.shiftId);
      if (!existing) {
        return "missing";
      }
      if (existing.status === "closed") {
        return "already_closed";
      }
      if (existing.status !== "open" && existing.status !== "closing" && existing.status !== "requires_attention") {
        return "not_open";
      }
      const expected = existing.expectedCash ?? existing.openingFloat;
      const varianceMinor = input.countedCash.minor - expected.minor;
      const result = await request({
        path: `pos_shifts?id=eq.${encodeURIComponent(input.shiftId)}`,
        method: "PATCH",
        prefer: "return=minimal",
        body: {
          status: input.status,
          counted_cash_minor: input.countedCash.minor,
          counted_cash_currency: input.countedCash.currency,
          variance_minor: varianceMinor,
          variance_currency: expected.currency,
          closed_at: input.status === "closed" ? input.closedAt ?? new Date().toISOString() : null,
          z_report_id: input.status === "closed" ? input.zReportId ?? null : null,
        },
      });
      if (result.status >= 400) {
        throw new Error("durable checkout store rejected shift close");
      }
      return "ok";
    },

    async saveShiftReport(report) {
      const existing = await this.getShiftReport(report.shiftId, report.kind);
      if (existing) {
        return existing.id === report.id ? "ok" : "duplicate";
      }
      const shift = await this.getShift(report.shiftId);
      if (!shift) {
        throw new Error("durable checkout store rejected shift report without a shift");
      }
      const result = await request({
        path: "pos_shift_reports",
        method: "POST",
        prefer: "return=minimal",
        body: {
          id: report.id,
          organization_id: shift.organizationId,
          location_id: shift.locationId,
          register_id: shift.registerId,
          shift_id: report.shiftId,
          kind: report.kind,
          expected_cash_minor: report.expectedCash.minor,
          counted_cash_minor: report.countedCash?.minor ?? null,
          variance_minor: report.variance?.minor ?? null,
          currency: report.expectedCash.currency,
          created_at: report.createdAt,
        },
      });
      if (result.status === 201 || result.status === 200) {
        return "ok";
      }
      if (result.status === 409) {
        const replay = await this.getShiftReport(report.shiftId, report.kind);
        return replay?.id === report.id ? "ok" : "duplicate";
      }
      throw new Error("durable checkout store rejected shift report insert");
    },

    async getShiftReport(shiftId, kind) {
      const row = await getOne(
        `pos_shift_reports?shift_id=eq.${encodeURIComponent(shiftId)}&kind=eq.${encodeURIComponent(kind)}&select=id,shift_id,kind,expected_cash_minor,counted_cash_minor,variance_minor,currency,created_at`,
      );
      return row ? mapShiftReport(row) : undefined;
    },

    async appendCashMovement(movement) {
      if (movement.kind === "opening_float") {
        const existing = await getOne(
          `pos_cash_movements?shift_id=eq.${encodeURIComponent(movement.shiftId)}&kind=eq.opening_float&select=id`,
        );
        if (existing) {
          return "ok";
        }
      }
      const result = await request({
        path: "pos_cash_movements",
        method: "POST",
        prefer: "return=minimal",
        body: {
          id: movement.id,
          shift_id: movement.shiftId,
          kind: movement.kind,
          signed_amount_minor: movement.signedAmount.minor,
          currency: movement.signedAmount.currency,
          actor_id: movement.actorId,
          transaction_id: movement.transactionId ?? null,
          reason: movement.reason ?? null,
          refund_id: movement.refundId ?? null,
        },
      });
      if (result.status === 201 || result.status === 200) {
        return "ok";
      }
      const constraint = constraintName(result.body);
      const message = errorMessage(result.body);
      if (constraint.includes("pos_cash_one_refund_per_refund_id")) {
        return "duplicate_refund";
      }
      if (result.status === 409 || constraint.includes("pos_cash_one_sale_per_transaction")) {
        return "duplicate_sale";
      }
      if (constraint.includes("pos_cash_one_opening_float")) {
        return "ok";
      }
      if (message.includes("open shift") || message.includes("cash movements require")) {
        return "shift_required";
      }
      if (message.includes("negative")) {
        return "negative_expected";
      }
      throw new Error("durable checkout store rejected cash movement");
    },

    async listCashSales(transactionId) {
      const rows = await getRows(
        `pos_cash_movements?kind=eq.cash_sale&transaction_id=eq.${encodeURIComponent(transactionId)}&select=id,organization_id,shift_id,kind,signed_amount_minor,currency,actor_id,created_at,transaction_id,reason,refund_id`,
      );
      return rows.map(mapCashMovement).filter((row): row is StoredCashMovement => row !== undefined);
    },

    async listCashRefunds(refundId) {
      const rows = await getRows(
        `pos_cash_movements?kind=eq.cash_refund&refund_id=eq.${encodeURIComponent(refundId)}&select=id,organization_id,shift_id,kind,signed_amount_minor,currency,actor_id,created_at,transaction_id,reason,refund_id`,
      );
      return rows.map(mapCashMovement).filter((row): row is StoredCashMovement => row !== undefined);
    },

    async expectedCash(shiftId) {
      const shift = await this.getShift(shiftId);
      return shift?.expectedCash;
    },

    async saveQuote(quote) {
      const location = await getOne(
        `pos_locations?id=eq.${encodeURIComponent(quote.locationId)}&select=id,organization_id`,
      );
      if (!location || typeof location.organization_id !== "string") {
        throw new Error("durable checkout store rejected quote location");
      }
      const result = await request({
        path: "pos_quote_snapshots?on_conflict=id",
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          id: quote.id,
          organization_id: location.organization_id,
          location_id: quote.locationId,
          snapshot: quote,
          updated_at: new Date().toISOString(),
        },
      });
      if (result.status !== 201 && result.status !== 200) {
        throw new Error("durable checkout store rejected quote snapshot");
      }
    },

    async getQuote(quoteId) {
      const row = await getOne(`pos_quote_snapshots?id=eq.${encodeURIComponent(quoteId)}&select=snapshot`);
      return row ? asQuote(row.snapshot) : undefined;
    },

    async seedPreparedSale(input) {
      const record = saleFromSeed(input);
      // An original-order repair may race a payment on another server instance.
      // Seeding must never replace the first persisted sale/payment state.
      const result = await request({
        path: "pos_checkout_sales?on_conflict=transaction_id",
        method: "POST",
        prefer: "resolution=ignore-duplicates,return=minimal",
        body: saleRestRow(record),
      });
      if (result.status !== 201 && result.status !== 200) {
        throw new Error("durable checkout store rejected prepared sale insert");
      }
      const saved = await this.getSale(input.prepared.transactionId);
      if (!saved) {
        throw new Error("durable checkout store did not retain a prepared sale");
      }
      return saved;
    },

    async getSale(transactionId) {
      const row = await getOne(
        `pos_checkout_sales?transaction_id=eq.${encodeURIComponent(transactionId)}&select=record`,
      );
      return row ? asSale(row.record) : undefined;
    },

    async getSaleBySaleId(organizationId, saleId) {
      const row = await getOne(
        `pos_checkout_sales?organization_id=eq.${encodeURIComponent(organizationId)}&sale_id=eq.${encodeURIComponent(saleId)}&select=record`,
      );
      return row ? asSale(row.record) : undefined;
    },

    async listRecentSales(input) {
      const limit = Math.min(Math.max(input.limit ?? 80, 1), 200);
      const onlyLocation = input.locationIds?.length === 1 ? input.locationIds[0] : undefined;
      const locationFilter = onlyLocation ? `&location_id=eq.${encodeURIComponent(onlyLocation)}` : "";
      const rows = await getRows(
        `pos_checkout_sales?organization_id=eq.${encodeURIComponent(input.organizationId)}${locationFilter}&select=record,location_id,updated_at&order=updated_at.desc&limit=${limit}`,
      );
      const allowed = input.locationIds && input.locationIds.length > 0 ? new Set(input.locationIds) : undefined;
      return rows.flatMap((row) => {
        const sale = asSale(row.record);
        if (!sale) return [];
        if (allowed && !allowed.has(sale.locationId)) return [];
        return [sale];
      });
    },

    async saveSale(sale) {
      await upsertSale(sale, request);
    },

    async getPayment(paymentId) {
      const row = await getOne(
        `pos_checkout_payments?payment_id=eq.${encodeURIComponent(paymentId)}&select=${PAYMENT_SELECT}`,
      );
      return row ? mapPayment(row) : undefined;
    },

    async getPaymentForTransaction(transactionId) {
      const row = await getOne(
        `pos_checkout_payments?transaction_id=eq.${encodeURIComponent(transactionId)}&select=${PAYMENT_SELECT}`,
      );
      return row ? mapPayment(row) : undefined;
    },

    async getPaymentByProviderReference(provider, reference) {
      const row = await getOne(
        `pos_checkout_payments?provider=eq.${encodeURIComponent(provider)}&provider_reference=eq.${encodeURIComponent(reference)}&select=${PAYMENT_SELECT}`,
      );
      return row ? mapPayment(row) : undefined;
    },

    async savePayment(payment) {
      const sale = await this.getSale(payment.transactionId);
      const result = await request({
        path: "pos_checkout_payments?on_conflict=payment_id",
        method: "POST",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: {
          payment_id: payment.paymentId,
          organization_id: sale?.organizationId ?? "",
          location_id: sale?.locationId ?? "",
          transaction_id: payment.transactionId,
          sale_id: payment.saleId,
          evidence_id: payment.evidenceId ?? null,
          tender: payment.tender,
          status: payment.status,
          amount_minor: payment.amount.minor,
          amount_currency: payment.amount.currency,
          cash_received_minor: payment.cashReceived?.minor ?? null,
          cash_received_currency: payment.cashReceived?.currency ?? null,
          verified_at: payment.verifiedAt ?? null,
          verification_source: payment.verificationSource ?? null,
          actor_id: payment.actorId,
          provider: payment.provider ?? null,
          provider_reference: payment.providerReference ?? null,
          provider_transaction_id: payment.providerTransactionId ?? null,
          display_reference: payment.displayReference ?? null,
          access_code: payment.accessCode ?? null,
          initialize_status: payment.initializeStatus ?? null,
          last_verified_at: payment.lastVerifiedAt ?? null,
          attention_reason: payment.attentionReason ?? null,
        },
      });
      if (result.status === 201 || result.status === 200) {
        return;
      }
      if (result.status === 409) {
        const existing = await this.getPayment(payment.paymentId);
        if (existing && existing.paymentId === payment.paymentId) {
          return;
        }
      }
      throw new Error("durable checkout store rejected payment");
    },

    async listUncertainPayments(input) {
      const limit = Math.min(Math.max(input.limit ?? 80, 1), 200);
      const onlyLocation = input.locationIds?.length === 1 ? input.locationIds[0] : undefined;
      const locationFilter = onlyLocation ? `&location_id=eq.${encodeURIComponent(onlyLocation)}` : "";
      const rows = await getRows(
        `pos_checkout_payments?organization_id=eq.${encodeURIComponent(input.organizationId)}${locationFilter}&status=in.(initializing,awaiting_customer,pending,reconciling,requires_attention)&select=${PAYMENT_SELECT},location_id&limit=${limit}`,
      );
      const allowed = input.locationIds && input.locationIds.length > 0 ? new Set(input.locationIds) : undefined;
      return rows.flatMap((row) => {
        if (allowed && typeof row.location_id === "string" && !allowed.has(row.location_id)) return [];
        const payment = mapPayment(row);
        return payment ? [payment] : [];
      });
    },

    async listAttentionShifts(input) {
      const limit = Math.min(Math.max(input.limit ?? 40, 1), 100);
      const onlyLocation = input.locationIds?.length === 1 ? input.locationIds[0] : undefined;
      const locationFilter = onlyLocation ? `&location_id=eq.${encodeURIComponent(onlyLocation)}` : "";
      const rows = await getRows(
        `pos_shifts?organization_id=eq.${encodeURIComponent(input.organizationId)}${locationFilter}&status=eq.requires_attention&select=id,organization_id,location_id,register_id,device_id,cashier_id,status,opening_float_minor,opening_float_currency,opened_at,closed_at,expected_cash_minor,expected_cash_currency,counted_cash_minor,counted_cash_currency,z_report_id&limit=${limit}`,
      );
      const allowed = input.locationIds && input.locationIds.length > 0 ? new Set(input.locationIds) : undefined;
      return rows.flatMap((row) => {
        const shift = mapShift(row);
        if (!shift) return [];
        if (allowed && !allowed.has(shift.locationId)) return [];
        return [shift];
      });
    },

    async listAttentionOperations(input) {
      const limit = Math.min(Math.max(input.limit ?? 40, 1), 100);
      const onlyLocation = input.locationIds?.length === 1 ? input.locationIds[0] : undefined;
      const locationFilter = onlyLocation ? `&location_id=eq.${encodeURIComponent(onlyLocation)}` : "";
      const rows = await getRows(
        `pos_pending_operations?organization_id=eq.${encodeURIComponent(input.organizationId)}${locationFilter}&status=in.(requires_attention,response_unknown,sent)&select=organization_id,location_id,register_id,shift_id,transaction_id,operation&limit=${limit}`,
      );
      const allowed = input.locationIds && input.locationIds.length > 0 ? new Set(input.locationIds) : undefined;
      return rows.flatMap((row) => {
        const scope = mapCommandScope(row);
        if (!scope) return [];
        if (allowed && !allowed.has(scope.locationId)) return [];
        return [scope];
      });
    },

    async saveProviderEvent(event) {
      const result = await request({
        path: "pos_provider_payment_events",
        method: "POST",
        prefer: "return=minimal",
        body: {
          id: event.id,
          organization_id: event.organizationId ?? null,
          location_id: event.locationId ?? null,
          provider: event.provider,
          provider_reference: event.providerReference ?? null,
          provider_transaction_id: event.providerTransactionId ?? null,
          event_type: event.eventType,
          event_fingerprint: event.eventFingerprint,
          raw_body_hash: event.rawBodyHash,
          received_at: event.receivedAt,
          processing_status: event.processingStatus,
          normalized_status: event.normalizedStatus ?? null,
          payment_id: event.paymentId ?? null,
          transaction_id: event.transactionId ?? null,
        },
      });
      if (result.status === 201) {
        return "inserted";
      }
      if (result.status === 200 || result.status === 409) {
        return "duplicate";
      }
      throw new Error("durable checkout store rejected provider event");
    },

    async getProviderEvent(provider, fingerprint) {
      const row = await getOne(
        `pos_provider_payment_events?provider=eq.${encodeURIComponent(provider)}&event_fingerprint=eq.${encodeURIComponent(fingerprint)}&select=id,organization_id,location_id,provider,provider_reference,provider_transaction_id,event_type,event_fingerprint,raw_body_hash,received_at,processing_status,normalized_status,payment_id,transaction_id`,
      );
      return row ? mapProviderEvent(row) : undefined;
    },

    async getReceipt(transactionId) {
      const row = await getOne(
        `pos_checkout_receipts?transaction_id=eq.${encodeURIComponent(transactionId)}&select=snapshot`,
      );
      return row ? asReceipt(row.snapshot) : undefined;
    },

    async saveReceipt(receipt) {
      const sale = await this.getSale(receipt.transactionId);
      const result = await request({
        path: "pos_checkout_receipts",
        method: "POST",
        prefer: "return=minimal",
        body: {
          id: receipt.id,
          organization_id: sale?.organizationId ?? "",
          location_id: sale?.locationId ?? "",
          transaction_id: receipt.transactionId,
          snapshot: receipt,
        },
      });
      if (result.status === 201 || result.status === 200) {
        return "ok";
      }
      if (result.status === 409) {
        const existing = await this.getReceipt(receipt.transactionId);
        if (existing && existing.id !== receipt.id) {
          return "duplicate";
        }
        return "ok";
      }
      throw new Error("durable checkout store rejected receipt");
    },

    async enqueueOutbox(event) {
      const result = await request({
        path: "pos_outbox_events",
        method: "POST",
        prefer: "return=minimal",
        body: {
          id: event.id,
          organization_id: event.organizationId,
          aggregate_type: event.aggregateType,
          aggregate_id: event.aggregateId,
          event_type: event.eventType,
          payload: event.payload,
          created_at: event.createdAt,
          published_at: event.publishedAt ?? null,
        },
      });
      if (result.status !== 201 && result.status !== 200) {
        throw new Error("durable checkout store rejected outbox event");
      }
    },

    async listOutbox(aggregateId) {
      const rows = await getRows(
        `pos_outbox_events?aggregate_id=eq.${encodeURIComponent(aggregateId)}&select=id,organization_id,aggregate_type,aggregate_id,event_type,payload,created_at,published_at`,
      );
      return rows.map(mapOutbox).filter((row): row is OutboxEvent => row !== undefined);
    },

    async lookupCommandScope(input) {
      const rows = await getRows(
        `pos_pending_operations?transaction_id=eq.${encodeURIComponent(input.transactionId)}&operation=eq.${encodeURIComponent(input.operation)}&select=organization_id,location_id,register_id,shift_id,transaction_id,operation`,
      );
      const row = rows[0];
      return row ? mapCommandScope(row) : undefined;
    },

    async claimIdempotency(organizationId, operation, idempotencyKey, requestHash, locationId, scope) {
      const existing = await getPending(getRows, organizationId, operation, idempotencyKey);
      if (existing) {
        return claimFromRow(existing, requestHash);
      }
      if (!locationId) {
        throw new Error("durable idempotency claim requires a location");
      }
      const result = await request({
        path: "pos_pending_operations",
        method: "POST",
        prefer: "return=representation",
        body: {
          organization_id: organizationId,
          location_id: locationId,
          operation,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          status: "pending",
          ...(scope?.registerId ? { register_id: scope.registerId } : {}),
          ...(scope?.shiftId ? { shift_id: scope.shiftId } : {}),
          ...(scope?.transactionId ? { transaction_id: scope.transactionId } : {}),
        },
      });
      if (result.status === 201 || result.status === 200) {
        return { kind: "acquired" };
      }
      if (result.status === 409) {
        const raced = await getPending(getRows, organizationId, operation, idempotencyKey);
        if (raced) {
          return claimFromRow(raced, requestHash);
        }
        return { kind: "conflict" };
      }
      throw new Error("durable checkout store rejected idempotency claim");
    },

    async markIdempotencySent(organizationId, operation, idempotencyKey) {
      await patchPending(request, organizationId, operation, idempotencyKey, { status: "sent" });
    },

    async bindPrepareIntent(organizationId, operation, idempotencyKey, snapshot) {
      const existing = await getPending(getRows, organizationId, operation, idempotencyKey);
      if (!existing) {
        throw new Error("prepare intent requires a claimed operation");
      }
      const current = parseIntentSnapshot(existing.intent_snapshot);
      if (current) {
        return current;
      }
      const result = await request({
        path: `pos_pending_operations?organization_id=eq.${encodeURIComponent(organizationId)}&operation=eq.${encodeURIComponent(operation)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&intent_snapshot=is.null`,
        method: "PATCH",
        prefer: "return=representation",
        body: { intent_snapshot: snapshot },
      });
      if (result.status < 400) {
        const written = firstIntentFromBody(result.body);
        if (written) {
          return written;
        }
      }
      const raced = await getPending(getRows, organizationId, operation, idempotencyKey);
      const parsed = parseIntentSnapshot(raced?.intent_snapshot);
      if (parsed) {
        return parsed;
      }
      throw new Error("durable checkout store rejected prepare intent");
    },

    async getPrepareIntent(organizationId, operation, idempotencyKey) {
      const existing = await getPending(getRows, organizationId, operation, idempotencyKey);
      return parseIntentSnapshot(existing?.intent_snapshot);
    },

    async acknowledgeIdempotency(organizationId, operation, idempotencyKey, outcome) {
      await patchPending(request, organizationId, operation, idempotencyKey, {
        status: "acknowledged",
        outcome,
      });
    },

    async markIdempotencyRequiresAttention(organizationId, operation, idempotencyKey, outcome) {
      await patchPending(request, organizationId, operation, idempotencyKey, {
        status: "requires_attention",
        outcome,
      });
    },

    async releaseIdempotency(organizationId, operation, idempotencyKey) {
      const existing = await getPending(getRows, organizationId, operation, idempotencyKey);
      if (existing?.status === "sent") {
        await patchPending(request, organizationId, operation, idempotencyKey, { status: "pending" });
      }
    },

    async recordPrepareDiagnostic(input) {
      const existing = await getPending(getRows, input.organizationId, input.operation, input.idempotencyKey);
      if (!existing) {
        return;
      }
      const current = numericAttempts(existing.attempts);
      const attempts = input.countAttempt ? current + 1 : Math.max(current, input.errorCode ? 1 : current);
      await patchPending(request, input.organizationId, input.operation, input.idempotencyKey, {
        status: input.status,
        attempts,
        last_attempt_at: input.attemptedAt,
        ...(input.errorCode !== undefined ? { last_error_code: input.errorCode } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      });
    },

    async readPrepareDiagnostic(organizationId, operation, idempotencyKey) {
      const existing = await getPending(getRows, organizationId, operation, idempotencyKey);
      return existing ? diagnosticFromRest(existing, idempotencyKey) : undefined;
    },

    async findSalePrepareOperation(transactionId) {
      const rows = await getRows(
        `pos_pending_operations?transaction_id=eq.${encodeURIComponent(transactionId)}&operation=eq.sale.prepare&select=${PENDING_DIAGNOSTIC_SELECT}`,
      );
      const row = rows[0];
      if (!row || typeof row.idempotency_key !== "string" || typeof row.organization_id !== "string") {
        return undefined;
      }
      return diagnosticFromRest(row, row.idempotency_key);
    },

    async peekIdempotency(organizationId, operation, idempotencyKey) {
      const existing = await getPending(getRows, organizationId, operation, idempotencyKey);
      return asPendingStatus(existing?.status);
    },
  };
}

async function upsertSale(
  sale: PosSaleRecord,
  request: (input: {
    readonly path: string;
    readonly method: string;
    readonly body?: unknown;
    readonly prefer?: string;
  }) => Promise<{ readonly status: number; readonly body: unknown }>,
): Promise<void> {
  const result = await request({
    path: "pos_checkout_sales?on_conflict=transaction_id",
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: saleRestRow(sale),
  });
  if (result.status !== 201 && result.status !== 200) {
    throw new Error("durable checkout store rejected sale");
  }
}

function saleRestRow(sale: PosSaleRecord): RestRow {
  return {
    transaction_id: sale.prepared.transactionId,
    organization_id: sale.organizationId,
    location_id: sale.locationId,
    register_id: sale.registerId,
    shift_id: sale.shiftId,
    sale_id: sale.prepared.saleId,
    status: sale.status,
    assigned_payment_id: sale.assignedPaymentId ?? null,
    commercial_confirmed: sale.commercialConfirmed,
    record: sale,
    updated_at: new Date().toISOString(),
  };
}

const PENDING_DIAGNOSTIC_SELECT =
  "organization_id,idempotency_key,transaction_id,request_hash,status,outcome,intent_snapshot,attempts,last_attempt_at,last_error_code";

function numericAttempts(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return 0;
}

function diagnosticFromRest(row: RestRow, idempotencyKey: Uuid): PrepareOperationDiagnostic | undefined {
  if (typeof row.organization_id !== "string" || typeof row.status !== "string") {
    return undefined;
  }
  return {
    organizationId: row.organization_id,
    idempotencyKey,
    transactionId: typeof row.transaction_id === "string" ? row.transaction_id : undefined,
    status: row.status as PrepareOperationDiagnostic["status"],
    attempts: numericAttempts(row.attempts),
    lastAttemptAt: typeof row.last_attempt_at === "string" ? row.last_attempt_at : undefined,
    lastErrorCode: typeof row.last_error_code === "string" ? row.last_error_code : undefined,
    outcome: row.outcome,
    intentPresent: parseIntentSnapshot(row.intent_snapshot) !== undefined,
  };
}

async function getPending(
  getRows: (path: string) => Promise<RestRow[]>,
  organizationId: Id,
  operation: PendingOperation["operation"],
  idempotencyKey: Uuid,
): Promise<RestRow | undefined> {
  const rows = await getRows(
    `pos_pending_operations?organization_id=eq.${encodeURIComponent(organizationId)}&operation=eq.${encodeURIComponent(operation)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&select=${PENDING_DIAGNOSTIC_SELECT}`,
  );
  return rows[0];
}

async function patchPending(
  request: (input: {
    readonly path: string;
    readonly method: string;
    readonly body?: unknown;
    readonly prefer?: string;
  }) => Promise<{ readonly status: number; readonly body: unknown }>,
  organizationId: Id,
  operation: PendingOperation["operation"],
  idempotencyKey: Uuid,
  body: RestRow,
): Promise<void> {
  const result = await request({
    path: `pos_pending_operations?organization_id=eq.${encodeURIComponent(organizationId)}&operation=eq.${encodeURIComponent(operation)}&idempotency_key=eq.${encodeURIComponent(idempotencyKey)}`,
    method: "PATCH",
    prefer: "return=minimal",
    body,
  });
  if (result.status >= 400) {
    throw new Error("durable checkout store rejected idempotency update");
  }
}

function mapCommandScope(row: RestRow): CommandScopeBinding | undefined {
  if (
    typeof row.organization_id !== "string" ||
    typeof row.location_id !== "string" ||
    typeof row.operation !== "string"
  ) {
    return undefined;
  }
  return {
    organizationId: row.organization_id,
    locationId: row.location_id,
    registerId: typeof row.register_id === "string" ? row.register_id : undefined,
    shiftId: typeof row.shift_id === "string" ? row.shift_id : undefined,
    transactionId: typeof row.transaction_id === "string" ? row.transaction_id : undefined,
    operation: row.operation as CommandScopeBinding["operation"],
  };
}

function parseIntentSnapshot(value: unknown): PrepareIntentSnapshot | undefined {
  return isPrepareIntentSnapshot(value) ? value : undefined;
}

function firstIntentFromBody(body: unknown): PrepareIntentSnapshot | undefined {
  if (!Array.isArray(body)) {
    return undefined;
  }
  for (const row of body) {
    if (row !== null && typeof row === "object" && "intent_snapshot" in row) {
      const parsed = parseIntentSnapshot((row as RestRow).intent_snapshot);
      if (parsed) {
        return parsed;
      }
    }
  }
  return undefined;
}

function claimFromRow(row: RestRow, requestHash: string): IdempotencyClaim {
  if (typeof row.request_hash !== "string" || row.request_hash !== requestHash) {
    return { kind: "conflict" };
  }
  const kind = claimKindForExistingPrepare({
    status: typeof row.status === "string" ? row.status : "",
    outcome: row.outcome,
    intentPresent: parseIntentSnapshot(row.intent_snapshot) !== undefined,
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
}

function saleFromSeed(input: SeedPreparedSaleInput): PosSaleRecord {
  return {
    ...input,
    status: "prepared",
    commercialConfirmed: false,
  };
}

function mapRegister(row: RestRow): StoredRegister | undefined {
  if (
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.location_id !== "string" ||
    typeof row.name !== "string" ||
    typeof row.currency !== "string" ||
    (row.status !== "active" && row.status !== "disabled" && row.status !== "maintenance")
  ) {
    return undefined;
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    name: row.name,
    currency: row.currency as StoredRegister["currency"],
    status: row.status,
  };
}

function mapDevice(row: RestRow): StoredDevice | undefined {
  if (
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.location_id !== "string" ||
    (row.status !== "active" && row.status !== "inactive")
  ) {
    return undefined;
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    status: row.status,
  };
}

function mapShift(row: RestRow): StoredShift | undefined {
  if (
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.location_id !== "string" ||
    typeof row.register_id !== "string" ||
    typeof row.device_id !== "string" ||
    typeof row.cashier_id !== "string" ||
    typeof row.opening_float_minor !== "number" ||
    typeof row.opening_float_currency !== "string" ||
    typeof row.opened_at !== "string"
  ) {
    return undefined;
  }
  const status = row.status;
  if (status !== "open" && status !== "closing" && status !== "closed" && status !== "requires_attention") {
    return undefined;
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    locationId: row.location_id,
    registerId: row.register_id,
    deviceId: row.device_id,
    cashierId: row.cashier_id,
    status,
    openingFloat: { minor: row.opening_float_minor, currency: row.opening_float_currency as StoredShift["openingFloat"]["currency"] },
    expectedCash:
      typeof row.expected_cash_minor === "number" && typeof row.expected_cash_currency === "string"
        ? { minor: row.expected_cash_minor, currency: row.expected_cash_currency as StoredShift["openingFloat"]["currency"] }
        : undefined,
    countedCash:
      typeof row.counted_cash_minor === "number" && typeof row.counted_cash_currency === "string"
        ? { minor: row.counted_cash_minor, currency: row.counted_cash_currency as StoredShift["openingFloat"]["currency"] }
        : undefined,
    variance:
      typeof row.variance_minor === "number" && typeof row.variance_currency === "string"
        ? { minor: row.variance_minor, currency: row.variance_currency as StoredShift["openingFloat"]["currency"] }
        : undefined,
    openedAt: toContractTimestamp(row.opened_at) ?? row.opened_at,
    closedAt: typeof row.closed_at === "string" ? toContractTimestamp(row.closed_at) ?? row.closed_at : undefined,
    zReportId: typeof row.z_report_id === "string" ? row.z_report_id : undefined,
  };
}

function mapShiftReport(row: RestRow): ShiftReport | undefined {
  if (
    typeof row.id !== "string" ||
    typeof row.shift_id !== "string" ||
    (row.kind !== "X" && row.kind !== "Z") ||
    typeof row.expected_cash_minor !== "number" ||
    typeof row.currency !== "string" ||
    typeof row.created_at !== "string"
  ) {
    return undefined;
  }
  const currency = row.currency as ShiftReport["expectedCash"]["currency"];
  return {
    id: row.id,
    shiftId: row.shift_id,
    kind: row.kind,
    expectedCash: { minor: row.expected_cash_minor, currency },
    createdAt: toContractTimestamp(row.created_at) ?? row.created_at,
    ...(typeof row.counted_cash_minor === "number"
      ? { countedCash: { minor: row.counted_cash_minor, currency } }
      : {}),
    ...(typeof row.variance_minor === "number" ? { variance: { minor: row.variance_minor, currency } } : {}),
  };
}

function mapCashMovement(row: RestRow): StoredCashMovement | undefined {
  if (
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.shift_id !== "string" ||
    typeof row.kind !== "string" ||
    typeof row.signed_amount_minor !== "number" ||
    typeof row.currency !== "string" ||
    typeof row.actor_id !== "string" ||
    typeof row.created_at !== "string"
  ) {
    return undefined;
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    shiftId: row.shift_id,
    kind: row.kind as StoredCashMovement["kind"],
    signedAmount: { minor: row.signed_amount_minor, currency: row.currency as StoredCashMovement["signedAmount"]["currency"] },
    actorId: row.actor_id,
    createdAt: toContractTimestamp(row.created_at) ?? row.created_at,
    transactionId: typeof row.transaction_id === "string" ? row.transaction_id : undefined,
    reason: typeof row.reason === "string" ? row.reason : undefined,
    refundId: typeof row.refund_id === "string" ? row.refund_id : undefined,
  };
}

function asPaymentTender(value: unknown): StoredPayment["tender"] | undefined {
  if (value === "cash" || value === "mobile_money" || value === "card" || value === "external_electronic") {
    return value;
  }
  return undefined;
}

function asPaymentStatus(value: unknown): StoredPayment["status"] | undefined {
  if (
    value === "initializing" ||
    value === "awaiting_customer" ||
    value === "pending" ||
    value === "cancelled" ||
    value === "failed" ||
    value === "reconciling" ||
    value === "requires_attention" ||
    value === "verified"
  ) {
    return value;
  }
  return undefined;
}

function asVerificationSource(value: unknown): StoredPayment["verificationSource"] | undefined {
  if (
    value === "cash_ledger" ||
    value === "provider_server_verification" ||
    value === "approved_external_attestation"
  ) {
    return value;
  }
  return undefined;
}

function asInitializeStatus(value: unknown): StoredPayment["initializeStatus"] | undefined {
  if (value === "pending_remote" || value === "initialized" || value === "lost_response") {
    return value;
  }
  return undefined;
}

function mapPayment(row: RestRow): StoredPayment | undefined {
  const tender = asPaymentTender(row.tender);
  const status = asPaymentStatus(row.status);
  if (
    typeof row.payment_id !== "string" ||
    typeof row.transaction_id !== "string" ||
    typeof row.sale_id !== "string" ||
    typeof row.amount_minor !== "number" ||
    typeof row.amount_currency !== "string" ||
    typeof row.actor_id !== "string" ||
    !tender ||
    !status
  ) {
    return undefined;
  }
  const verifiedAt = typeof row.verified_at === "string" ? toContractTimestamp(row.verified_at) : undefined;
  const lastVerifiedAt =
    typeof row.last_verified_at === "string" ? toContractTimestamp(row.last_verified_at) : undefined;
  return {
    paymentId: row.payment_id,
    transactionId: row.transaction_id,
    saleId: row.sale_id,
    evidenceId: typeof row.evidence_id === "string" ? row.evidence_id : undefined,
    tender,
    status,
    amount: { minor: row.amount_minor, currency: row.amount_currency as StoredPayment["amount"]["currency"] },
    cashReceived:
      typeof row.cash_received_minor === "number" && typeof row.cash_received_currency === "string"
        ? {
            minor: row.cash_received_minor,
            currency: row.cash_received_currency as StoredPayment["amount"]["currency"],
          }
        : undefined,
    verifiedAt: verifiedAt ?? undefined,
    verificationSource: asVerificationSource(row.verification_source),
    actorId: row.actor_id,
    provider: typeof row.provider === "string" ? row.provider : undefined,
    providerReference: typeof row.provider_reference === "string" ? row.provider_reference : undefined,
    providerTransactionId: typeof row.provider_transaction_id === "string" ? row.provider_transaction_id : undefined,
    displayReference: typeof row.display_reference === "string" ? row.display_reference : undefined,
    accessCode: typeof row.access_code === "string" ? row.access_code : undefined,
    initializeStatus: asInitializeStatus(row.initialize_status),
    lastVerifiedAt: lastVerifiedAt ?? undefined,
    attentionReason: typeof row.attention_reason === "string" ? row.attention_reason : undefined,
  };
}

function mapProviderEvent(row: RestRow): StoredProviderEvent | undefined {
  if (
    typeof row.id !== "string" ||
    typeof row.provider !== "string" ||
    typeof row.event_type !== "string" ||
    typeof row.event_fingerprint !== "string" ||
    typeof row.raw_body_hash !== "string" ||
    typeof row.received_at !== "string" ||
    (row.processing_status !== "ingested" &&
      row.processing_status !== "processed" &&
      row.processing_status !== "ignored" &&
      row.processing_status !== "requires_attention")
  ) {
    return undefined;
  }
  return {
    id: row.id,
    organizationId: typeof row.organization_id === "string" ? row.organization_id : undefined,
    locationId: typeof row.location_id === "string" ? row.location_id : undefined,
    provider: row.provider,
    providerReference: typeof row.provider_reference === "string" ? row.provider_reference : undefined,
    providerTransactionId: typeof row.provider_transaction_id === "string" ? row.provider_transaction_id : undefined,
    eventType: row.event_type,
    eventFingerprint: row.event_fingerprint,
    rawBodyHash: row.raw_body_hash,
    receivedAt: toContractTimestamp(row.received_at) ?? row.received_at,
    processingStatus: row.processing_status,
    normalizedStatus: typeof row.normalized_status === "string" ? row.normalized_status : undefined,
    paymentId: typeof row.payment_id === "string" ? row.payment_id : undefined,
    transactionId: typeof row.transaction_id === "string" ? row.transaction_id : undefined,
  };
}

function mapOutbox(row: RestRow): OutboxEvent | undefined {
  if (
    typeof row.id !== "string" ||
    typeof row.organization_id !== "string" ||
    typeof row.aggregate_type !== "string" ||
    typeof row.aggregate_id !== "string" ||
    typeof row.event_type !== "string" ||
    typeof row.created_at !== "string"
  ) {
    return undefined;
  }
  const payload =
    row.payload !== null && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? Object.fromEntries(
          Object.entries(row.payload as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
        )
      : {};
  return {
    id: row.id,
    organizationId: row.organization_id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    payload,
    createdAt: toContractTimestamp(row.created_at) ?? row.created_at,
    publishedAt: typeof row.published_at === "string" ? row.published_at : undefined,
  };
}

function asQuote(value: unknown): Quote | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const quote = value as Quote;
  return typeof quote.id === "string" && typeof quote.fingerprint === "string" ? quote : undefined;
}

function asSale(value: unknown): PosSaleRecord | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const sale = value as PosSaleRecord;
  return sale.prepared && typeof sale.prepared.transactionId === "string" ? { ...sale } : undefined;
}

function asReceipt(value: unknown): ReceiptSnapshot | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const receipt = value as ReceiptSnapshot;
  return typeof receipt.id === "string" && typeof receipt.transactionId === "string" ? receipt : undefined;
}

function asPendingStatus(value: unknown): PendingOperation["status"] | undefined {
  if (
    value === "pending" ||
    value === "sent" ||
    value === "response_unknown" ||
    value === "acknowledged" ||
    value === "requires_attention"
  ) {
    return value;
  }
  return undefined;
}

function constraintName(body: unknown): string {
  if (body === null || typeof body !== "object") {
    return "";
  }
  const data = body as Record<string, unknown>;
  return `${String(data.code ?? "")} ${String(data.message ?? "")} ${String(data.details ?? "")}`.toLowerCase();
}

function errorMessage(body: unknown): string {
  if (body === null || typeof body !== "object") {
    return "";
  }
  const data = body as Record<string, unknown>;
  return String(data.message ?? data.details ?? "").toLowerCase();
}
