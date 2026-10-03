"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cashierErrorMessage, formatMoneyLabel, formatOperationalDateTime } from "../../ui/cashier-language";
import { ReturnFlow } from "./ReturnFlow";
import type { HistoricReturnSaleWithExisting } from "./existingReturn";
import { type ReturnConditionView, type ReturnSessionView } from "./returnView";

export type HistoricSaleLookup = {
  search(query: string): Promise<readonly HistoricReturnSaleWithExisting[]>;
};

function itemSummary(sale: HistoricReturnSaleWithExisting): string | undefined {
  if (sale.itemSummary) return sale.itemSummary;
  const first = sale.lines[0];
  if (!first) return undefined;
  if (sale.lines.length === 1) {
    return `${first.originalSoldQuantity} × ${first.name}`;
  }
  return `${first.originalSoldQuantity} × ${first.name} · ${sale.lines.length - 1} more`;
}

export function ReturnsScreen({
  session,
  inFlight,
  lookup,
  matches: initialMatches,
  onSelectSale,
  onUpdateLine,
  onPreview,
  onExecute,
  onResolve,
}: {
  session: ReturnSessionView;
  inFlight: boolean;
  lookup?: HistoricSaleLookup;
  matches?: readonly HistoricReturnSaleWithExisting[];
  onSelectSale: (sale: HistoricReturnSaleWithExisting) => void;
  onUpdateLine: (orderLineId: string, patch: { quantity?: string; reason?: string; condition?: ReturnConditionView }) => void;
  onPreview: () => void;
  onExecute: () => void;
  onResolve: () => void;
}) {
  const [query, setQuery] = useState("");
  const [localMatches, setLocalMatches] = useState<readonly HistoricReturnSaleWithExisting[] | null>(null);
  const [lookupError, setLookupError] = useState<string | undefined>();
  const [searching, setSearching] = useState(false);
  const selectedFlowRef = useRef<HTMLDivElement | null>(null);
  const locked = session.identityLocked;
  const lookupDisabled = searching || inFlight || locked || !lookup;
  const matches = localMatches ?? initialMatches ?? [];

  useEffect(() => {
    if (!session.saleId) return;
    const frame = window.requestAnimationFrame(() => {
      selectedFlowRef.current?.focus();
      selectedFlowRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [session.saleId]);

  useEffect(() => {
    if (!lookup || locked || initialMatches) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void lookup.search("").then(
        (result) => {
          if (cancelled) return;
          setLocalMatches(result);
          setSearching(false);
        },
        (error: unknown) => {
          if (cancelled) return;
          setLookupError(
            cashierErrorMessage(
              { message: error instanceof Error ? error.message : undefined },
              "returns",
            ),
          );
          setSearching(false);
        },
      );
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [lookup, locked, initialMatches]);

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lookup || searching || locked) {
      return;
    }
    setSearching(true);
    setLookupError(undefined);
    try {
      const result = await lookup.search(query);
      setLocalMatches(result);
      if (result.length === 0) {
        setLookupError("No original sale matched that search.");
      }
    } catch (error) {
      setLookupError(cashierErrorMessage(
        { message: error instanceof Error ? error.message : undefined },
        "returns",
      ));
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="returns-screen" data-return-identity-locked={locked ? "true" : "false"}>
      <div className="page-head">
        <div>
          <h1>Returns</h1>
          <p>Review returned items, refund progress, and stock handling without mixing them together.</p>
        </div>
      </div>
      <form className="card card-pad returns-search" onSubmit={handleSearch}>
        <div className="returns-search-controls">
          <label className="field" htmlFor="return-sale-query">
            <span className="sr-only">Find order, customer or receipt</span>
            <input
              id="return-sale-query"
              className="input"
              type="search"
              value={query}
              disabled={lookupDisabled}
              placeholder="Find order, customer or receipt…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <button className="btn" type="submit" disabled={lookupDisabled}>
            {searching ? "Searching…" : "Search sales"}
          </button>
        </div>
        {!lookup ? (
          <div className="banner warning" role="status">
            Original sale lookup is unavailable. You can still review a return after a sale is selected.
          </div>
        ) : null}
        {locked ? (
          <p className="muted" data-discovery-collapsed="">
            Other sales are hidden until this return is checked.
          </p>
        ) : null}
        {lookupError && !locked ? (
          <div className="banner danger" role="alert">
            {lookupError}
          </div>
        ) : null}
        {searching ? <p className="muted" role="status" aria-live="polite">Looking up original sales…</p> : null}
      </form>
      {searching && !locked && matches.length === 0 ? (
        <div className="returns-card-grid workspace-skeleton" aria-hidden="true">
          {[0, 1].map((card) => (
            <div className="card card-pad return-skeleton-card" key={card}>
              <span className="skeleton-line" />
              <span className="skeleton-line" />
              <span className="skeleton-block" />
            </div>
          ))}
        </div>
      ) : null}
      {!searching && !locked && !session.saleId && !lookupError && localMatches !== null && matches.length === 0 ? (
        <div className="card card-pad workspace-state" role="status">
          <div>
            <strong>No original sales available.</strong>
            <p>Search by order, customer or receipt to find the sale you want to return.</p>
          </div>
        </div>
      ) : null}
      {session.saleId ? (
        <div
          ref={selectedFlowRef}
          className="returns-selected-flow"
          tabIndex={-1}
          data-selected-return-flow={session.saleId}
        >
          <ReturnFlow
            session={session}
            inFlight={inFlight}
            onUpdateLine={onUpdateLine}
            onPreview={onPreview}
            onExecute={onExecute}
            onResolve={onResolve}
          />
        </div>
      ) : null}
      {!locked && matches.length > 0 ? (
        <div className="returns-card-grid">
          {matches.map((sale) => {
            const existing = sale.existingReturn;
            return (
              <article
                className={sale.saleId === session.saleId ? "card card-pad returns-sale-card selected" : "card card-pad returns-sale-card"}
                key={sale.saleId}
                data-selected-sale={sale.saleId === session.saleId ? "true" : "false"}
                data-existing-return={existing ? existing.returnId : ""}
              >
                <div className="returns-sale-head">
                  <strong>{sale.orderReference}</strong>
                  {sale.total ? <strong className="returns-sale-total">{formatMoneyLabel(sale.total)}</strong> : null}
                </div>
                <p className="workspace-subline">
                  {[sale.customerLabel, sale.createdAt ? formatOperationalDateTime(sale.createdAt) : undefined]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {itemSummary(sale) ? <p className="workspace-subline">{itemSummary(sale)}</p> : null}
                {existing ? (
                  <div className="banner warning" role="status" data-existing-return-warning="">
                    An unresolved return already exists for this sale. Open it to review refund and stock progress.
                  </div>
                ) : null}
                <button
                  type="button"
                  className={sale.saleId === session.saleId ? "btn selected" : "btn"}
                  aria-pressed={sale.saleId === session.saleId}
                  disabled={inFlight || locked}
                  onClick={() => {
                    if (locked) {
                      return;
                    }
                    onSelectSale(sale);
                  }}
                >
                  {existing ? "Open existing return" : "Return items"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
