import type { PosSaleRecord } from "../../core/checkout/types";
import type { StoredReturnRecord } from "../../core/returns/types";

export type HistoricReturnSaleLineProjection = {
  readonly orderLineId: string;
  readonly name: string;
  readonly originalSoldQuantity: string;
};

export type ExistingReturnLineProjection = {
  readonly orderLineId: string;
  readonly name: string;
  readonly originalSoldQuantity: string;
  readonly quantity: string;
  readonly reason: string;
  readonly condition: StoredReturnRecord["requestedLines"][number]["condition"];
  readonly intendedDisposition: StoredReturnRecord["requestedLines"][number]["intendedDisposition"];
  readonly dispositionPolicy: StoredReturnRecord["requestedLines"][number]["dispositionPolicy"];
  readonly remainingReturnableQuantity: string;
};

export type ExistingReturnProjection = {
  readonly returnId: string;
  readonly status: "refund_pending" | "in_progress" | "requires_attention";
  readonly refundTotal: { readonly minor: number; readonly currency: string };
  readonly lines: readonly ExistingReturnLineProjection[];
};

export type HistoricReturnSaleProjection = {
  readonly saleId: string;
  readonly orderReference: string;
  readonly currency: string;
  readonly lines: readonly HistoricReturnSaleLineProjection[];
  readonly customerLabel?: string;
  readonly createdAt?: string;
  readonly total?: { readonly minor: number; readonly currency: string };
  readonly itemSummary?: string;
  readonly existingReturn?: ExistingReturnProjection;
};

/**
 * Read-only BFF projection for FE-06 historic sale lookup.
 * Identity comes only from durable `orderLines[].orderLineId`.
 * Receipt/display lines may supply a name, never an identity.
 */
export function projectHistoricReturnSale(
  sale: PosSaleRecord,
  existingReturn?: StoredReturnRecord,
): HistoricReturnSaleProjection | undefined {
  if (sale.status !== "completed") {
    return undefined;
  }
  const orderLines = sale.orderLines;
  if (!orderLines || orderLines.length === 0) {
    return undefined;
  }
  const namesAligned = sale.lines.length === orderLines.length;
  const lines = orderLines.map((line, index) => ({
    orderLineId: line.orderLineId,
    name:
      namesAligned && sale.lines[index]?.name
        ? sale.lines[index].name
        : `Sale line ${line.orderLineId}`,
    originalSoldQuantity: line.quantity,
  }));
  const first = lines[0];
  const unresolved = projectExistingReturn(existingReturn, lines);
  return {
    saleId: sale.prepared.saleId,
    orderReference: sale.prepared.orderReference || sale.prepared.saleId,
    currency: sale.prepared.total.currency,
    lines,
    customerLabel: sale.customerLabel,
    createdAt: sale.receipt?.issuedAt ?? sale.prepared.preparedAt,
    total: sale.receipt?.total ?? sale.prepared.total,
    itemSummary: first
      ? lines.length === 1
        ? `${first.originalSoldQuantity} × ${first.name}`
        : `${first.originalSoldQuantity} × ${first.name} · ${lines.length - 1} more`
      : undefined,
    ...(unresolved ? { existingReturn: unresolved } : {}),
  };
}

function projectExistingReturn(
  record: StoredReturnRecord | undefined,
  saleLines: readonly HistoricReturnSaleLineProjection[],
): ExistingReturnProjection | undefined {
  if (
    !record ||
    (record.status !== "refund_pending" && record.status !== "in_progress" && record.status !== "requires_attention")
  ) {
    return undefined;
  }
  return {
    returnId: record.returnId,
    status: record.status,
    refundTotal: { ...record.refundTotal },
    lines: record.requestedLines.map((line) => {
      const sold = saleLines.find((candidate) => candidate.orderLineId === line.orderLineId);
      return {
        orderLineId: line.orderLineId,
        name: sold?.name ?? `Sale line ${line.orderLineId}`,
        originalSoldQuantity: sold?.originalSoldQuantity ?? line.quantity,
        quantity: line.quantity,
        reason: line.reason,
        condition: line.condition,
        intendedDisposition: line.intendedDisposition,
        dispositionPolicy: line.dispositionPolicy,
        remainingReturnableQuantity: line.remainingReturnableQuantity,
      };
    }),
  };
}
