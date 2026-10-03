import type { Money } from "../../../../../docs/contracts/domain.generated";
import type { PosRestFetch } from "../http/server-fetch";

/**
 * Read-only Management view over persisted return, refund, and return-operation
 * state. It does not execute a return, bind an approval, refund a payment, or
 * restock. Status labels follow stored R8 states. Approved/Rejected are not
 * invented.
 *
 * Active and unresolved rows are preferred. A small set of completed returns
 * is included as informational context. The combined result is capped.
 */
export const MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT = 40;
const ACTIVE_RETURN_LIMIT = 30;
const COMPLETED_RETURN_LIMIT = 8;
const REFUND_LIMIT = 20;
const EFFECT_LIMIT = 15;
const OPERATION_LIMIT = 20;

const RETURN_OPERATIONS = [
  "return.execute",
  "return.resolve",
  "payment.refund",
  "refund.resolve",
  "bridge.commercial_refund",
  "bridge.stock_disposition",
] as const;

export const MANAGEMENT_RETURNS_ATTENTION_CATEGORIES = [
  "return",
  "refund_reconciliation",
  "commercial_refund",
  "stock_disposition",
  "return_operation",
] as const;

export type ManagementReturnsAttentionCategory =
  (typeof MANAGEMENT_RETURNS_ATTENTION_CATEGORIES)[number];

export const MANAGEMENT_RETURNS_ATTENTION_PRIORITIES = [
  "needs_attention",
  "awaiting_reconciliation",
  "pending",
  "informational",
] as const;

export type ManagementReturnsAttentionPriority =
  (typeof MANAGEMENT_RETURNS_ATTENTION_PRIORITIES)[number];

export type ManagementReturnsAttentionIntervention = "required" | "blocked" | "informational";

export type ManagementReturnsAttentionScope =
  | { readonly kind: "organization" }
  | { readonly kind: "locations"; readonly locationIds: readonly string[] };

export type ManagementReturnsAttentionItem = {
  readonly id: string;
  readonly category: ManagementReturnsAttentionCategory;
  readonly priority: ManagementReturnsAttentionPriority;
  readonly intervention: ManagementReturnsAttentionIntervention;
  readonly organizationId: string;
  readonly locationId: string;
  readonly locationName?: string;
  readonly registerId?: string;
  readonly registerName?: string;
  readonly returnId?: string;
  readonly transactionId?: string;
  readonly saleId?: string;
  readonly refundId?: string;
  readonly operationLabel?: string;
  readonly persistedStatus: string;
  /** Present only for stored approval_required returns. Does not change pos_returns.status. */
  readonly approvalState?: "required" | "recorded";
  readonly previewExpiresAt?: string;
  readonly previewState?: "current" | "expired" | "unavailable";
  readonly canApprove?: boolean;
  readonly canReconcile?: boolean;
  readonly canReview?: boolean;
  readonly actionUnavailableReason?: string;
  readonly reviewUnavailableReason?: string;
  readonly statusLabel: string;
  readonly summary: string;
  readonly nextAction: string;
  readonly amount?: Money;
  readonly updatedAt: string;
};

export type ManagementReturnsAttentionListing = {
  readonly rows: readonly ManagementReturnsAttentionItem[];
  readonly truncated: boolean;
};

export type ManagementReturnsAttentionView = {
  readonly scope: ManagementReturnsAttentionScope;
  readonly limit: number;
  readonly truncated: boolean;
  readonly rows: readonly ManagementReturnsAttentionItem[];
};

export interface ManagementReturnsAttentionDirectory {
  listOrganization(input: {
    readonly organizationId: string;
    readonly locationIds?: readonly string[];
  }): Promise<ManagementReturnsAttentionListing | "unavailable">;
}

const PRIORITY_RANK: Record<ManagementReturnsAttentionPriority, number> = {
  needs_attention: 0,
  awaiting_reconciliation: 1,
  pending: 2,
  informational: 3,
};

type Copy = {
  readonly priority: ManagementReturnsAttentionPriority;
  readonly intervention: ManagementReturnsAttentionIntervention;
  readonly statusLabel: string;
  readonly summary: string;
  readonly nextAction: string;
};

