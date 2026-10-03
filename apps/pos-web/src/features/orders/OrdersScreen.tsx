"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Money } from "../../../../../docs/contracts/domain.generated";
import { formatMoneyLabel, formatOperationalDateTime, orderStatusLabel, paymentStatusLabel, toCashierError } from "../../ui/cashier-language";

export type OrdersWorkspaceState = "ready" | "loading" | "error" | "offline" | "degraded";
export type OrderWorkspaceStatus = "completed" | "payment_pending" | "needs_attention" | "cancelled";

export interface OrderListItemView {
  readonly id: string;
  readonly saleId?: string;
  readonly orderReference: string;
  readonly receiptNumber?: string;
  readonly customerLabel: string;
  readonly customerId?: string;
  readonly customerCompany?: string;
  readonly customerKind?: "walkin" | "retail" | "b2b";
  readonly createdAt: string;
  readonly paymentLabel: string;
  readonly paymentStatus?: "verified" | "pending" | "failed" | "requires_attention";
  readonly total: Money;
  readonly status: OrderWorkspaceStatus;
  readonly transactionReference?: string;
  readonly itemSummary?: string;
  readonly lines?: readonly OrderDetailLineView[];
}

export interface OrderDetailLineView {
  readonly id: string;
  readonly name: string;
  readonly quantity: string;
  readonly total: Money;
  readonly variationLabel?: string;
}

export interface OrderDetailView extends OrderListItemView {
  readonly cashierLabel?: string;
  readonly registerLabel?: string;
  readonly lines: readonly OrderDetailLineView[];
}

export interface OrderDetailDialogProps {
  readonly open: boolean;
  readonly order?: OrderDetailView;
  readonly canReturn?: boolean;
  readonly onClose: () => void;
  readonly onReprint?: (order: OrderDetailView) => void;
  readonly onStartReturn?: (order: OrderDetailView) => void;
}

export interface OrdersScreenProps {
  readonly orders: readonly OrderListItemView[];
  readonly state?: OrdersWorkspaceState;
  readonly errorMessage?: string;
  readonly actionMessage?: string;
  readonly actionError?: string;
  readonly onRetry?: () => void;
  readonly onSelectOrder?: (orderId: string) => void;
  readonly onNewSale?: () => void;
}

const STATUS_LABELS: Record<OrderWorkspaceStatus, string> = {
  completed: "Completed",
  payment_pending: "Pending",
  needs_attention: "Needs review",
  cancelled: "Cancelled",
};

function formatMoney(value: Money): string {
  return formatMoneyLabel(value);
}

function formatDateTime(value: string): string {
  return formatOperationalDateTime(value);
}

