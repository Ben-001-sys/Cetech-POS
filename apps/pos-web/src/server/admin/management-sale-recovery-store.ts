import type { PendingOperation } from "../../../../../docs/contracts/domain.generated";
import type { PrepareIntentSnapshot } from "../../core/receipt/prepare-intent";
import { isPrepareIntentSnapshot } from "../../core/receipt/prepare-intent";
import { readSupabaseInfrastructureEnv } from "../../config/env";
import { isUuid } from "../auth/ids";
import { createServerRestFetch, type PosRestFetch } from "../http/server-fetch";

export type OriginalManagementPrepare = {
  readonly organizationId: string;
  readonly locationId: string;
  readonly registerId: string;
  readonly shiftId: string;
  readonly transactionId: string;
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly status: PendingOperation["status"];
  readonly intent: PrepareIntentSnapshot;
  readonly outcome: unknown;
};

/** Read-only evidence, scoped to the authenticated organization before retrieval. */
export interface ManagementSaleRecoveryStore {
  getOriginal(organizationId: string, transactionId: string): Promise<OriginalManagementPrepare | "unavailable" | undefined>;
}

export function createSupabaseManagementSaleRecoveryStore(input: {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
}): ManagementSaleRecoveryStore {
  return {
    async getOriginal(organizationId, transactionId) {
      try {
        const response = await input.fetchImpl(`${input.url.replace(/\/+$/, "")}/rest/v1/pos_pending_operations?organization_id=eq.${encodeURIComponent(organizationId)}&transaction_id=eq.${encodeURIComponent(transactionId)}&operation=eq.sale.prepare&select=organization_id,location_id,register_id,shift_id,transaction_id,idempotency_key,request_hash,payload_version,status,intent_snapshot,outcome&limit=2`, {
          method: "GET",
          headers: { apikey: input.serviceRoleKey, Authorization: `Bearer ${input.serviceRoleKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) return "unavailable";
        const body: unknown = await response.json();
        if (!Array.isArray(body) || body.length > 1) return "unavailable";
        if (body.length === 0) return undefined;
        const row = body[0] as Record<string, unknown>;
        if (!row || row.organization_id !== organizationId || row.transaction_id !== transactionId ||
            typeof row.location_id !== "string" || !row.location_id || typeof row.register_id !== "string" || !row.register_id ||
            !isUuid(row.shift_id) || !isUuid(row.idempotency_key) || typeof row.request_hash !== "string" ||
            !/^[a-f0-9]{64}$/.test(row.request_hash) || row.payload_version !== "1.0.0" ||
            !["pending", "sent", "response_unknown", "acknowledged", "requires_attention"].includes(String(row.status)) ||
            !isPrepareIntentSnapshot(row.intent_snapshot)) return "unavailable";
        return {
          organizationId, locationId: row.location_id, registerId: row.register_id,
          shiftId: row.shift_id, transactionId, idempotencyKey: row.idempotency_key,
          requestHash: row.request_hash, status: row.status as PendingOperation["status"],
          intent: row.intent_snapshot, outcome: row.outcome,
        };
      } catch { return "unavailable"; }
    },
  };
}

export function composeManagementSaleRecoveryStore(env: Readonly<Record<string, string | undefined>> = process.env): ManagementSaleRecoveryStore {
  const infrastructure = readSupabaseInfrastructureEnv(env);
  if (infrastructure) return createSupabaseManagementSaleRecoveryStore({ ...infrastructure, fetchImpl: createServerRestFetch() });
  if (env.APP_ENV === "staging" || env.APP_ENV === "production") throw new Error("durable original-sale evidence is required");
  return { async getOriginal() { return undefined; } };
}
