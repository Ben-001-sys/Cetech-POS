export { createReturnController, type ReturnController, type ReturnControllerPorts, type ReturnApprovalBindingView } from "./returnController";
export { ReturnFlow } from "./ReturnFlow";
export { ReturnsScreen, type HistoricSaleLookup } from "./ReturnsScreen";
export { useReturnFlow } from "./useReturnFlow";
export type {
  ExistingReturnLineView,
  ExistingReturnStatusView,
  ExistingReturnView,
  HistoricReturnSaleWithExisting,
} from "./existingReturn";
export {
  NEVER_AUTOMATIC_SELLABLE,
  canPresentReturnComplete,
  conditionLabel,
  conditionRestockNotice,
  describeReturnStage,
  dispositionLabel,
  dispositionPolicyLabel,
  idleReturnSession,
  OUTSTANDING_RETURN_COPY,
  presentsAutomaticSellableRestock,
  returnIdentityLocked,
  unresolvedEffectLabels,
  type HistoricReturnSaleView,
  type ReturnConditionView,
  type ReturnSessionView,
} from "./returnView";

export const RETURN_STYLESHEETS = ["@/features/returns/returns.css"] as const;
