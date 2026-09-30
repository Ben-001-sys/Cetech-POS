import type {
  DispositionPolicyView,
  HistoricReturnSaleView,
  ReturnConditionView,
  ReturnMoneyView,
  StockDispositionView,
} from "./returnView";

export type ExistingReturnStatusView = "refund_pending" | "in_progress" | "requires_attention";

export type ExistingReturnLineView = {
  readonly orderLineId: string;
  readonly name: string;
  readonly originalSoldQuantity: string;
  readonly quantity: string;
  readonly reason: string;
  readonly condition: ReturnConditionView;
  readonly intendedDisposition: StockDispositionView;
  readonly dispositionPolicy: DispositionPolicyView;
  readonly remainingReturnableQuantity: string;
};

export type ExistingReturnView = {
  readonly returnId: string;
  readonly status: ExistingReturnStatusView;
  readonly refundTotal: ReturnMoneyView;
  readonly lines: readonly ExistingReturnLineView[];
};

export type HistoricReturnSaleWithExisting = HistoricReturnSaleView & {
  readonly existingReturn?: ExistingReturnView;
};