export function matchesOrderSearch(order: OrderListItemView, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return [
    order.orderReference,
    order.receiptNumber,
    order.customerLabel,
    order.customerId,
    order.customerCompany,
    order.transactionReference,
    order.saleId,
    order.itemSummary,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase()
    .includes(needle);
}

function badgeTone(status: OrderWorkspaceStatus | NonNullable<OrderListItemView["paymentStatus"]>): string {
  if (status === "completed" || status === "verified") return "success";
  if (status === "needs_attention" || status === "failed" || status === "requires_attention") return "danger";
  if (status === "payment_pending" || status === "pending") return "warning";
  return "neutral";
}

export function OrdersScreen({
  orders,
  state = "ready",
  errorMessage,
  actionMessage,
  actionError,
  onRetry,
  onSelectOrder,
  onNewSale,
}: OrdersScreenProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | OrderWorkspaceStatus>("all");

  const filtered = useMemo(() => {
    return orders.filter((order) => {
      const matchesStatus = status === "all" || order.status === status;
      return matchesStatus && matchesOrderSearch(order, query);
    });
  }, [orders, query, status]);

  const unavailable = state === "error";

  return (
    <section className="orders-workspace workspace-surface" aria-labelledby="orders-title">
      <div className="page-head">
        <div>
          <h1 id="orders-title">Orders</h1>
          <p>Review recent POS sales, reprint receipts, and start returns.</p>
        </div>
        {onNewSale ? (
          <button className="btn primary" type="button" onClick={onNewSale}>
            New sale
          </button>
        ) : null}
      </div>

      {actionMessage ? <div className="banner success workspace-banner" role="status">{actionMessage}</div> : null}
      {actionError ? <div className="banner danger workspace-banner" role="alert">{actionError}</div> : null}

      {state === "offline" ? (
        <div className="banner warning workspace-banner" role="status">
          <strong>Offline.</strong>
          <span>A connection is required to refresh order history and open order details.</span>
        </div>
      ) : null}
      {state === "degraded" ? (
        <div className="banner warning workspace-banner" role="status">
          <strong>Orders are partially available.</strong>
          <span>Some order updates may be delayed.</span>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="banner danger workspace-banner" role="alert">
          <strong>Orders could not be loaded.</strong>
          <span>{errorMessage ? toCashierError({ message: errorMessage, domain: "orders" }).message : "Order details are unavailable. Existing sales have not been changed."}</span>
          {onRetry ? (
            <button className="btn small" type="button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="card card-pad workspace-toolbar">
        <label className="field workspace-search" htmlFor="order-search">
          <span className="sr-only">Search orders</span>
          <input
            id="order-search"
            className="input"
            type="search"
            placeholder="Search recent order, receipt, customer or transaction…"
            value={query}
            disabled={unavailable}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <label className="field workspace-filter" htmlFor="order-status-filter">
          <span>Status</span>
          <select
            id="order-status-filter"
            className="select"
            value={status}
            disabled={unavailable}
            onChange={(event) => setStatus(event.target.value as "all" | OrderWorkspaceStatus)}
          >
            <option value="all">All</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state === "loading" ? (
        <div className="card card-pad workspace-skeleton orders-loading" role="status" aria-live="polite">
          <div>
            <strong>Loading orders…</strong>
            <p>Existing sales are not being changed.</p>
          </div>
          <div className="orders-skeleton-rows" aria-hidden="true">
            {[0, 1, 2].map((row) => (
              <div className="orders-skeleton-row" key={row}>
                <span className="skeleton-line" />
                <span className="skeleton-line" />
                <span className="skeleton-block" />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {state !== "loading" && state !== "error" && filtered.length === 0 ? (
        <div className="card card-pad workspace-state" role="status">
          <div>
            <strong>{orders.length === 0 ? "No sales available." : "No orders match this search."}</strong>
            <p>{orders.length === 0 ? "Completed sales will appear here when order history is available." : "Try another order, receipt, customer, or status."}</p>
          </div>
        </div>
      ) : null}

      {state !== "loading" && state !== "error" && filtered.length > 0 ? (
        <div className="workspace-table-wrap">
          <table className="workspace-table orders-table" aria-label="Recent POS orders">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Customer</th>
                <th scope="col">Date</th>
                <th scope="col">Payment</th>
                <th scope="col">Total</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((order) => (
                <tr key={order.id}>
                  <td data-label="Order">
                    <div className="order-cell-content">
                      {onSelectOrder ? (
                        <button className="workspace-link" type="button" onClick={() => onSelectOrder(order.id)}>
                          {order.orderReference}
                        </button>
                      ) : (
                        <strong>{order.orderReference}</strong>
                      )}
                      {order.receiptNumber ? <span className="workspace-subline">{order.receiptNumber}</span> : null}
                    </div>
                  </td>
                  <td data-label="Customer">
                    <div className="order-cell-content">
                      <span className="order-customer-name">{order.customerLabel}</span>
                      {order.customerCompany ? <span className="workspace-subline">{order.customerCompany}</span> : null}
                      {order.customerKind === "b2b" ? <span className="workspace-badge info">Wholesale</span> : null}
                    </div>
                  </td>
                  <td data-label="Date"><time dateTime={order.createdAt}>{formatDateTime(order.createdAt)}</time></td>
                  <td data-label="Payment">
                    <div className="order-cell-content">
                      {order.paymentLabel}
                      {order.paymentStatus ? (
                        <span className={`workspace-badge ${badgeTone(order.paymentStatus)}`}>{paymentStatusLabel(order.paymentStatus)}</span>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Total" className="order-money"><strong>{formatMoney(order.total)}</strong></td>
                  <td data-label="Status">
                    <span className={`workspace-badge ${badgeTone(order.status)}`}>{orderStatusLabel(order.status)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function OrderDetailDialog({ open, order, canReturn = true, onClose, onReprint, onStartReturn }: OrderDetailDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement;
    dialogRef.current?.focus();
    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open || !order) return null;

  return (
    <div className="order-detail-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="order-detail-dialog card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-detail-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
          if (event.key === "Tab") {
            const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
              'button:not([disabled]), summary, a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
            );
            const first = controls?.[0];
            const last = controls?.[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="order-detail-head">
          <div>
            <span className="eyebrow">Order detail</span>
            <h2 id="order-detail-title">{order.orderReference}</h2>
          </div>
          <button className="icon-btn" type="button" aria-label="Close order detail" onClick={onClose}>×</button>
        </div>
        <div className="order-detail-body">
          <div className="order-detail-grid">
            <div className="stack">
              <div>
                <span className="eyebrow">Customer</span>
                <strong>{order.customerLabel}</strong>
                {order.customerCompany ? <span className="workspace-subline">{order.customerCompany}</span> : null}
                {order.customerKind === "b2b" ? <span className="workspace-badge info">Wholesale</span> : null}
              </div>
              {order.customerId || order.transactionReference ? (
                <details className="management-reference">
                  <summary>Reference</summary>
                  {order.customerId ? <p className="muted">Customer account {order.customerId}</p> : null}
                  {order.transactionReference ? <p className="muted">Transaction {order.transactionReference}</p> : null}
                </details>
              ) : null}
              <div><span className="eyebrow">Payment</span><strong>{order.paymentLabel}</strong>{order.paymentStatus ? <span className={`workspace-badge ${badgeTone(order.paymentStatus)}`}>{paymentStatusLabel(order.paymentStatus)}</span> : null}</div>
            </div>
            <div className="stack">
              <div><span className="eyebrow">Total</span><strong className="order-detail-total">{formatMoney(order.total)}</strong></div>
              <div><span className="eyebrow">Date</span><strong>{formatDateTime(order.createdAt)}</strong></div>
              {order.cashierLabel || order.registerLabel ? <div><span className="eyebrow">Cashier / register</span><strong>{[order.cashierLabel, order.registerLabel].filter(Boolean).join(" · ")}</strong></div> : null}
            </div>
          </div>
          <div className="order-detail-lines" aria-label="Order lines">
            {order.lines.map((line) => (
              <div className="order-detail-line" key={line.id}>
                <span className="order-line-name">{line.quantity} × {line.name}{line.variationLabel ? <small>{line.variationLabel}</small> : null}</span>
                <strong>{formatMoney(line.total)}</strong>
              </div>
            ))}
          </div>
        </div>
        <div className="order-detail-actions">
          {onReprint ? <button className="btn" type="button" onClick={() => onReprint(order)}>Reprint</button> : null}
          {onStartReturn ? <button className="btn primary" type="button" disabled={!canReturn} onClick={() => onStartReturn(order)}>Return items</button> : null}
        </div>
      </section>
    </div>
  );
}
