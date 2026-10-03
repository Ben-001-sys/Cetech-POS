import { formatOperationalDateTime, paymentTenderLabel } from "../../../ui/cashier-language";
import { formatMoneyDisplay } from "../state/quotePresentation";
import type { ReceiptViewModel } from "../state/checkoutSession";
import { resolveReceiptPresentation } from "../../../core/receipt/settings";
import type { ReceiptPaperWidth } from "../../../core/receipt/printer-preference";

export function ReceiptPaper({ receipt, paperWidth = 80, sample = false }: {
  readonly receipt: ReceiptViewModel;
  readonly paperWidth?: ReceiptPaperWidth;
  readonly sample?: boolean;
}) {
  if (!receipt.presentation) return <LegacyReceiptPaper receipt={receipt} />;
  const presentation = resolveReceiptPresentation(receipt.presentation);
  const showCustomer = Boolean(
    (presentation.showCustomerName && receipt.customerLabel.trim()) ||
    (presentation.showCustomerPhone && receipt.customerPhone?.trim()),
  );
  return (
    <article
      className="receipt-paper receipt-reference"
      data-receipt-source="receipt-port"
      data-receipt-id={receipt.id}
      data-receipt-template="1"
      data-paper-width={paperWidth}
    >
      {sample ? <p className="receipt-sample center">Sample — not a sale</p> : null}
      <header className="receipt-business center">
        {presentation.logoDataUrl ? (
          // Embedded sale-time raster data preserves offline historical reprints.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="receipt-logo" src={presentation.logoDataUrl} alt={`${presentation.businessName || "Business"} logo`} />
        ) : null}
        {presentation.businessName ? <h3>{presentation.businessName}</h3> : null}
        {presentation.taxRegistrationNumber ? <div>Tax No: {presentation.taxRegistrationNumber}</div> : null}
        <div>{receipt.locationName}</div>
        {presentation.address ? <div className="receipt-address">{presentation.address}</div> : null}
        {presentation.contactPhone ? <div>{presentation.contactPhone}</div> : null}
        {presentation.showCashier && receipt.cashierName.trim() ? <div>Processed by: {receipt.cashierName}</div> : null}
      </header>
      <section className="receipt-section receipt-identity" aria-label="Sale details">
        <div><strong>Order No: #{receipt.orderReference}</strong></div>
        <div className="r-row"><span>Receipt</span><span>{receipt.receiptNumber}</span></div>
        <div>Date: {formatOperationalDateTime(receipt.issuedAt)}</div>
        <div>Register: {receipt.registerName}</div>
      </section>
      {showCustomer ? (
        <section className="receipt-section" aria-label="Customer information">
          <div>Customer Info</div>
          {presentation.showCustomerName && receipt.customerLabel.trim() ? <div>Name: {receipt.customerLabel}</div> : null}
          {presentation.showCustomerPhone && receipt.customerPhone?.trim() ? <div>Phone: {receipt.customerPhone}</div> : null}
        </section>
      ) : null}
      <table className="receipt-items" aria-label="Purchased items">
        <colgroup><col className="receipt-sequence" /><col /><col className="receipt-quantity" /><col className="receipt-amount" /></colgroup>
        <thead><tr><th scope="col">SL</th><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Total</th></tr></thead>
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr key={`${line.name}-${index}`}>
              <td>{index + 1}</td>
              <td>
                <div className="receipt-item-name">{line.name}</div>
                {line.variationLabel ? <div>{line.variationLabel}</div> : null}
                {line.sku ? <div>{line.sku.startsWith("SKU ") ? line.sku : `SKU ${line.sku}`}</div> : null}
                <div className="receipt-unit-price">Unit price: {formatMoneyDisplay(line.unitPrice)}</div>
              </td>
              <td className="receipt-qty">{line.quantity}</td>
              <td className="receipt-money">{formatMoneyDisplay(line.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section className="receipt-totals" aria-label="Totals and payment">
        <div className="r-row"><span>Subtotal</span><span>{formatMoneyDisplay(receipt.subtotal)}</span></div>
        {receipt.discount.minor !== 0 ? <div className="r-row"><span>Discount</span><span>{formatMoneyDisplay(receipt.discount)}</span></div> : null}
        <div className="r-row"><span>Tax</span><span>{formatMoneyDisplay(receipt.tax)}</span></div>
        <div className="r-row r-total"><span>TOTAL</span><span>{formatMoneyDisplay(receipt.total)}</span></div>
        {receipt.tender === "cash" && receipt.cashReceived ? <div className="r-row"><span>Cash received</span><span>{formatMoneyDisplay(receipt.cashReceived)}</span></div> : null}
        {receipt.tender === "cash" && receipt.changeDue ? <div className="r-row"><span>Change</span><span>{formatMoneyDisplay(receipt.changeDue)}</span></div> : null}
        <div className="r-row receipt-payment"><strong>Payment method</strong><strong>{paymentTenderLabel(receipt.tender)}</strong></div>
      </section>
      {receipt.transactionId ? <span hidden data-sale-reference={receipt.transactionId} /> : null}
      {presentation.footerMessage ? <footer className="receipt-footer center"><strong>{presentation.footerMessage}</strong></footer> : null}
    </article>
  );
}

/** Receipts captured before template version 1 retain their original content. */
function LegacyReceiptPaper({ receipt }: { receipt: ReceiptViewModel }) {
  return (
    <article className="receipt-paper" data-receipt-source="receipt-port" data-receipt-id={receipt.id}>
      <h3>CETECH</h3>
      <div className="center">{receipt.locationName}</div>
      <div className="center">
        <strong>Receipt</strong>
      </div>
      <hr />
      <div className="r-row">
        <span>Receipt</span>
        <span>{receipt.receiptNumber}</span>
      </div>
      <div className="r-row">
        <span>Order</span>
        <span>{receipt.orderReference}</span>
      </div>
      <div className="r-row">
        <span>Date</span>
        <span>{formatOperationalDateTime(receipt.issuedAt)}</span>
      </div>
      <div className="r-row">
        <span>Register</span>
        <span>{receipt.registerName}</span>
      </div>
      <div className="r-row">
        <span>Cashier</span>
        <span>{receipt.cashierName}</span>
      </div>
      <div className="r-row">
        <span>Customer</span>
        <span>{receipt.customerLabel}</span>
      </div>
      <hr />
      {receipt.lines.map((line, index) => (
        <div key={`${line.name}-${index}`}>
          <strong>{line.name}</strong>
          {line.variationLabel ? <div>{line.variationLabel}</div> : null}
          {line.sku ? <div className="muted">{line.sku.startsWith("SKU ") ? line.sku : `SKU ${line.sku}`}</div> : null}
          <div className="r-row">
            <span>
              {line.quantity} × {formatMoneyDisplay(line.unitPrice)}
            </span>
            <span>{formatMoneyDisplay(line.total)}</span>
          </div>
        </div>
      ))}
      <hr />
      <div className="r-row">
        <span>Subtotal</span>
        <span>{formatMoneyDisplay(receipt.subtotal)}</span>
      </div>
      {receipt.discount.minor !== 0 ? (
        <div className="r-row">
          <span>Discount</span>
          <span>{formatMoneyDisplay(receipt.discount)}</span>
        </div>
      ) : null}
      <div className="r-row">
        <span>Tax</span>
        <span>{formatMoneyDisplay(receipt.tax)}</span>
      </div>
      <div className="r-row r-total">
        <span>TOTAL</span>
        <span>{formatMoneyDisplay(receipt.total)}</span>
      </div>
      <hr />
      <div className="r-row">
        <span>Payment</span>
        <span>{paymentTenderLabel(receipt.tender)}</span>
      </div>
      {receipt.cashReceived ? (
        <div className="r-row">
          <span>Cash received</span>
          <span>{formatMoneyDisplay(receipt.cashReceived)}</span>
        </div>
      ) : null}
      {receipt.changeDue ? (
        <div className="r-row">
          <span>Change</span>
          <span>{formatMoneyDisplay(receipt.changeDue)}</span>
        </div>
      ) : null}
      {receipt.transactionId ? <span hidden data-sale-reference={receipt.transactionId} /> : null}
      <hr />
      <p className="center muted">Thank you.</p>
    </article>
  );
}
