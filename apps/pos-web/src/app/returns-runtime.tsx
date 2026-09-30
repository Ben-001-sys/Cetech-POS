"use client";

import { useEffect, useMemo } from "react";
import { ReturnsScreen, useReturnFlow, type HistoricSaleLookup } from "../features/returns";
import type { ExistingReturnView, HistoricReturnSaleWithExisting } from "../features/returns/existingReturn";
import type { HistoricReturnSaleView } from "../features/returns/returnView";
import type { ReturnPort } from "../../../../docs/contracts/ports";
import { createBrowserReturnPort } from "./checkout-client";
import { fetchOrderHistory } from "./operational-client";

export function ReturnsRuntimeScreen({
  returns,
  lookup,
  initialSaleId,
  onSaleSelected,
}: {
  readonly returns: ReturnPort;
  readonly lookup?: HistoricSaleLookup;
  readonly initialSaleId?: string | null;
  readonly onSaleSelected?: (saleId: string) => void;
}) {
  const flow = useReturnFlow(useMemo(() => ({ returns }), [returns]));

  useEffect(() => {
    if (!initialSaleId || !lookup || !flow.controller) {
      return;
    }
    void lookup.search(initialSaleId).then((matches) => {
      const sale = matches.find((row) => row.saleId === initialSaleId || row.orderReference === initialSaleId);
      if (sale) {
        void flow.controller?.selectSale(sale);
      }
    });
  }, [flow.controller, initialSaleId, lookup]);

  if (!flow.ready || !flow.controller) {
    return <p className="muted">Loading returns…</p>;
  }
  return (
    <ReturnsScreen
      session={flow.session}
      inFlight={flow.inFlight}
      lookup={lookup}
      onSelectSale={(sale) => {
        void flow.controller?.selectSale(sale);
        onSaleSelected?.(sale.saleId);
      }}
      onUpdateLine={(orderLineId, patch) => flow.controller?.updateLine(orderLineId, patch)}
      onPreview={() => {
        void flow.controller?.preview();
      }}
      onExecute={() => {
        void flow.controller?.execute();
      }}
      onResolve={() => {
        void flow.controller?.resolve();
      }}
    />
  );
}

export function createProductionReturnRuntime(options?: { readonly fetchImpl?: typeof fetch }): {
  readonly returns: ReturnPort;
  readonly lookup: HistoricSaleLookup;
} {
  const returns = createBrowserReturnPort({ fetchImpl: options?.fetchImpl });
  return {
    returns,
    lookup: createBrowserHistoricReturnSaleLookup({ fetchImpl: options?.fetchImpl }),
  };
}

export function createBrowserHistoricReturnSaleLookup(
  options: { readonly fetchImpl?: typeof fetch } = {},
): HistoricSaleLookup {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async search(query: string) {
      const trimmed = query.trim();
      if (trimmed) {
        const exact = await fetchHistoricByKey(fetchImpl, trimmed);
        if (exact.length > 0) {
          return exact;
        }
      }
      const list = await fetchOrderHistory(trimmed, fetchImpl);
      if (!list.ok) {
        return [];
      }
      return list.data.items.flatMap((item) => {
        if (item.status !== "completed") {
          return [];
        }
        const lines = (item.lines ?? []).map((line) => ({
          orderLineId: line.id,
          name: line.name,
          originalSoldQuantity: line.quantity,
        }));
        if (lines.length === 0) {
          return [];
        }
        const view: HistoricReturnSaleWithExisting = {
          saleId: item.saleId ?? item.id,
          orderReference: item.orderReference,
          currency: item.total.currency,
          customerLabel: item.customerLabel,
          createdAt: item.createdAt,
          total: item.total,
          itemSummary: item.itemSummary,
          lines,
        };
        return [view];
      });
    },
  };
}

