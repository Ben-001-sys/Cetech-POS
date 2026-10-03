"use client";

import { useState } from "react";
import type { ShiftReport } from "../../../../../docs/contracts/domain.generated";
import {
  fetchManagementCashMovements,
  fetchManagementShiftReport,
  reverseManagementCashMovement,
} from "../../app/management-client";
import type { ManagementCashMovement } from "../../server/admin/cash-correction-admin-store";
import type { OperationalPolicyView } from "../../server/admin/handle-operational-policy";
import type {
  ManagementShiftCashRow,
  ManagementShiftCashView,
} from "../../server/admin/management-shift-cash-directory";
import type { ShiftClosePolicy } from "../../server/auth/policy";
import { formatMoneyLabel, formatOperationalDateTime } from "../../ui/cashier-language";
import { ManagementLoading } from "./ManagementLoading";

const STATUS_LABEL = {
  open: "Open",
  closing: "Closing",
  requires_attention: "Needs attention",
  closed: "Closed",
} as const;

export function ShiftCashPanel({
  view,
  loading = false,
  errorMessage,
  correlationId,
  policy = null,
  policyLoading = false,
  onOpenPolicies,
  managedLocationIds = [],
  onChanged,
  now = new Date(),
}: {
  readonly view: ManagementShiftCashView | null;
  readonly loading?: boolean;
  readonly errorMessage?: string;
  readonly managedLocationIds?: readonly string[];
  readonly onChanged?: () => void;
  readonly correlationId?: string;
  readonly policy?: OperationalPolicyView | null;
  readonly policyLoading?: boolean;
  readonly onOpenPolicies?: () => void;
  readonly now?: Date;
}) {
  if (loading) {
    return <ManagementLoading message="Loading shifts and cash…" />;
  }
  if (errorMessage) {
    return (
      <section className="card card-pad stack" aria-live="assertive">
        <div className="banner danger" role="alert">
          Shift and cash oversight is temporarily unavailable.
        </div>
        <p>{errorMessage}</p>
        {correlationId ? <p className="muted">Reference {correlationId}</p> : null}
      </section>
    );
  }
  if (!view || view.rows.length === 0) {
    return (
      <section className="card card-pad stack">
        <h2>Shifts and cash</h2>
        <p role="status">No shifts are currently available in your management scope.</p>
        {view ? <p className="muted">{scopeCopy(view)}</p> : null}
        <PolicyContext
          policy={policy}
          policyLoading={policyLoading}
          onOpenPolicies={onOpenPolicies}
          shiftScope={view?.scope}
        />
      </section>
    );
  }

  const active = view.rows.filter((row) => row.status !== "closed");
  const closed = view.rows.filter((row) => row.status === "closed");
  const locationCount = new Set(view.rows.map((row) => row.locationId)).size;
  const registerCount = new Set(view.rows.map((row) => row.registerId)).size;

  return (
    <div className="shift-cash-panel stack">
      <p>{scopeCopy(view)}</p>
      {view.truncated ? (
        <p className="muted">
          This view is limited to {view.limit} shifts. Needs attention, closing, and open shifts come before recently closed shifts.
        </p>
      ) : null}
      <ul className="shift-cash-summary" aria-label="Operational summary">
        <SummaryStat label="Needs attention" value={count(view.rows, "requires_attention")} tone="attention" />
        <SummaryStat label="Closing" value={count(view.rows, "closing")} tone="closing" />
        <SummaryStat label="Open" value={count(view.rows, "open")} />
        <SummaryStat label="Recently closed" value={closed.length} />
      </ul>
      <p className="muted">
        {locationCount} location{locationCount === 1 ? "" : "s"} · {registerCount} register{registerCount === 1 ? "" : "s"} in this view
      </p>

      <section className="stack" aria-labelledby="shift-cash-active-heading">
        <h2 id="shift-cash-active-heading">Active and attention shifts</h2>
        {active.length === 0 ? (
          <p>No open, closing, or attention shifts in this view.</p>
        ) : (
          <div className="shift-cash-list">
            {active.map((row) => (
              <ShiftCard
                key={row.shiftId}
                row={row}
                now={now}
                canCorrect={managedLocationIds.includes(row.locationId)}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </section>

      <section className="stack" aria-labelledby="shift-cash-closed-heading">
        <h2 id="shift-cash-closed-heading">Recently closed</h2>
        {closed.length === 0 ? (
          <p>No recently closed shifts in this view.</p>
        ) : (
          <div className="shift-cash-list">
            {closed.map((row) => (
              <ShiftCard
                key={row.shiftId}
                row={row}
                now={now}
                canCorrect={managedLocationIds.includes(row.locationId)}
                onChanged={onChanged}
              />
            ))}
          </div>
        )}
      </section>

      <PolicyContext
        policy={policy}
        policyLoading={policyLoading}
        onOpenPolicies={onOpenPolicies}
        shiftScope={view.scope}
      />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "attention" | "closing";
}) {
  return (
    <li className={tone ? `shift-cash-stat ${tone}` : "shift-cash-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  );
}

function ShiftCard({
  row,
  now,
  canCorrect,
  onChanged,
}: {
  readonly row: ManagementShiftCashRow;
  readonly now: Date;
  readonly canCorrect: boolean;
  readonly onChanged?: () => void;
}) {
  const location = row.locationName ?? row.locationId;
  const register = row.registerName ?? row.registerId;
  const openLength = row.closedAt ? undefined : formatShiftOpenLength(row.openedAt, now);
  return (
    <article
      className="card card-pad shift-cash-card"
      data-shift-status={row.status}
      data-layout="shift-card"
    >
      <div className="shift-cash-card-main">
        <div className="stack">
          <div className="management-staff-head">
            <div>
              <h3>{location}</h3>
              <p>{register}</p>
            </div>
            <span className={statusClass(row.status)}>{STATUS_LABEL[row.status]}</span>
          </div>
          <p data-opened-at={row.openedAt}>Opened {formatOperationalDateTime(row.openedAt)}</p>
          {openLength ? <p>Open for {openLength}</p> : null}
          {row.closedAt ? <p data-closed-at={row.closedAt}>Closed {formatOperationalDateTime(row.closedAt)}</p> : null}
        </div>
        <dl className="shift-cash-money">
          <div>
            <dt>Opening float</dt>
            <dd>{formatMoneyLabel(row.openingFloat)}</dd>
          </div>
          <div>
            <dt>Expected cash</dt>
            <dd>{formatMoneyLabel(row.expectedCash)}</dd>
          </div>
          {row.countedCash ? (
            <div>
              <dt>Counted cash</dt>
              <dd>{formatMoneyLabel(row.countedCash)}</dd>
            </div>
          ) : null}
          {row.variance ? (
            <div>
              <dt>Variance</dt>
              <dd data-variance-minor={row.variance.minor}>{varianceCopy(row.variance.minor, row.variance.currency)}</dd>
            </div>
          ) : null}
        </dl>
        <div className="shift-cash-report">
          <p className="eyebrow">Report</p>
          {reportLines(row).map((line) => <p key={line}>{line}</p>)}
          <ShiftReportActions row={row} canCorrect={canCorrect} onChanged={onChanged} />
        </div>
      </div>
      <details className="management-reference">
        <summary>Reference</summary>
        <p className="muted">Shift ID {row.shiftId}</p>
        <p className="muted">Cashier ID {row.cashierId}</p>
        <p className="muted">Device ID {row.deviceId}</p>
        {row.report.zReportId ? <p className="muted">Z report ID {row.report.zReportId}</p> : null}
      </details>
    </article>
  );
}

function ShiftReportActions({
  row,
  canCorrect,
  onChanged,
}: {
  readonly row: ManagementShiftCashRow;
  readonly canCorrect: boolean;
  readonly onChanged?: () => void;
}) {
  const [report, setReport] = useState<ShiftReport | null>(null);
  const [reportPhase, setReportPhase] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [reportError, setReportError] = useState<string | null>(null);
  const [movements, setMovements] = useState<readonly ManagementCashMovement[] | null>(null);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function loadReport(kind: "X" | "Z") {
    setPending(true);
    setError(null);
    setReportError(null);
    setReport(null);
    setReportPhase("loading");
    const result = await fetchManagementShiftReport(row.shiftId, kind);
    setPending(false);
    if (!result.ok) {
      setReportPhase("error");
      setError(null);
      setReportError(result.error.message || "The shift summary could not be loaded.");
      return;
    }
    if (typeof result.data.expectedCash?.minor !== "number" || !result.data.expectedCash.currency) {
      setReport(null);
      setReportPhase("empty");
      return;
    }
    setReport(result.data);
    setReportPhase("ready");
  }

  async function loadMovements() {
    setPending(true);
    setError(null);
    const result = await fetchManagementCashMovements(row.shiftId);
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setMovements(result.data);
  }

  async function reverse(movementId: string) {
    setPending(true);
    setError(null);
    const result = await reverseManagementCashMovement({
      shiftId: row.shiftId,
      movementId,
      reason,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setMessage(result.data.replayed
      ? "This movement was already reversed. Expected cash was not changed again."
      : "Cash entry reversed. Expected cash now includes that exact reversal.");
    setReason("");
    onChanged?.();
    await loadMovements();
  }

  return (
    <div className="stack">
      <div className="dialog-actions">
        {row.report.xAvailable ? (
          <button className="btn small" type="button" disabled={pending} onClick={() => void loadReport("X")}>
            View X report
          </button>
        ) : null}
        {row.report.zAvailable ? (
          <button className="btn small" type="button" disabled={pending} onClick={() => void loadReport("Z")}>
            View Z report
          </button>
        ) : null}
        <button className="btn small" type="button" disabled={pending} onClick={() => void loadMovements()}>
          Cash entries
        </button>
      </div>
      {reportPhase === "loading" ? (
        <p role="status" data-management-report="loading">Loading the shift summary.</p>
      ) : null}
      {reportPhase === "empty" ? (
        <p role="status" data-management-report="empty">No shift totals are available for this report.</p>
      ) : null}
      {reportPhase === "error" ? (
        <div className="banner danger" role="alert" data-management-report="error">
          {reportError || "The shift summary could not be loaded."}
        </div>
      ) : null}
      {reportPhase === "ready" && report ? (
        <div className="card card-pad" data-management-report={report.kind} data-shift-report="ready">
          <strong>{report.kind === "Z" ? "Z report" : "Shift summary (X report)"}</strong>
          <p data-report-expected="">Expected {formatMoneyLabel(report.expectedCash)}</p>
          {report.countedCash ? <p>Counted {formatMoneyLabel(report.countedCash)}</p> : null}
          {report.variance ? <p>Variance {formatMoneyLabel({ minor: Math.abs(report.variance.minor), currency: report.variance.currency })}</p> : null}
          {report.kind === "X" ? <p className="muted">This is a live summary. The shift stays open.</p> : null}
        </div>
      ) : null}
      {movements ? (
        <ul className="stack">
          {movements.length === 0 ? <li>No cash entries are stored for this shift.</li> : null}
          {movements.map((movement) => (
            <li key={movement.id}>
              <span>{movementLabel(movement.kind)} {formatSigned(movement.signedAmountMinor, movement.currency)}</span>
              {movement.reason ? <span className="muted"> {movement.reason}</span> : null}
              {canCorrect && row.status === "open" && movement.kind !== "correction" ? (
                <button className="btn small" type="button" disabled={pending || reason.trim().length === 0} onClick={() => void reverse(movement.id)}>
                  Reverse cash entry
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canCorrect && row.status === "open" ? (
        <label className="field">
          <span>Reason for reversing a cash entry</span>
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
      {error ? <div className="banner danger" role="alert">{error}</div> : null}
    </div>
  );
}

function movementLabel(kind: string): string {
  switch (kind) {
    case "opening_float": return "Opening float";
    case "cash_sale": return "Cash sale";
    case "cash_refund": return "Cash refund";
    case "pay_in": return "Pay in";
    case "pay_out": return "Pay out";
    case "cash_pickup": return "Cash pickup";
    case "correction": return "Correction";
    default: return "Cash movement";
  }
}

function formatSigned(minor: number, currency: string): string {
  const amount = formatMoneyLabel({ minor: Math.abs(minor), currency });
  if (minor > 0) return `+${amount}`;
  if (minor < 0) return `-${amount}`;
  return amount;
}

function PolicyContext({
  policy,
  policyLoading,
  onOpenPolicies,
  shiftScope,
}: {
  readonly policy: OperationalPolicyView | null;
  readonly policyLoading: boolean;
  readonly onOpenPolicies?: () => void;
  readonly shiftScope?: ManagementShiftCashView["scope"];
}) {
  return (
    <section className="card card-pad stack" aria-labelledby="shift-cash-policy-heading">
      <h2 id="shift-cash-policy-heading">Shift-closing rules</h2>
      {policyLoading ? <p>Loading shift-closing rules…</p> : null}
      {!policyLoading && policy ? (
        <>
          <p className="muted">{policyScopeCopy(policy)}</p>
          <ul className="shift-cash-policy">
            {policyLines(policy.effective).map((line) => <li key={line}>{line}</li>)}
          </ul>
          <p className="muted">{policyScopeCaveat(policy, shiftScope)}</p>
        </>
      ) : null}
      {!policyLoading && !policy ? <p>Shift-closing rules could not be loaded. Shift oversight above is unchanged.</p> : null}
      {onOpenPolicies ? (
        <button className="btn" type="button" onClick={onOpenPolicies}>
          Open operational rules
        </button>
      ) : null}
    </section>
  );
}

function policyScopeCopy(policy: OperationalPolicyView): string {
  if (policy.scope.registerId) return "These rules apply to this register.";
  if (policy.scope.locationId) return "These rules apply to this location.";
  return "These are the organization-wide default rules.";
}

function policyScopeCaveat(
  policy: OperationalPolicyView,
  shiftScope: ManagementShiftCashView["scope"] | undefined,
): string {
  if (!shiftScope) {
    return "A location or register may have more specific rules.";
  }
  if (shiftScope.kind === "organization") {
    return "Some locations or registers shown here may use different rules.";
  }
  if (shiftScope.locationIds.length > 1) {
    return "Other visible locations or registers may use different rules.";
  }
  if (!policy.scope.registerId) {
    return "Some registers at this location may use different rules.";
  }
  return "These rules apply only to this register.";
}

function policyLines(policy: ShiftClosePolicy): readonly string[] {
  return [
    policy.managerCanCloseShift ? "Managers can close shifts" : "Managers cannot close shifts",
    policy.cashierCanCloseShift ? "Cashiers can close shifts" : "Cashiers cannot close shifts",
    policy.cashierCanCloseShift && policy.cashierOwnShiftOnly ? "Cashiers can close only their own shift" : "",
    policy.nonZeroVarianceRequiresManager
      ? "Cash differences require manager review"
      : "Cash differences do not require manager review",
  ].filter((line) => line.length > 0);
}

function reportLines(row: ManagementShiftCashRow): readonly string[] {
  const lines: string[] = [];
  if (row.status === "requires_attention") lines.push("Requires attention");
  if (row.report.xAvailable) lines.push("X report available");
  if (row.report.zAvailable) lines.push("Z report available");
  else if (row.status !== "closed") lines.push("Z report pending because shift is not closed");
  else lines.push("Z report is not recorded");
  return lines;
}

function varianceCopy(minor: number, currency: string): string {
  if (minor === 0) return "No variance";
  const amount = formatMoneyLabel({ minor: Math.abs(minor), currency });
  return minor > 0 ? `Over by ${amount}` : `Short by ${amount}`;
}

function statusClass(status: ManagementShiftCashRow["status"]): string {
  if (status === "requires_attention") return "status-pill danger";
  if (status === "closing") return "status-pill warning";
  if (status === "closed") return "status-pill neutral";
  return "status-pill neutral";
}

export function formatShiftOpenLength(openedAt: string, now: Date): string | undefined {
  const opened = new Date(openedAt).getTime();
  if (Number.isNaN(opened)) return undefined;
  const minutes = Math.max(0, Math.floor((now.getTime() - opened) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours < 48) return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return leftoverHours === 0 ? `${days} days` : `${days} days ${leftoverHours} hr`;
}

function scopeCopy(view: ManagementShiftCashView): string {
  if (view.scope.kind === "organization") return "Showing shifts for the whole organization.";
  const names = [...new Set(view.rows.map((row) => row.locationName).filter((name): name is string => Boolean(name)))];
  if (names.length === 1) return `Showing shifts for ${names[0]}.`;
  if (names.length > 1) return `Showing shifts for ${names.join(", ")}.`;
  return "Showing shifts only for locations you manage.";
}

function count(rows: readonly ManagementShiftCashRow[], status: ManagementShiftCashRow["status"]): number {
  return rows.filter((row) => row.status === status).length;
}
