"use client";

import { useEffect, useRef } from "react";
import type { StoreHealth } from "../../../../../docs/contracts/domain.generated";
import type { CatalogProjectionAvailability } from "../../local/catalog-sync";
import type { PaymentMethodCapabilities } from "../../server/payments/method-capabilities";
import { toCashierError } from "../cashier-language";
import { presentHealthRows } from "./healthPresentation";

export type OperationalLoadState = "ready" | "loading" | "error" | "offline" | "degraded";
export type UpdateSafetyView = "safe" | "defer" | "blocked_critical";
export type MigrationStateView = "idle" | "running" | "blocked" | "complete" | "failed";
export type AttentionSeverityView = "low" | "medium" | "critical";

export type AttentionItemView = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly typeLabel: string;
  readonly severity: AttentionSeverityView;
  readonly transactionReference?: string;
  readonly transactionId?: string;
  readonly paymentId?: string;
  readonly retryAllowed?: boolean;
  readonly resolveAllowed?: boolean;
  readonly reviewAllowed?: boolean;
  readonly recoverKind?: "payment" | "sale" | "return" | "shift" | "catalog" | "register";
  /** When false, the item stays visible but does not stop selling on the current register. */
  readonly blocksCheckout?: boolean;
  /** Who started the saved local work. Absent on server-owned attention items. */
  readonly localRecoveryOwner?: "viewer" | "other" | "unknown";
  /** Generic device gate for financial work whose organization was not recorded. */
  readonly quarantine?: boolean;
};

export interface StoreHealthScreenProps {
  readonly health?: StoreHealth;
  readonly state?: OperationalLoadState;
  readonly errorMessage?: string;
  readonly online?: boolean;
  readonly catalogAvailability?: CatalogProjectionAvailability | null;
  readonly electronicPaymentsAvailable?: boolean;
  readonly paymentMethods?: PaymentMethodCapabilities;
  readonly attentionCountOverride?: number;
  readonly onRetry?: () => void;
  readonly onOpenAttention?: () => void;
}

function healthRowTone(tone: "ok" | "degraded" | "unavailable" | "unverified"): string {
  if (tone === "ok") return "success";
  if (tone === "degraded" || tone === "unverified") return "warning";
  return "danger";
}

export function ConnectivityNotice({ state }: { readonly state: "online" | "offline" | "degraded" }) {
  if (state === "online") return null;
  return (
    <div className={`banner ${state === "offline" ? "warning" : "info"} operational-banner`} role="status">
      <strong>{state === "offline" ? "You are offline." : "Connection is degraded."}</strong>
      <span>
        {state === "offline"
          ? "Saved local work stays on this device. Online-required actions must wait for connection."
          : "Some services may be slower or temporarily unavailable. If a sale or payment result is unclear, check its status before trying again."}
      </span>
    </div>
  );
}

function OperationalLoadingState({ message }: { readonly message: string }) {
  return (
    <div className="card card-pad operational-state operational-loading" role="status" aria-live="polite">
      <div className="workspace-skeleton" aria-hidden="true">
        <span className="skeleton-line" />
        <span className="skeleton-line" />
        <span className="skeleton-line" />
      </div>
      <strong>{message}</strong>
    </div>
  );
}

export function PassiveTabNotice({ passive }: { readonly passive: boolean }) {
  if (!passive) return null;
  return (
    <div className="banner warning operational-banner" role="alert" data-passive-tab="true">
      <strong>This tab is read-only.</strong>
      <span>Use the other active POS tab to make changes.</span>
    </div>
  );
}

