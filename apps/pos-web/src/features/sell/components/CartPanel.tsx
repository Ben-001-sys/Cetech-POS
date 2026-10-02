"use client";

import { useState, type KeyboardEvent } from "react";
import { commitQuantityDraft, holdQuantityDraft, restoreQuantityDraft } from "../state/quantityDraft";
import { skuLabel } from "../../../ui/cashier-language";
import {
  describePayButton,
  formatMoneyDisplay,
  quoteSnapshotAmountRows,
  type CheckoutEligibilityView,
  type QuoteDisplayState,
  type QuotePresentationLine,
} from "../state/quotePresentation";
import type { CartLineView, CustomerSearchResultView } from "../state/sellView";
import { CartTotals } from "./CartTotals";
import { QuoteStatus } from "./QuoteStatus";

export function CartLineRow({
  line,
  quotedLine,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onRemove,
}: {
  line: CartLineView;
  quotedLine?: QuotePresentationLine;
  onIncrement: (lineId: string) => void;
  onDecrement: (lineId: string) => void;
  onQuantityChange: (lineId: string, quantity: string) => void;
  onRemove: (lineId: string) => void;
}) {
  const [draft, setDraft] = useState(line.quantity);
  const [error, setError] = useState<string | null>(null);
  const [seenQuantity, setSeenQuantity] = useState(line.quantity);
  if (line.quantity !== seenQuantity) {
    setSeenQuantity(line.quantity);
    setDraft(line.quantity);
    setError(null);
  }

  function commit() {
    const result = commitQuantityDraft(draft, line.quantity);
    if (result.kind === "invalid") {
      setError(result.message);
      return;
    }
    setDraft(result.quantity);
    setError(null);
    if (result.kind === "commit") {
      onQuantityChange(line.lineId, result.quantity);
    }
  }

  function onDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(restoreQuantityDraft(line.quantity));
      setError(null);
    }
  }

  const errorId = `qty-error-${line.lineId}`;

  return (
    <article className="cart-line">
      <div className="cart-line-title">
        <div>
          <div className="cart-line-name">{line.name}</div>
          {line.variationLabel ? <div className="muted cart-line-variation">{line.variationLabel}</div> : null}
          {skuLabel(line.sku) ? <div className="muted cart-line-sku">{skuLabel(line.sku)}</div> : null}
        </div>
        {quotedLine ? <div className="cart-line-price">{formatMoneyDisplay(quotedLine.total)}</div> : null}
      </div>
      <div className="qty-row">
        <div className="qty-control">
          <button type="button" className="btn" aria-label="Decrease quantity" onClick={() => onDecrement(line.lineId)}>
            −
          </button>
          <label className="sr-only" htmlFor={`qty-${line.lineId}`}>
            Quantity
          </label>
          <input
            id={`qty-${line.lineId}`}
            className="qty-input"
            inputMode="decimal"
            value={draft}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setDraft(holdQuantityDraft(event.target.value));
              setError(null);
            }}
            onBlur={commit}
            onKeyDown={onDraftKeyDown}
          />
          <button type="button" className="btn" aria-label="Increase quantity" onClick={() => onIncrement(line.lineId)}>
            +
          </button>
        </div>
        {quotedLine ? <div className="cart-line-unit muted">{formatMoneyDisplay(quotedLine.unitPrice)} each</div> : null}
        <button type="button" className="btn cart-line-remove" onClick={() => onRemove(line.lineId)}>
          Remove
        </button>
      </div>
      {error ? (
        <div id={errorId} className="qty-error" role="alert">
          {error}
        </div>
      ) : null}
    </article>
  );
}

function CustomerChipLabel({ customer }: { customer: CustomerSearchResultView | null }) {
  if (!customer) return <span className="customer-name">Walk-in</span>;
  return (
    <span>
      <span className="customer-name">{customer.displayName}</span>
      {customer.kind === "b2b" ? (
        <>
          <br />
          <span className="sell-context-badge">Wholesale</span>
        </>
      ) : null}
    </span>
  );
}