export function describeManagementReturnsAttention(input: {
  readonly category: ManagementReturnsAttentionCategory;
  readonly persistedStatus: string;
  readonly operation?: string;
}): Copy | undefined {
  if (input.category === "return") return describeReturn(input.persistedStatus);
  if (input.category === "refund_reconciliation") return describeTenderRefund(input.persistedStatus);
  if (input.category === "commercial_refund") return describeEffect("Commercial refund", input.persistedStatus);
  if (input.category === "stock_disposition") return describeEffect("Stock update", input.persistedStatus);
  if (input.category === "return_operation") return describeOperation(input.persistedStatus, input.operation);
  return undefined;
}

export function compareManagementReturnsAttention(
  left: ManagementReturnsAttentionItem,
  right: ManagementReturnsAttentionItem,
): number {
  const rank = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
  if (rank !== 0) return rank;
  const time = right.updatedAt.localeCompare(left.updatedAt);
  if (time !== 0) return time;
  return left.id.localeCompare(right.id);
}

export function selectManagementReturnsAttention(input: {
  readonly rows: readonly ManagementReturnsAttentionItem[];
  readonly organizationId: string;
  readonly locationIds?: readonly string[];
  readonly limit?: number;
}): ManagementReturnsAttentionListing {
  const limit = input.limit ?? MANAGEMENT_RETURNS_ATTENTION_RESULT_LIMIT;
  const allowed = input.locationIds ? new Set(input.locationIds) : null;
  const filtered = input.rows.filter((row) => {
    if (row.organizationId !== input.organizationId) return false;
    if (allowed && !allowed.has(row.locationId)) return false;
    return true;
  });
  const sorted = [...filtered].sort(compareManagementReturnsAttention);
  return {
    rows: sorted.slice(0, limit),
    truncated: sorted.length > limit,
  };
}

export function createMemoryManagementReturnsAttentionDirectory(
  rows: readonly ManagementReturnsAttentionItem[] = [],
): ManagementReturnsAttentionDirectory {
  return {
    async listOrganization(input) {
      return selectManagementReturnsAttention({
        rows,
        organizationId: input.organizationId,
        locationIds: input.locationIds,
      });
    },
  };
}

