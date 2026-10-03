"use client";

import { useSyncExternalStore, type FormEvent } from "react";
import { skuLabel } from "../../../ui/cashier-language";
import { formatMoneyDisplay } from "../state/quotePresentation";
import { productBadges, productStockCopy, stockStatusClass } from "../state/productPresentation";
import { formatProductDisplayPrice } from "../state/variableDisplayPrice";
import type { SellProductView } from "../state/sellView";
import { ProductBadgeList } from "./ProductBadge";

const PRODUCT_VIEW_KEY = "cetech-pos-product-view";
const PRODUCT_VIEW_EVENT = "cetech-pos-product-view-change";
const DEFAULT_PRODUCT_VIEW = "grid:comfortable";
let temporaryProductView = DEFAULT_PRODUCT_VIEW;

function readProductView() {
  try {
    const saved = window.localStorage.getItem(PRODUCT_VIEW_KEY);
    return /^(grid|list):(comfortable|compact)$/.test(saved ?? "") ? saved! : temporaryProductView;
  } catch {
    return temporaryProductView;
  }
}

function subscribeProductView(onChange: () => void) {
  window.addEventListener(PRODUCT_VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(PRODUCT_VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function saveProductView(view: string) {
  temporaryProductView = view;
  try {
    window.localStorage.setItem(PRODUCT_VIEW_KEY, view);
  } catch {
    // A display preference remains usable when browser storage is unavailable.
  }
  window.dispatchEvent(new Event(PRODUCT_VIEW_EVENT));
}

export function ProductSearch({
  query,
  onQueryChange,
  onSearchSubmit,
}: {
  query: string;
  onQueryChange: (query: string) => void;
  onSearchSubmit: (query: string) => void;
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSearchSubmit(query);
  }

  return (
    <form className="product-toolbar" onSubmit={handleSubmit}>
      <div className="search-box">
        <span className="search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
          </svg>
        </span>
        <label className="sr-only" htmlFor="product-search">
          Barcode, SKU or product name
        </label>
        <input
          className="input"
          id="product-search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Scan barcode or search products, SKU…"
          autoComplete="off"
          inputMode="text"
          spellCheck={false}
        />
      </div>
      <button
        className="btn desktop-only"
        type="button"
        title="Shortcut: F2 / Ctrl+K"
        onClick={() => document.getElementById("product-search")?.focus()}
      >
        F2 Search
      </button>
    </form>
  );
}

export function ProductCard({
  item,
  onSelect,
}: {
  item: SellProductView;
  onSelect: (item: SellProductView) => void;
}) {
  const out = item.stockStatus === "out_of_stock";
  const stock = productStockCopy(item);
  // Stock has its own labelled row; avoid repeating it as a second badge.
  const badges = productBadges(item).filter((badge) => badge.id === "variable");
  const priceView = item.priceView ?? (item.displayPrice ? { kind: "single" as const, amount: item.displayPrice } : undefined);
  const price = formatProductDisplayPrice(priceView, formatMoneyDisplay, {
    treatMissingAsUnavailable: item.kind === "variable",
  });
  return (
    <button
      type="button"
      className="product-card"
      onClick={() => onSelect(item)}
      disabled={out}
      aria-label={item.name}
      title={item.name}
    >
      <div className="product-card-body">
        <ProductBadgeList badges={badges} />
        <div className="product-name">{item.name}</div>
        {skuLabel(item.sku) ? <div className="product-sku muted">{skuLabel(item.sku)}</div> : null}
      </div>
      <div className="product-card-footer">
      <div className={stockStatusClass(item.stockStatus)}><span className="product-stock-dot" aria-hidden="true" />{stock.text}</div>
      {priceView?.kind === "range" ? (
        <div
          className="product-price product-price-range"
          data-product-display-price={price ?? undefined}
          aria-label={price ?? undefined}
        >
          <span className="product-price-amount">{formatMoneyDisplay(priceView.min)}</span>
          <span aria-hidden="true"> – </span>
          <span className="product-price-amount">{formatMoneyDisplay(priceView.max)}</span>
        </div>
      ) : price ? (
        <div
          className={`product-price${price === "Price unavailable" ? " product-price-unavailable" : ""}`}
          data-product-display-price={price}
        >
          {price}
        </div>
      ) : (
        <div className="product-price product-price-empty" />
      )}
      </div>
    </button>
  );
}

export function ProductResults({
  items,
  onSelect,
}: {
  items: readonly SellProductView[];
  onSelect: (item: SellProductView) => void;
}) {
  const preference = useSyncExternalStore(subscribeProductView, readProductView, () => DEFAULT_PRODUCT_VIEW);
  const [layout, density] = preference.split(":");
  if (items.length === 0) {
    return <div className="product-empty-state"><strong>No products match this search.</strong><p className="muted">Try another name, SKU or barcode.</p></div>;
  }
  return (
    <>
    <div className="product-view-toolbar">
      <div className="product-view-switch" role="group" aria-label="Product view">
        <button type="button" className="btn" aria-pressed={layout === "grid"} onClick={() => saveProductView(`grid:${density}`)}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="2.5" width="5.5" height="5.5" rx="1" /><rect x="12" y="2.5" width="5.5" height="5.5" rx="1" /><rect x="2.5" y="12" width="5.5" height="5.5" rx="1" /><rect x="12" y="12" width="5.5" height="5.5" rx="1" /></svg>
          Grid
        </button>
        <button type="button" className="btn" aria-pressed={layout === "list"} onClick={() => saveProductView(`list:${density}`)}>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4h12M6 10h12M6 16h12M2 4h1M2 10h1M2 16h1" /></svg>
          List
        </button>
      </div>
      <button type="button" className="btn product-density-toggle" aria-pressed={density === "compact"} onClick={() => saveProductView(`${layout}:${density === "compact" ? "comfortable" : "compact"}`)}>
        Compact
      </button>
    </div>
    <div className={`product-results product-view-${layout} product-density-${density}`}>
      <div className="product-grid">
        {items.map((item) => (
          <ProductCard key={item.id} item={item} onSelect={onSelect} />
        ))}
      </div>
    </div>
    </>
  );
}

export function ProductResultsSkeleton() {
  return (
    <div className="sell-search-loading" role="status" aria-label="Loading products">
      <span className="sr-only">Loading products…</span>
      <div className="sell-loading-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="sell-loading-card" key={index}>
            <div className="sell-skeleton sell-skeleton-title" />
            <div className="sell-skeleton sell-skeleton-line" />
            <div className="sell-skeleton sell-skeleton-line short" />
            <div className="sell-skeleton sell-skeleton-price" />
          </div>
        ))}
      </div>
    </div>
  );
}
