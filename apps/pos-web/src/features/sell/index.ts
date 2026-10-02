export { SellScreen, type SellScreenProps } from "./SellScreen";
export { SellLoadingSkeleton, SellRuntimeScreen, type SellSessionPorts } from "./runtime/SellRuntimeScreen";
export { createBrowserPricingPort } from "./runtime/pricingClient";
export { isCashCheckoutReady, type CashCheckoutPorts, type CashCheckoutScope } from "./runtime/cashCheckoutController";
export { checkoutEligibilityFromQuote } from "./runtime/checkoutEligibility";
export { applyQuoteStateForRevision } from "./runtime/quoteRequest";
export { CartPanel } from "./components/CartPanel";
export { QuoteStatus } from "./components/QuoteStatus";
export {
  describePayButton,
  describeQuoteDisplay,
  formatMoneyDisplay,
  quoteSnapshotAmountRows,
  CHECKOUT_ELIGIBILITY_REASONS,
  INTEGRATION_UNAVAILABLE,
  type QuoteDisplayState,
  type QuotePresentationSnapshot,
  type CheckoutEligibilityView,
  type CheckoutEligibilityReasonView,
} from "./state/quotePresentation";
export {
  alignQuoteToCartRevision,
  applyQuoteResultForRevision,
  resolveQuotePresentation,
} from "./state/quoteRevision";
export { productBadges, productStockCopy } from "./state/productPresentation";
export { ProductBadge, ProductBadgeList } from "./components/ProductBadge";
export { CartTotals } from "./components/CartTotals";
export { ProductSearch, ProductCard, ProductResults } from "./components/ProductSearch";
export { VariationDialog } from "./components/VariationDialog";
export { BarcodeCollisionDialog } from "./components/BarcodeCollisionDialog";
export { CustomerPicker } from "./components/CustomerPicker";
export { CatalogStatusBanners, catalogAvailabilityCopy } from "./components/CatalogStatus";
export {
  type SellProductView,
  type CartLineView,
  type CustomerSearchResultView,
  type CatalogSearchState,
  type DraftStatusView,
  type CatalogAvailability,
  type BarcodeNotice,
  type SellWorkspaceState,
  type SellableKind,
  type StockPresentation,
} from "./state/sellView";
export {
  createSellWorkspace,
  applySearchQuery,
  applyCatalogSearchResults,
  applyVisibleSearchResults,
  applyNameSearch,
  applyBarcodeScan,
  applyProductSelect,
  applyVariationSelect,
  applyVariationChooser,
  applyQuantityChange,
  applyRemoveLine,
  applySelectCustomer,
  applyClearCustomer,
  applyNewSale,
  applyCatalogAvailability,
  applyDraftStatus,
  catalogMutationAllowed,
  type SellWorkspaceDeps,
} from "./state/sellWorkspace";
export { resolveBarcode, childrenOf, isDigitBarcodeQuery } from "./state/barcodeResolution";
export { addOrIncrementLine, setLineQuantity, removeLine, emptyCart } from "./state/cartState";
export { addQuantity, incrementQuantity, decrementQuantity, parseQuantityInput } from "./state/quantity";
export { commitQuantityDraft, holdQuantityDraft } from "./state/quantityDraft";
export { appendBarcodeKey, createBarcodeBuffer } from "./state/barcodeBuffer";

/** Stylesheet WS3 should import from `src/app` layout when mounting Sell. FE-03 does not own route files. */
export const SELL_STYLESHEETS = ["@/features/sell/sell.css"] as const;