export function createSupabaseManagementReturnsAttentionDirectory(input: {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
  readonly timeoutMs?: number;
}): ManagementReturnsAttentionDirectory {
  const root = `${input.url.replace(/\/+$/, "")}/rest/v1`;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const headers = {
    apikey: input.serviceRoleKey,
    Authorization: `Bearer ${input.serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function get(path: string): Promise<unknown | "unavailable"> {
    try {
      const response = await input.fetchImpl(`${root}/${path}`, {
        method: "GET",
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return "unavailable";
      return await response.json();
    } catch {
      return "unavailable";
    }
  }

  return {
    async listOrganization({ organizationId, locationIds }) {
      if (locationIds && locationIds.length === 0) {
        return { rows: [], truncated: false };
      }
      const org = `organization_id=eq.${encodeURIComponent(organizationId)}`;
      const locationFilter = locationIds?.length
        ? `&location_id=in.(${locationIds.map((id) => encodeURIComponent(id)).join(",")})`
        : "";
      const operations = RETURN_OPERATIONS.map((operation) => encodeURIComponent(operation)).join(",");
      const expiresAfter = encodeURIComponent(new Date().toISOString());
      const [locationsBody, registersBody, activeReturns, completedReturns, refunds, commercial, stock, operationsBody, approvalsBody] =
        await Promise.all([
          get(`pos_locations?${org}&select=id,name`),
          get(`pos_registers?${org}&select=id,name`),
          get(`pos_returns?${org}${locationFilter}&status=in.(requires_attention,approval_required,refund_pending,in_progress,previewed)&select=${RETURN_SELECT}&order=updated_at.desc&limit=${ACTIVE_RETURN_LIMIT + 1}`),
          get(`pos_returns?${org}${locationFilter}&status=eq.completed&select=${RETURN_SELECT}&order=updated_at.desc&limit=${COMPLETED_RETURN_LIMIT + 1}`),
          get(`pos_tender_refunds?${org}${locationFilter}&status=in.(requires_attention,failed,pending)&select=${REFUND_SELECT}&order=updated_at.desc&limit=${REFUND_LIMIT + 1}`),
          get(`pos_commercial_refunds?${org}${locationFilter}&status=in.(requires_attention,pending,not_found)&select=${COMMERCIAL_SELECT}&order=updated_at.desc&limit=${EFFECT_LIMIT + 1}`),
          get(`pos_stock_dispositions?${org}${locationFilter}&status=in.(requires_attention,pending,not_found)&select=${STOCK_SELECT}&order=updated_at.desc&limit=${EFFECT_LIMIT + 1}`),
          get(`pos_pending_operations?${org}${locationFilter}&operation=in.(${operations})&status=in.(requires_attention,response_unknown,sent,pending)&select=${OPERATION_SELECT}&order=created_at.desc&limit=${OPERATION_LIMIT + 1}`),
          get(`pos_return_approvals?${org}${locationFilter}&expires_at=gt.${expiresAfter}&select=return_id,fingerprint,location_id`),
        ]);
      const bodies = [locationsBody, registersBody, activeReturns, completedReturns, refunds, commercial, stock, operationsBody, approvalsBody];
      if (bodies.some((body) => !Array.isArray(body))) return "unavailable";

      const locationNames = nameMap(locationsBody as readonly unknown[]);
      const registerNames = nameMap(registersBody as readonly unknown[]);
      const buckets = [
        bound(activeReturns as readonly unknown[], ACTIVE_RETURN_LIMIT),
        bound(completedReturns as readonly unknown[], COMPLETED_RETURN_LIMIT),
        bound(refunds as readonly unknown[], REFUND_LIMIT),
        bound(commercial as readonly unknown[], EFFECT_LIMIT),
        bound(stock as readonly unknown[], EFFECT_LIMIT),
        bound(operationsBody as readonly unknown[], OPERATION_LIMIT),
      ];
      const recordedApprovals = approvalIndex(approvalsBody as readonly unknown[]);
      const rows = [
        ...buckets[0]!.rows.flatMap((row) => normalizeReturn(row, locationNames, registerNames, recordedApprovals)),
        ...buckets[1]!.rows.flatMap((row) => normalizeReturn(row, locationNames, registerNames, recordedApprovals)),
        ...buckets[2]!.rows.flatMap((row) => normalizeRefund(row, locationNames)),
        ...buckets[3]!.rows.flatMap((row) => normalizeCommercial(row, locationNames)),
        ...buckets[4]!.rows.flatMap((row) => normalizeStock(row, locationNames)),
        ...buckets[5]!.rows.flatMap((row) => normalizeOperation(row, locationNames, registerNames)),
      ];
      const selected = selectManagementReturnsAttention({ rows, organizationId, locationIds });
      return {
        rows: selected.rows,
        truncated: selected.truncated || buckets.some((bucket) => bucket.truncated),
      };
    },
  };
}

const RETURN_SELECT = "return_id,organization_id,location_id,register_id,transaction_id,sale_id,status,fingerprint,preview_expires_at,refund_total_minor,refund_currency,updated_at";
const REFUND_SELECT = "refund_id,return_id,organization_id,location_id,transaction_id,status,amount_minor,currency,updated_at";
const COMMERCIAL_SELECT = "commercial_refund_id,return_id,organization_id,location_id,transaction_id,sale_id,status,amount_minor,currency,updated_at";
const STOCK_SELECT = "stock_disposition_id,return_id,organization_id,location_id,transaction_id,sale_id,status,updated_at";
const OPERATION_SELECT = "organization_id,location_id,register_id,transaction_id,operation,status,created_at,last_attempt_at";

function describeReturn(status: string): Copy | undefined {
  switch (status) {
    case "requires_attention":
      return {
        priority: "needs_attention",
        intervention: "required",
        statusLabel: "Return needs attention",
        summary: "This return needs review.",
        nextAction: "Review the existing return. Do not start a replacement return for the same sale.",
      };
    case "approval_required":
      return {
        priority: "pending",
        intervention: "required",
        statusLabel: "Approval required",
        summary: "Review the return amount, location, and register.",
        nextAction: "Approve return when you are the operational manager at this location.",
      };
    case "refund_pending":
      return {
        priority: "awaiting_reconciliation",
        intervention: "blocked",
        statusLabel: "Refund pending",
        summary: "The refund for this return is not finished.",
        nextAction: "Check the existing refund. Do not start another refund.",
      };
    case "in_progress":
      return {
        priority: "pending",
        intervention: "blocked",
        statusLabel: "Return in progress",
        summary: "This return is already in progress.",
        nextAction: "Wait for the existing return. Do not start another one.",
      };
    case "previewed":
      return {
        priority: "pending",
        intervention: "informational",
        statusLabel: "Return preview",
        summary: "A return preview exists and has not been executed.",
        nextAction: "This screen does not execute the preview.",
      };
    case "completed":
      return {
        priority: "informational",
        intervention: "informational",
        statusLabel: "Return completed",
        summary: "This return is completed.",
        nextAction: "No action is needed from this screen.",
      };
    default:
      return undefined;
  }
}

function describeTenderRefund(status: string): Copy | undefined {
  switch (status) {
    case "requires_attention":
      return {
        priority: "needs_attention",
        intervention: "required",
        statusLabel: "Refund needs review",
        summary: "This refund needs review before anyone refunds the customer again.",
        nextAction: "Use the existing refund reconciliation path. Do not create another refund here.",
      };
    case "failed":
      return {
        priority: "needs_attention",
        intervention: "required",
        statusLabel: "Refund failed",
        summary: "This refund failed and still needs review.",
        nextAction: "Do not start a second refund from this screen.",
      };
    case "pending":
      return {
        priority: "awaiting_reconciliation",
        intervention: "blocked",
        statusLabel: "Refund check needed",
        summary: "This refund is still pending.",
        nextAction: "Check the existing refund. Do not start another refund.",
      };
    default:
      return undefined;
  }
}

function describeEffect(kind: "Commercial refund" | "Stock update", status: string): Copy | undefined {
  if (status === "requires_attention") {
    return {
      priority: "needs_attention",
      intervention: "required",
      statusLabel: `${kind} needs attention`,
      summary: `${kind} is recorded separately from the customer return and the payment refund.`,
      nextAction: `Do not create another ${kind.toLowerCase()} from this screen.`,
    };
  }
  if (status === "pending") {
    return {
      priority: "awaiting_reconciliation",
      intervention: "blocked",
      statusLabel: `${kind} pending`,
      summary: `${kind} is still pending.`,
      nextAction: `Do not start another ${kind.toLowerCase()}.`,
    };
  }
  if (status === "not_found") {
    return {
      priority: "needs_attention",
      intervention: "required",
      statusLabel: `${kind} not found`,
      summary: `The ${kind.toLowerCase()} record was not found.`,
      nextAction: "Do not invent a replacement from this screen.",
    };
  }
  return undefined;
}

function describeOperation(status: string, operation: string | undefined): Copy | undefined {
  const label = operation ? operationLabel(operation) : undefined;
  if (!label) return undefined;
  if (status === "requires_attention") {
    return {
      priority: "needs_attention",
      intervention: "required",
      statusLabel: `${label} needs attention`,
      summary: "This return needs review. Do not start another return for this transaction.",
      nextAction: "Do not create a second payment, refund, or stock movement.",
    };
  }
  if (status === "response_unknown" || status === "sent" || status === "pending") {
    return {
      priority: "pending",
      intervention: "blocked",
      statusLabel: status === "response_unknown" ? `${label} result unknown` : `${label} in progress`,
      summary: status === "response_unknown"
        ? "The result of this return-related operation is unknown."
        : "This return-related operation is still in progress.",
      nextAction: "Do not create a second payment, refund, or stock movement.",
    };
  }
  return undefined;
}

function operationLabel(operation: string): string | undefined {
  switch (operation) {
    case "return.execute":
      return "Return execution";
    case "return.resolve":
      return "Return resolution";
    case "payment.refund":
      return "Payment refund";
    case "refund.resolve":
      return "Refund reconciliation";
    case "bridge.commercial_refund":
      return "Commercial refund";
    case "bridge.stock_disposition":
      return "Stock update";
    default:
      return undefined;
  }
}

function approvalIndex(rows: readonly unknown[]): ReadonlyMap<string, string> {
  const recorded = new Map<string, string>();
  for (const row of rows) {
    if (!record(row) || typeof row.return_id !== "string" || typeof row.fingerprint !== "string") continue;
    if (typeof row.location_id !== "string") continue;
    recorded.set(`${row.location_id}:${row.return_id}`, row.fingerprint);
  }
  return recorded;
}

function normalizeReturn(
  value: unknown,
  locationNames: ReadonlyMap<string, string>,
  registerNames: ReadonlyMap<string, string>,
  recordedApprovals: ReadonlyMap<string, string> = new Map(),
): readonly ManagementReturnsAttentionItem[] {
  if (!record(value) || typeof value.return_id !== "string" || typeof value.status !== "string") return [];
  const copy = describeManagementReturnsAttention({ category: "return", persistedStatus: value.status });
  const base = baseIdentity(value, locationNames, registerNames);
  const amount = money(value.refund_total_minor, value.refund_currency, false);
  if (!copy || !base || !amount || typeof value.transaction_id !== "string" || typeof value.sale_id !== "string") {
    return [];
  }
  const approvalFingerprint = recordedApprovals.get(`${base.locationId}:${value.return_id}`);
  const approvalRecorded = value.status === "approval_required"
    && typeof value.fingerprint === "string"
    && approvalFingerprint === value.fingerprint;
  const approvalCopy = approvalRecorded
    ? {
        ...copy,
        summary: "Manager approval recorded.",
        nextAction: "The cashier can continue the same return.",
      }
    : copy;
  return [{
    id: `return:${value.return_id}`,
    category: "return",
    ...approvalCopy,
    ...base,
    returnId: value.return_id,
    transactionId: value.transaction_id,
    saleId: value.sale_id,
    persistedStatus: value.status,
    ...(typeof value.preview_expires_at === "string" ? { previewExpiresAt: value.preview_expires_at } : {}),
    ...(value.status === "approval_required"
      ? { approvalState: approvalRecorded ? "recorded" as const : "required" as const }
      : {}),
    amount,
  }];
}

function normalizeRefund(
  value: unknown,
  locationNames: ReadonlyMap<string, string>,
): readonly ManagementReturnsAttentionItem[] {
  if (!record(value) || typeof value.refund_id !== "string" || typeof value.status !== "string") return [];
  const copy = describeManagementReturnsAttention({
    category: "refund_reconciliation",
    persistedStatus: value.status,
  });
  const base = baseIdentity(value, locationNames, new Map());
  const amount = money(value.amount_minor, value.currency, false);
  if (!copy || !base || !amount || amount.minor <= 0) return [];
  return [{
    id: `refund:${value.refund_id}`,
    category: "refund_reconciliation",
    ...copy,
    ...base,
    ...(typeof value.return_id === "string" ? { returnId: value.return_id } : {}),
    ...(typeof value.transaction_id === "string" ? { transactionId: value.transaction_id } : {}),
    refundId: value.refund_id,
    persistedStatus: value.status,
    amount,
  }];
}

function normalizeCommercial(
  value: unknown,
  locationNames: ReadonlyMap<string, string>,
): readonly ManagementReturnsAttentionItem[] {
  return normalizeEffect(value, "commercial_refund", "commercial_refund_id", locationNames);
}

function normalizeStock(
  value: unknown,
  locationNames: ReadonlyMap<string, string>,
): readonly ManagementReturnsAttentionItem[] {
  return normalizeEffect(value, "stock_disposition", "stock_disposition_id", locationNames);
}

function normalizeEffect(
  value: unknown,
  category: "commercial_refund" | "stock_disposition",
  idField: "commercial_refund_id" | "stock_disposition_id",
  locationNames: ReadonlyMap<string, string>,
): readonly ManagementReturnsAttentionItem[] {
  if (!record(value) || typeof value[idField] !== "string" || typeof value.status !== "string") return [];
  const copy = describeManagementReturnsAttention({ category, persistedStatus: value.status });
  const base = baseIdentity(value, locationNames, new Map());
  if (!copy || !base || typeof value.return_id !== "string") return [];
  const amount = category === "commercial_refund" ? money(value.amount_minor, value.currency, false) : undefined;
  if (category === "commercial_refund" && !amount) return [];
  return [{
    id: `${category}:${value[idField]}`,
    category,
    ...copy,
    ...base,
    returnId: value.return_id,
    ...(typeof value.transaction_id === "string" ? { transactionId: value.transaction_id } : {}),
    ...(typeof value.sale_id === "string" ? { saleId: value.sale_id } : {}),
    persistedStatus: value.status,
    ...(amount ? { amount } : {}),
  }];
}

function normalizeOperation(
  value: unknown,
  locationNames: ReadonlyMap<string, string>,
  registerNames: ReadonlyMap<string, string>,
): readonly ManagementReturnsAttentionItem[] {
  if (!record(value) || typeof value.operation !== "string" || typeof value.status !== "string") return [];
  const copy = describeManagementReturnsAttention({
    category: "return_operation",
    persistedStatus: value.status,
    operation: value.operation,
  });
  const updatedAt = typeof value.last_attempt_at === "string" && value.last_attempt_at.length > 0
    ? value.last_attempt_at
    : typeof value.created_at === "string"
      ? value.created_at
      : undefined;
  if (!copy || !updatedAt || typeof value.organization_id !== "string" || typeof value.location_id !== "string") {
    return [];
  }
  if (typeof value.transaction_id !== "string" || value.transaction_id.length === 0) return [];
  const locationName = locationNames.get(value.location_id);
  const registerId = typeof value.register_id === "string" && value.register_id.length > 0
    ? value.register_id
    : undefined;
  const registerName = registerId ? registerNames.get(registerId) : undefined;
  const label = operationLabel(value.operation);
  return [{
    id: `operation:${value.operation}:${value.transaction_id}`,
    category: "return_operation",
    ...copy,
    organizationId: value.organization_id,
    locationId: value.location_id,
    ...(locationName ? { locationName } : {}),
    ...(registerId ? { registerId } : {}),
    ...(registerName ? { registerName } : {}),
    transactionId: value.transaction_id,
    ...(label ? { operationLabel: label } : {}),
    persistedStatus: value.status,
    updatedAt,
  }];
}

function baseIdentity(
  value: Record<string, unknown>,
  locationNames: ReadonlyMap<string, string>,
  registerNames: ReadonlyMap<string, string>,
): Pick<
  ManagementReturnsAttentionItem,
  "organizationId" | "locationId" | "locationName" | "registerId" | "registerName" | "updatedAt"
> | undefined {
  if (
    typeof value.organization_id !== "string" ||
    typeof value.location_id !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    return undefined;
  }
  const locationName = locationNames.get(value.location_id);
  const registerId = typeof value.register_id === "string" && value.register_id.length > 0
    ? value.register_id
    : undefined;
  const registerName = registerId ? registerNames.get(registerId) : undefined;
  return {
    organizationId: value.organization_id,
    locationId: value.location_id,
    ...(locationName ? { locationName } : {}),
    ...(registerId ? { registerId } : {}),
    ...(registerName ? { registerName } : {}),
    updatedAt: value.updated_at,
  };
}

function nameMap(rows: readonly unknown[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (record(row) && typeof row.id === "string" && typeof row.name === "string" && row.name.trim()) {
      names.set(row.id, row.name);
    }
  }
  return names;
}

function bound(rows: readonly unknown[], limit: number): {
  readonly rows: readonly unknown[];
  readonly truncated: boolean;
} {
  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

function money(minorValue: unknown, currencyValue: unknown, signed: boolean): Money | undefined {
  const minor = integerMinor(minorValue);
  const currency = currencyCode(currencyValue);
  if (minor === undefined || !currency) return undefined;
  if (!signed && minor < 0) return undefined;
  return { minor, currency };
}

function integerMinor(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  return undefined;
}

function currencyCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const currency = value.trim();
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
