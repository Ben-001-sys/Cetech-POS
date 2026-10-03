"use client";

import type { ManagementSystemHealthView } from "../../server/admin/management-system-health";
import type { StaffSignInDiagnosticReason } from "../../core/identity/sign-in-diagnostic";
import { formatOperationalDateTime } from "../../ui/cashier-language";
import { ManagementLoading } from "./ManagementLoading";

const STATUS_LABEL = {
  unavailable: "Unavailable",
  degraded: "Needs attention",
  unverified: "Not confirmed",
  healthy: "Working",
} as const;

const OVERALL_COPY = {
  unavailable: "A required service check is unavailable.",
  degraded: "Some service checks need attention.",
  unverified: "Some service checks are not confirmed.",
  healthy: "The service checks that ran succeeded.",
} as const;

export function SystemHealthPanel({
  view,
  loading = false,
  errorMessage,
  correlationId,
}: {
  readonly view: ManagementSystemHealthView | null;
  readonly loading?: boolean;
  readonly errorMessage?: string;
  readonly correlationId?: string;
}) {
  if (loading) {
    return <ManagementLoading variant="system-health" message="Loading system health…" />;
  }
  if (errorMessage || !view) {
    return (
      <section className="card card-pad stack" aria-live="assertive">
        <div className="banner danger" role="alert">System health is temporarily unavailable.</div>
        {errorMessage ? <p>{errorMessage}</p> : null}
        {correlationId ? <p className="muted">Reference {correlationId}</p> : null}
      </section>
    );
  }

  return (
    <div className="system-health-panel stack" data-layout="system-health">
      <section className={`banner ${view.overall === "healthy" ? "success" : view.overall === "unverified" ? "warning" : "danger"}`} role="status">
        <strong>{STATUS_LABEL[view.overall]}</strong>
        <p>{OVERALL_COPY[view.overall]}</p>
      </section>
      {view.checks.length === 0 ? (
        <p role="status">No service checks were returned.</p>
      ) : (
        <div className="system-health-list">
          {view.checks.map((check) => (
            <article
              key={check.id}
              className="card card-pad system-health-card"
              data-health-status={check.status}
            >
              <div className="system-health-head">
                <div>
                  <h2>{check.label}</h2>
                  <p>{check.summary}</p>
                </div>
                <span className={statusClass(check.status)}>{STATUS_LABEL[check.status]}</span>
              </div>
              <p className="muted">Checked {formatOperationalDateTime(check.checkedAt)}</p>
              {check.detail ? (
                <details>
                  <summary>Technical detail</summary>
                  <p className="muted">{check.detail}</p>
                </details>
              ) : null}
            </article>
          ))}
        </div>
      )}
      <details>
        <summary>Reference</summary>
        <p className="muted">Build {view.buildId}</p>
      </details>
      <SignInDiagnostics rows={view.signInDiagnostics ?? []} />
    </div>
  );
}

const SIGN_IN_REASON_COPY: Record<StaffSignInDiagnosticReason, string> = {
  provider_timeout: "The sign-in service timed out.",
  provider_unavailable: "The sign-in service did not respond.",
  provider_rejected: "The sign-in service rejected the attempt.",
  verifier_malformed: "The sign-in response could not be read.",
  session_store_unavailable: "The sign-in could not be saved.",
  runtime_not_configured: "Sign-in is not configured on this server.",
  transport_failed: "The sign-in request did not reach the service.",
};

function SignInDiagnostics({
  rows,
}: {
  readonly rows: NonNullable<ManagementSystemHealthView["signInDiagnostics"]>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="card card-pad stack" data-sign-in-diagnostics="">
      <h2>Recent sign-in checks</h2>
      <ul className="stack">
        {rows.map((row) => (
          <li key={`${row.correlationId}-${row.createdAt}`} data-sign-in-reason={row.reason}>
            <p>{SIGN_IN_REASON_COPY[row.reason]}</p>
            <p className="muted">Checked {formatOperationalDateTime(row.createdAt)}</p>
            <p className="muted">Reference {row.correlationId}</p>
            <p className="muted">
              {row.reason}
              {" · "}
              {row.httpStatusClass}
              {" · "}
              {row.sessionStoreReached ? "Session save was reached" : "Session save was not reached"}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function statusClass(status: ManagementSystemHealthView["overall"]): string {
  if (status === "unavailable" || status === "degraded") return "status-pill danger";
  if (status === "healthy") return "status-pill success";
  return "status-pill neutral";
}