export function CartPanel({
  revision,
  lines,
  customer,
  mobileOpen,
  onOpenCustomers,
  onClear,
  onIncrement,
  onDecrement,
  onQuantityChange,
  onRemove,
  onCloseMobile,
  quote,
  eligibility,
  checkoutReady = false,
  checkoutInFlight = false,
  clearDisabled = false,
  onPay,
  onRetryQuote,
}: {
  revision: number;
  lines: readonly CartLineView[];
  customer: CustomerSearchResultView | null;
  mobileOpen: boolean;
  onOpenCustomers: () => void;
  onClear: () => void;
  onIncrement: (lineId: string) => void;
  onDecrement: (lineId: string) => void;
  onQuantityChange: (lineId: string, quantity: string) => void;
  onRemove: (lineId: string) => void;
  onCloseMobile: () => void;
  quote?: QuoteDisplayState;
  eligibility?: CheckoutEligibilityView;
  checkoutReady?: boolean;
  checkoutInFlight?: boolean;
  clearDisabled?: boolean;
  onPay?: () => void;
  onRetryQuote?: () => void;
}) {
  const confirmedTotal = quote?.status === "confirmed" ? quote.quote.total : undefined;
  const quotedLines = quote?.status === "confirmed" ? quote.quote.lines : undefined;
  const totals = quote?.status === "confirmed" ? quoteSnapshotAmountRows(quote.quote) : undefined;
  const cartLineNames = lines.map((line) => line.name);
  const pay = describePayButton(eligibility, { checkoutReady, inFlight: checkoutInFlight, confirmedTotal });
  return (
    <aside className={mobileOpen ? "cart-panel mobile-open" : "cart-panel"} aria-label="Current sale" data-cart-revision={revision}>
      <div className="cart-head">
        <div className="cart-head-row">
          <div className="cart-title">
            <strong>Cart</strong>
          </div>
          <div className="cart-head-actions">
            <button type="button" className="btn cart-back" onClick={onCloseMobile}>
              Back
            </button>
            <button type="button" className="btn cart-clear" onClick={onClear} disabled={clearDisabled}>
              Clear
            </button>
          </div>
        </div>
        <button type="button" className="customer-chip" onClick={onOpenCustomers}>
          <span>
            <span className="eyebrow">Customer</span>
            <br />
            <CustomerChipLabel customer={customer} />
          </span>
          <span aria-hidden="true">›</span>
        </button>
        {quote ? (
          <QuoteStatus quote={quote} cartLineNames={cartLineNames} onRetry={onRetryQuote} />
        ) : (
          <div className="quote-status muted" role="status">
            {lines.length === 0
              ? "Prices will be ready after an item is added."
              : "Price needs to be checked again."}
          </div>
        )}
      </div>
      <div className="cart-lines">
        {lines.length === 0 ? (
          <div className="empty-cart">
            <strong>Your cart is empty</strong>
            <div>Add a product to start this sale.</div>
          </div>
        ) : (
          lines.map((line) => (
            <CartLineRow
              key={line.lineId}
              line={line}
              quotedLine={quotedLines?.find((quoted) => quoted.lineId === line.lineId)}
              onIncrement={onIncrement}
              onDecrement={onDecrement}
              onQuantityChange={onQuantityChange}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
      <div className="cart-footer">
        {totals ? <CartTotals rows={totals} /> : null}
        <button
          className="btn primary block pay-btn"
          type="button"
          disabled={pay.disabled}
          onClick={() => {
            if (pay.disabled) return;
            onPay?.();
          }}
        >
          {pay.label}
        </button>
        {eligibility ? (
          <div
            className="muted pay-reason"
            data-eligibility-allowed={pay.eligibilityAllowed ? "true" : "false"}
            data-eligibility-reason={pay.eligibilityReason}
          >
            {pay.reason}
          </div>
        ) : (
          <div className="muted pay-reason">Checkout is unavailable until the price is ready.</div>
        )}
      </div>
    </aside>
  );
}
