"use client";

import type { ManagementAuditItem, ManagementAuditView } from "../../server/admin/management-audit";
import { formatOperationalDateTime } from "../../ui/cashier-language";
import { ManagementLoading } from "./ManagementLoading";

export function AuditPanel({
  view,
  loading = false,
  errorMessage,
  correlationId,
}: {
  readonly view: ManagementAuditView | null;
  readonly loading?: boolean;
  readonly errorMessage?: string;
  readonly correlationId?: string;
}) {
  if (loading) {
    return <ManagementLoading message="Loading audit history…" />;
  }
  if (errorMessage || !view) {
    return (
      <section className="card card-pad stack" aria-live="assertive">
        <div className="banner danger" role="alert">Audit history is temporarily unavailable.</div>
        {errorMessage ? <p>{errorMessage}</p> : null}
        {correlationId ? <p className="muted">Reference {correlationId}</p> : null}
      </section>
    );
  }
  if (view.rows.length === 0) {
    return (
      <section className="card card-pad stack">
        <h2>Audit</h2>
        <p role="status">No management audit events are available in your authorized scope.</p>
        <p className="muted">{scopeCopy(view)}</p>
      </section>
    );
  }
  return (
    <div className="management-audit-panel stack" data-layout="management-audit">
      <p>{scopeCopy(view)}</p>
      {view.truncated ? <p className="muted">Showing the most recent {view.limit} authorized audit events.</p> : null}
      <div className="management-audit-list">
        {view.rows.map((row) => <AuditCard key={row.id} row={row} />)}
      </div>
    </div>
  );
}

function AuditCard({ row }: { readonly row: ManagementAuditItem }) {
  return (
    <article className="card card-pad management-audit-card" data-audit-action={row.action}>
      <div className="management-audit-head">
        <div>
          <h2>{row.actionLabel}</h2>
          <p className="muted">{formatOperationalDateTime(row.createdAt)}</p>
        </div>
        <span className="status-pill neutral">Recorded</span>
      </div>
      <dl className="management-audit-facts">
        <div><dt>Changed by</dt><dd>{row.actorId}</dd></div>
        <div><dt>Target</dt><dd>{row.targetLabel}{row.targetId ? ` · ${row.targetId}` : ""}</dd></div>
        {row.locationId ? <div><dt>Location</dt><dd>{row.locationId}</dd></div> : null}
        {row.registerId ? <div><dt>Register</dt><dd>{row.registerId}</dd></div> : null}
      </dl>
      {row.changes.length > 0 ? (
        <section className="stack" aria-label="Recorded changes">
          <h3>Changes</h3>
          <div className="management-audit-changes">
            {row.changes.map((change) => (
              <div key={change.label}>
                <strong>{change.label}</strong>
                <span>
                  {change.before !== undefined ? change.before : "Not set"}
                  {" → "}
                  {change.after !== undefined ? change.after : "Removed"}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="muted">The event is recorded. No safe field-level change summary is available.</p>
      )}
      <details>
        <summary>Reference</summary>
        <p className="muted">Event {row.id}</p>
        {row.correlationId ? <p className="muted">Correlation {row.correlationId}</p> : null}
      </details>
    </article>
  );
}

function scopeCopy(view: ManagementAuditView): string {
  return view.scope.kind === "organization"
    ? "Showing management audit events for the whole organization."
    : "Showing management audit events only for locations you manage.";
}