async function fetchHistoricByKey(
  fetchImpl: typeof fetch,
  saleKey: string,
): Promise<readonly HistoricReturnSaleWithExisting[]> {
  const response = await fetchImpl(`/api/pos/v1/returns/history/${encodeURIComponent(saleKey)}`, {
    method: "GET",
    credentials: "include",
    headers: {
      "x-correlation-id": crypto.randomUUID(),
      "x-csrf-token": readCookie("cetech_pos_csrf") ?? "",
    },
  });
  if (!response.ok) {
    if (response.status === 404) {
      return [];
    }
    throw new Error("Existing return status could not be checked. Try again before starting a return.");
  }
  const json = (await response.json()) as {
    readonly ok?: boolean;
    readonly data?: {
      readonly saleId?: string;
      readonly orderReference?: string;
      readonly currency?: string;
      readonly customerLabel?: string;
      readonly createdAt?: string;
      readonly total?: { readonly minor?: number; readonly currency?: string };
      readonly itemSummary?: string;
      readonly lines?: ReadonlyArray<{
        readonly orderLineId?: string;
        readonly name?: string;
        readonly originalSoldQuantity?: string;
      }>;
      readonly existingReturn?: {
        readonly returnId?: string;
        readonly status?: ExistingReturnView["status"];
        readonly refundTotal?: { readonly minor?: number; readonly currency?: string };
        readonly lines?: ReadonlyArray<{
          readonly orderLineId?: string;
          readonly name?: string;
          readonly originalSoldQuantity?: string;
          readonly quantity?: string;
          readonly reason?: string;
          readonly condition?: ExistingReturnView["lines"][number]["condition"];
          readonly intendedDisposition?: ExistingReturnView["lines"][number]["intendedDisposition"];
          readonly dispositionPolicy?: ExistingReturnView["lines"][number]["dispositionPolicy"];
          readonly remainingReturnableQuantity?: string;
        }>;
      };
    };
  };
  if (!json.ok || !json.data?.saleId || !json.data.lines || json.data.lines.length === 0) {
    return [];
  }
  const lines = json.data.lines.flatMap((line) => {
    if (!line.orderLineId || line.orderLineId.includes(":receipt:") || !line.originalSoldQuantity) {
      return [];
    }
    return [
      {
        orderLineId: line.orderLineId,
        name: line.name || `Sale line ${line.orderLineId}`,
        originalSoldQuantity: line.originalSoldQuantity,
      },
    ];
  });
  if (lines.length === 0) {
    return [];
  }
  const existingReturn = parseExistingReturn(json.data.existingReturn);
  const view: HistoricReturnSaleView = {
    saleId: json.data.saleId,
    orderReference: json.data.orderReference ?? json.data.saleId,
    currency: json.data.currency ?? "GHS",
    customerLabel: json.data.customerLabel,
    createdAt: json.data.createdAt,
    total:
      json.data.total && typeof json.data.total.minor === "number" && typeof json.data.total.currency === "string"
        ? { minor: json.data.total.minor, currency: json.data.total.currency }
        : undefined,
    itemSummary: json.data.itemSummary,
    lines,
  };
  return [{ ...view, ...(existingReturn ? { existingReturn } : {}) }];
}

function parseExistingReturn(
  input:
    | {
        readonly returnId?: string;
        readonly status?: ExistingReturnView["status"];
        readonly refundTotal?: { readonly minor?: number; readonly currency?: string };
        readonly lines?: ReadonlyArray<{
          readonly orderLineId?: string;
          readonly name?: string;
          readonly originalSoldQuantity?: string;
          readonly quantity?: string;
          readonly reason?: string;
          readonly condition?: ExistingReturnView["lines"][number]["condition"];
          readonly intendedDisposition?: ExistingReturnView["lines"][number]["intendedDisposition"];
          readonly dispositionPolicy?: ExistingReturnView["lines"][number]["dispositionPolicy"];
          readonly remainingReturnableQuantity?: string;
        }>;
      }
    | undefined,
): ExistingReturnView | undefined {
  if (!input) {
    return undefined;
  }
  if (
    !input.returnId ||
    (input.status !== "refund_pending" && input.status !== "in_progress" && input.status !== "requires_attention") ||
    typeof input.refundTotal?.minor !== "number" ||
    typeof input.refundTotal.currency !== "string" ||
    !input.lines
  ) {
    throw new Error("Existing return details are incomplete. Do not start another return.");
  }
  const lines = input.lines.flatMap((line) => {
    if (
      !line.orderLineId ||
      !line.originalSoldQuantity ||
      !line.quantity ||
      !line.reason ||
      !line.condition ||
      !line.intendedDisposition ||
      !line.dispositionPolicy ||
      !line.remainingReturnableQuantity
    ) {
      return [];
    }
    return [{
      orderLineId: line.orderLineId,
      name: line.name || `Sale line ${line.orderLineId}`,
      originalSoldQuantity: line.originalSoldQuantity,
      quantity: line.quantity,
      reason: line.reason,
      condition: line.condition,
      intendedDisposition: line.intendedDisposition,
      dispositionPolicy: line.dispositionPolicy,
      remainingReturnableQuantity: line.remainingReturnableQuantity,
    }];
  });
  if (lines.length !== input.lines.length) {
    throw new Error("Existing return details are incomplete. Do not start another return.");
  }
  return {
    returnId: input.returnId,
    status: input.status,
    refundTotal: { minor: input.refundTotal.minor, currency: input.refundTotal.currency },
    lines,
  };
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}
