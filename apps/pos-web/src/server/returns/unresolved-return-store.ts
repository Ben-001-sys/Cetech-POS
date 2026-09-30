import type { Timestamp } from "../../../../../docs/contracts/domain.generated";
import type { ReturnStore, StoredReturnRecord } from "../../core/returns/types";
import type { PosRestFetch } from "../http/server-fetch";

const UNRESOLVED_RETURN_STATUSES = ["refund_pending", "in_progress", "requires_attention"] as const;

export type ReturnStoreWithUnresolvedLookup = ReturnStore & {
  getUnresolvedReturnForSale(
    organizationId: string,
    saleId: string,
    checkedAt: Timestamp,
  ): Promise<StoredReturnRecord | undefined>;
};

export function hasUnresolvedReturnLookup(store: ReturnStore): store is ReturnStoreWithUnresolvedLookup {
  return typeof (store as Partial<ReturnStoreWithUnresolvedLookup>).getUnresolvedReturnForSale === "function";
}

export async function getUnresolvedReturnForSale(
  store: ReturnStore,
  organizationId: string,
  saleId: string,
  checkedAt: Timestamp,
): Promise<StoredReturnRecord | undefined> {
  if (!hasUnresolvedReturnLookup(store)) {
    return undefined;
  }
  return store.getUnresolvedReturnForSale(organizationId, saleId, checkedAt);
}

export function withSupabaseUnresolvedReturnLookup(
  store: ReturnStore,
  options: {
    readonly url: string;
    readonly serviceRoleKey: string;
    readonly fetchImpl: PosRestFetch;
    readonly timeoutMs?: number;
  },
): ReturnStoreWithUnresolvedLookup {
  const root = `${options.url.replace(/\/+$/, "")}/rest/v1`;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const headers = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    Accept: "application/json",
  };

  return {
    ...store,
    async getUnresolvedReturnForSale(organizationId, saleId, _checkedAt) {
      const statusFilter = UNRESOLVED_RETURN_STATUSES.join(",");
      const path =
        `pos_returns?organization_id=eq.${encodeURIComponent(organizationId)}`
        + `&sale_id=eq.${encodeURIComponent(saleId)}`
        + `&status=in.(${statusFilter})`
        + "&select=return_id&order=updated_at.desc,created_at.desc&limit=1";
      const response = await options.fetchImpl(`${root}/${path}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.status || response.status >= 400) {
        throw new Error("durable return discovery is unavailable");
      }
      const body = (await response.json()) as unknown;
      if (!Array.isArray(body) || body.length === 0) {
        return undefined;
      }
      const first = body[0];
      const returnId =
        first && typeof first === "object" && typeof (first as { return_id?: unknown }).return_id === "string"
          ? (first as { return_id: string }).return_id
          : undefined;
      if (!returnId) {
        return undefined;
      }
      return store.getReturn(returnId);
    },
  };
}