export function StoreHealthScreen({
  health,
  state = "ready",
  errorMessage,
  online = true,
  catalogAvailability,
  electronicPaymentsAvailable = false,
  paymentMethods,
  attentionCountOverride,
  onRetry,
  onOpenAttention,
}: StoreHealthScreenProps) {
  const pendingOperationCount = health?.pendingOperationCount ?? 0;
  const attentionCount = attentionCountOverride ?? health?.attentionCount ?? 0;
  const rows = presentHealthRows({
    online,
    health,
    catalogAvailability,
    electronicPaymentsAvailable,
    paymentMethods,
  });

  return (
    <section className="operational-surface" aria-labelledby="store-health-title">
      <div className="page-head">
        <div>
          <h1 id="store-health-title">System status</h1>
          <p>Check whether this device can reach the services needed to sell.</p>
        </div>
      </div>

      {state === "offline" ? <ConnectivityNotice state="offline" /> : null}
      {state === "degraded" ? <ConnectivityNotice state="degraded" /> : null}
      {state === "error" ? (
        <div className="banner danger operational-banner" role="alert">
          <strong>{"System status couldn't be refreshed."}</strong>
          <span>
            {errorMessage
              ? toCashierError({ message: errorMessage, domain: "health" }).message
              : "Last known status can remain visible, but current connections are unverified."}
          </span>
          {onRetry ? (
            <button className="btn small" type="button" onClick={onRetry}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="operational-metrics" aria-label="System status summary" aria-busy={state === "loading"}>
        <div className="card operational-metric">
          <span className="eyebrow">Pending work</span>
          <strong>{state === "loading" && !health ? "—" : pendingOperationCount}</strong>
        </div>
        <div className="card operational-metric">
          <span className="eyebrow">Needs attention</span>
          <strong>{state === "loading" && !health && attentionCountOverride === undefined ? "—" : attentionCount}</strong>
        </div>
      </div>

      {state === "loading" ? (
        <OperationalLoadingState message="Checking System status…" />
      ) : null}

      {state !== "loading" ? (
        <div className="operational-health-list">
          {rows.map((row) => (
            <div className="operational-health-row" key={row.id}>
              <div>
                <strong>{row.name}</strong>
                <span>{row.detail}</span>
              </div>
              <span className={`workspace-badge ${healthRowTone(row.tone)}`}>{row.badge}</span>
            </div>
          ))}
        </div>
      ) : null}

      {onOpenAttention ? (
        <div className="operational-actions">
          <button className="btn" type="button" onClick={onOpenAttention}>
            View attention
          </button>
        </div>
      ) : null}
    </section>
  );
}

export interface NeedsAttentionScreenProps {
  readonly items: readonly AttentionItemView[];
  readonly state?: OperationalLoadState;
  readonly errorMessage?: string;
  readonly recoveringItemId?: string | null;
  readonly onRetryLoad?: () => void;
  readonly onRetryItem?: (id: string) => void;
  readonly onResolveItem?: (id: string) => void;
  readonly onReviewItem?: (id: string) => void;
}

export function NeedsAttentionScreen({
  items,
  state = "ready",
  errorMessage,
  recoveringItemId,
  onRetryLoad,
  onRetryItem,
  onResolveItem,
  onReviewItem,
}: NeedsAttentionScreenProps) {
  return (
    <section className="operational-surface" aria-labelledby="attention-title">
      <div className="page-head">
        <div>
          <h1 id="attention-title">Needs attention</h1>
          <p>Payments, sales, returns, or sync work that needs checking appears here.</p>
        </div>
      </div>
      {state === "offline" ? <ConnectivityNotice state="offline" /> : null}
      {state === "degraded" ? <ConnectivityNotice state="degraded" /> : null}
      {state === "error" ? (
        <div className="banner danger operational-banner" role="alert">
          <strong>Attention items could not be refreshed.</strong>
          <span>
            {errorMessage
              ? toCashierError({ message: errorMessage, domain: "generic" }).message
              : "Do not assume unresolved operations are cleared."}
          </span>
          {onRetryLoad ? (
            <button className="btn small" type="button" onClick={onRetryLoad}>
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {state === "loading" ? (
        <OperationalLoadingState message="Checking unresolved operations…" />
      ) : null}
      {state !== "loading" && state !== "error" && items.length === 0 ? (
        <div className="card card-pad">
          <div className="banner success" role="status">
            <strong>All clear</strong>
            <span>No issues need your attention.</span>
          </div>
        </div>
      ) : null}
      {state !== "loading" && items.length > 0 ? (
        <div className="operational-attention-list">
          {items.map((item) => (
            <article
              className={`card operational-attention-item severity-${item.severity}`}
              key={item.id}
              aria-busy={recoveringItemId === item.id}
            >
              <div className="operational-attention-head">
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.typeLabel}
                    {item.transactionReference ? ` · ${item.transactionReference}` : ""}
                  </span>
                </div>
                <span
                  className={`workspace-badge ${item.severity === "critical" ? "danger" : item.severity === "medium" ? "warning" : "info"}`}
                >
                  {item.severity.toUpperCase()}
                </span>
              </div>
              <p>{item.summary}</p>
              <div className="operational-actions">
                {item.resolveAllowed && onResolveItem ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={Boolean(recoveringItemId)}
                    onClick={() => {
                      if (recoveringItemId) {
                        return;
                      }
                      onResolveItem(item.id);
                    }}
                  >
                    Check / Recover
                  </button>
                ) : null}
                {item.retryAllowed && onRetryItem ? (
                  <button
                    className="btn"
                    type="button"
                    disabled={Boolean(recoveringItemId)}
                    aria-busy={recoveringItemId === item.id}
                    onClick={() => {
                      if (recoveringItemId) {
                        return;
                      }
                      onRetryItem(item.id);
                    }}
                  >
                    {recoveringItemId === item.id ? "Refreshing…" : "Try again"}
                  </button>
                ) : null}
                {item.reviewAllowed && onReviewItem ? (
                  <button className="btn ghost" type="button" onClick={() => onReviewItem(item.id)}>
                    Mark reviewed
                  </button>
                ) : null}
                {!item.resolveAllowed && !item.retryAllowed ? (
                  <span className="muted">This needs manual review. Contact a manager or support.</span>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export interface UpdateReadyDialogProps {
  readonly open: boolean;
  readonly safety: UpdateSafetyView;
  readonly currentBuild: string;
  readonly nextBuild?: string;
  readonly onLater: () => void;
  readonly onApply: () => void;
}

export function UpdateReadyDialog({ open, safety, currentBuild: _currentBuild, nextBuild, onLater, onApply }: UpdateReadyDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) {
      const previousFocus = document.activeElement;
      dialogRef.current?.focus();
      return () => {
        if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
      };
    }
  }, [open]);

  if (!open) return null;
  const safe = safety === "safe";
  return (
    <div className="operational-dialog-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="operational-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-ready-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onLater();
          }
          if (event.key === "Tab") {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
            )).filter((control) => control.getClientRects().length > 0);
            const first = controls[0];
            const last = controls.at(-1);
            if (!first || !last) {
              event.preventDefault();
              return;
            }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="operational-dialog-head"><div><span className="eyebrow">Application update</span><h2 id="update-ready-title">Update ready</h2></div></div>
        <div className="operational-dialog-body stack">
          {safety === "blocked_critical" ? <div className="banner danger" role="alert"><strong>Update blocked by active transaction.</strong><span>The new version must wait until payment or recovery reaches a safe point.</span></div> : null}
          {safety === "defer" ? <div className="banner warning" role="status"><strong>Update deferred.</strong><span>Finish or safely clear the current work before applying the update.</span></div> : null}
          {safety === "safe" ? <div className="banner success" role="status"><strong>Safe to update.</strong><span>Your saved cart and pending work will be kept.</span></div> : null}
          <dl className="operational-detail-list">{nextBuild ? <div><dt>Update</dt><dd>New version ready</dd></div> : null}<div><dt>Saved cart and pending work</dt><dd>Kept</dd></div><div><dt>Product list</dt><dd>Can be refreshed</dd></div></dl>
        </div>
        <div className="operational-dialog-actions"><button className="btn" type="button" onClick={onLater}>Update later</button><button className="btn primary" type="button" disabled={!safe} onClick={onApply}>Update now</button></div>
      </section>
    </div>
  );
}

export interface LocalDataMigrationPanelProps {
  readonly state: MigrationStateView;
  readonly message?: string;
  readonly onRetry?: () => void;
}

export function LocalDataMigrationPanel({ state, message, onRetry }: LocalDataMigrationPanelProps) {
  return (
    <section className="card card-pad operational-panel" aria-labelledby="migration-title" aria-live="polite">
      <h2 id="migration-title">Updating offline data</h2>
      {state === "idle" ? <p>No offline data update is currently running.</p> : null}
      {state === "running" ? <div className="operational-state"><div className="operational-spinner" aria-hidden="true" /><div><strong>Updating offline data…</strong><p>Your saved cart and pending work will be kept.</p></div></div> : null}
      {state === "blocked" ? <div className="banner warning" role="alert"><strong>Another POS window is blocking the data upgrade.</strong><span>{message ?? "Close the other POS window or wait for it to release local data. Data has not been deleted."}</span></div> : null}
      {state === "failed" ? <div className="banner danger" role="alert"><strong>Offline data update needs recovery.</strong><span>{message ?? "Do not clear saved carts or pending work as a normal repair step."}</span></div> : null}
      {state === "complete" ? <div className="banner success" role="status"><strong>Offline data updated.</strong><span>Your saved cart and pending work were kept.</span></div> : null}
      {(state === "blocked" || state === "failed") && onRetry ? <button className="btn" type="button" onClick={onRetry}>Check again</button> : null}
    </section>
  );
}

export interface FixAppPanelProps {
  readonly criticalOperationActive: boolean;
  readonly onCheckHealth?: () => void;
  readonly onRebuildCatalog?: () => void;
  readonly onLastResortReset?: () => void;
}

export function FixAppPanel({ criticalOperationActive, onCheckHealth, onRebuildCatalog, onLastResortReset }: FixAppPanelProps) {
  return (
    <section className="card card-pad operational-panel" aria-labelledby="fix-app-title">
      <h2 id="fix-app-title">Troubleshoot</h2>
      <div className="banner info"><strong>Repair safely first.</strong><span>Saved carts and pending work stay separate from replaceable app files and the product list.</span></div>
      <ol className="operational-recovery-steps"><li>Check connection and system status.</li><li>Repair replaceable app files.</li><li>Refresh products.</li><li>Retry a safe local-data repair.</li><li>Use a last-resort reset only if a manager confirms it.</li></ol>
      {criticalOperationActive ? <div className="banner danger" role="alert"><strong>Destructive reset blocked.</strong><span>A critical operation still needs resolution.</span></div> : null}
      <div className="operational-actions">
        {onCheckHealth ? <button className="btn" type="button" onClick={onCheckHealth}>Check status</button> : null}
        {onRebuildCatalog ? <button className="btn" type="button" onClick={onRebuildCatalog}>Refresh products</button> : null}
        {onLastResortReset ? <button className="btn operational-danger-button" type="button" disabled={criticalOperationActive} onClick={onLastResortReset}>Last-resort reset</button> : null}
      </div>
    </section>
  );
}
