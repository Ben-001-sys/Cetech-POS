"use client";

import type { SellProductView } from "../state/sellView";
import { skuLabel } from "../../../ui/cashier-language";
import { formatMoneyDisplay } from "../state/quotePresentation";
import { productStockCopy, stockStatusClass } from "../state/productPresentation";
import { formatProductDisplayPrice } from "../state/variableDisplayPrice";
import { SellModal } from "./SellModal";

export function VariationDialog({
  product,
  variations,
  onSelect,
  onCancel,
}: {
  product: SellProductView;
  variations: readonly SellProductView[];
  onSelect: (variation: SellProductView) => void;
  onCancel: () => void;
}) {
  return (
    <SellModal titleId="variation-dialog-title" onClose={onCancel}>
      <h2 id="variation-dialog-title">Choose variation</h2>
      <p className="variation-parent-name">{product.name}</p>
      <p className="muted">Select the exact variation. Scanning a variation barcode bypasses this chooser.</p>
      {variations.length === 0 ? (
        <p className="muted">No selectable variations were supplied for {product.name}.</p>
      ) : (
        <div className="variation-list">
          {variations.map((variation) => (
            <button key={variation.id} type="button" className="btn block variation-candidate" onClick={() => onSelect(variation)}>
              <span className="dialog-choice">
                <strong className="compact-product-name" title={variation.variationLabel ?? variation.name}>{variation.variationLabel ?? variation.name}</strong>
                {skuLabel(variation.sku) ? <span className="muted">{skuLabel(variation.sku)}</span> : null}
                <span className={stockStatusClass(variation.stockStatus)}>{productStockCopy(variation).text}</span>
              </span>
              <span className="variation-candidate-price">{formatProductDisplayPrice(variation.priceView ?? (variation.displayPrice ? { kind: "single", amount: variation.displayPrice } : undefined), formatMoneyDisplay)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </SellModal>
  );
}
