"use client";

import { useMemo, useState } from "react";
import type { CustomerSummary } from "../../../../../docs/contracts/domain.generated";
import { toCashierError } from "../../ui/cashier-language";

export type CustomersWorkspaceState = "ready" | "loading" | "error" | "offline" | "degraded";

export interface CustomersScreenProps {
  readonly customers: readonly CustomerSummary[];
  readonly state?: CustomersWorkspaceState;
  readonly errorMessage?: string;
  readonly selectedCustomerId?: string;
  readonly commercialContextById?: Readonly<Record<string, string>>;
  readonly onRetry?: () => void;
  readonly onUseCustomer?: (customer: CustomerSummary) => void;
  readonly onSearchQueryChange?: (query: string) => void;
}

export function CustomersScreen({
  customers,
  state = "ready",
  errorMessage,
  selectedCustomerId,
  commercialContextById,
  onRetry,
  onUseCustomer,
  onSearchQueryChange,
}: CustomersScreenProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (onSearchQueryChange) {
      return customers;
    }
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return customers;
    return customers.filter((customer) =>
      [customer.displayName, customer.company, customer.phoneMasked]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [customers, onSearchQueryChange, query]);

  return (
    <section className="customers-workspace workspace-surface" aria-labelledby="customers-title">
      <div className="page-head">
        <div>
          <h1 id="customers-title">Customers</h1>
          <p>Search for a customer to use on the next sale.</p>
        </div>
      </div>

      {state === "offline" ? (
        <div className="banner warning workspace-banner" role="status">
          <strong>Offline.</strong>
          <span>Walk-in sales remain the safe fallback. Cached customer details may be stale until connection returns.</span>
        </div>
      ) : null}
      {state === "degraded" ? (
        <div className="banner warning workspace-banner" role="status">
          <strong>Customer search is temporarily limited.</strong>
          <span>You can still continue as Walk-in. Saved customer details may be incomplete until this recovers.</span>
        </div>
      ) : null}
      {state === "error" ? (
        <div className="banner danger workspace-banner" role="alert">
          <strong>Customers could not be loaded.</strong>
          <span>{errorMessage ? toCashierError({ message: errorMessage, domain: "customers" }).message : "Customer search is unavailable. You can continue as Walk-in from Sell."}</span>
          {onRetry ? (
            <button className="btn small" type="button" onClick={onRetry}>Retry</button>
          ) : null}
        </div>
      ) : null}

      <div className="card card-pad customers-search-card">
        <label className="field" htmlFor="customer-workspace-search">
          <span className="sr-only">Search customers</span>
          <input
            id="customer-workspace-search"
            className="input"
            type="search"
            placeholder="Name, company or phone…"
            value={query}
            disabled={state === "error"}
            onChange={(event) => {
              const value = event.target.value;
              setQuery(value);
              onSearchQueryChange?.(value);
            }}
          />
        </label>
      </div>

      {state === "loading" ? (
        <div className="card card-pad workspace-skeleton customers-loading" role="status" aria-live="polite">
          <div><strong>Loading customers…</strong><p>You can continue as Walk-in from Sell.</p></div>
          <div className="customer-card-grid" aria-hidden="true">
            {[0, 1, 2, 3].map((card) => (
              <div className="customer-skeleton-card" key={card}>
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
            <strong>{customers.length === 0 ? "No customer accounts available." : "No customers match this search."}</strong>
            <p>{customers.length === 0 ? "No customer accounts are available yet. Walk-in remains possible." : "Try a different name, company, or phone."}</p>
          </div>
        </div>
      ) : null}

      {state !== "loading" && state !== "error" && filtered.length > 0 ? (
        <div className="customer-card-grid">
          {filtered.map((customer) => {
            const selected = selectedCustomerId === customer.id;
            const commercialContext = commercialContextById?.[customer.id];
            return (
              <article className="card card-pad customer-card" key={customer.id} data-selected={selected ? "true" : "false"}>
                <div className="customer-card-heading">
                  <div className="customer-card-identity">
                    <strong>{customer.company ?? customer.displayName}</strong>
                    {customer.company && customer.company !== customer.displayName ? <span className="workspace-subline">{customer.displayName}</span> : null}
                    {customer.phoneMasked ? <span className="workspace-subline">{customer.phoneMasked}</span> : null}
                    {customer.kind === "b2b" && commercialContext ? (
                      <span className="workspace-subline">Wholesale · {commercialContext}</span>
                    ) : customer.kind === "b2b" && customer.company ? (
                      <span className="workspace-subline">Wholesale</span>
                    ) : null}
                  </div>
                  <span className={`workspace-badge ${customer.kind === "b2b" ? "info" : "neutral"}`}>
                    {customer.kind === "b2b" ? "WHOLESALE" : "Retail"}
                  </span>
                </div>
                {onUseCustomer ? (
                  <button
                    className={selected ? "btn primary" : "btn"}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onUseCustomer(customer)}
                  >
                    {selected ? "Selected for next sale" : "Use for next sale"}
                  </button>
                ) : (
                  <div className="muted">Choose a customer here, then continue the sale.</div>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
