import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ProductCard, ProductResults, ProductResultsSkeleton, ProductSearch } from "./ProductSearch";
import type { SellProductView } from "../state/sellView";

const product: SellProductView = {
  id: "test-product",
  name: "Electrical cable with a full product name",
  kind: "simple",
  barcodes: [],
  stockStatus: "low_stock",
  displayPrice: { minor: 2500, currency: "GHS" },
};

describe("ProductSearch toolbar", () => {
  test("keeps F2 Search and the accessible label without a visible Scan button", () => {
    const html = renderToStaticMarkup(
      createElement(ProductSearch, {
        query: "",
        onQueryChange: () => undefined,
        onSearchSubmit: () => undefined,
      }),
    );
    expect(html).toContain("F2 Search");
    expect(html).toContain("Barcode, SKU or product name");
    expect(html).toContain("Scan barcode or search products, SKU");
    expect(html).toContain('id="product-search"');
    expect(html).not.toContain(">Scan<");
    expect(html).not.toContain("Hardener");
    expect(html).not.toContain("Demo controls");
  });

  test("server rendering keeps accessible product-view controls without needing browser storage", () => {
    const html = renderToStaticMarkup(createElement(ProductResults, { items: [product], onSelect: () => undefined }));
    expect(html).toContain('aria-label="Product view"');
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Grid/);
    expect(html).toContain("List");
    expect(html).toContain("Compact");
    expect(html).toContain(`aria-label="${product.name}"`);
    expect(html).toContain("GHS 25.00");
  });

  test("stock is labelled once and missing advisory prices stay empty", () => {
    const html = renderToStaticMarkup(createElement(ProductCard, { item: { ...product, displayPrice: undefined }, onSelect: () => undefined }));
    expect(html.match(/Low stock/g)).toHaveLength(1);
    expect(html).not.toContain("GHS");
  });

  test("loading skeleton announces progress and has no selectable or priced products", () => {
    const html = renderToStaticMarkup(createElement(ProductResultsSkeleton));
    expect(html).toContain('role="status"');
    expect(html).toContain("Loading products");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("GHS");
  });
});
