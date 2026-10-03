"use client";

import { useState } from "react";
import type { ManagementReturnsAttentionItem, ManagementReturnsAttentionView } from "../../server/admin/management-returns-attention-directory";
import { approveManagementReturn, reconcileManagementRefund } from "../../app/management-client";
import { formatMoneyLabel, paymentStatusLabel } from "../../ui/cashier-language";
import { ManagementLoading } from "./ManagementLoading";

const PRIORITY_LABEL = {
  needs_attention: "Needs attention",
  awaiting_reconciliation: "Waiting for confirmation",
  pending: "Pending",
  informational: "Completed",
} as const;

const INTERVENTION_LABEL = {
  required: "Needs review",
  blocked: "Use the existing work; do not start another one",
  informational: "No action needed",
} as const;

export function ReturnsApprovalsPanel({
  view,
  loading = false,
  errorMessage,
  correlationId,
  onChanged,
}: {
  readonly view: ManagementReturnsAttentionView | null;
  readonly loading?: boolean;
  readonly errorMessage?: string;
  readonly correlationId?: string;
  readonly onChanged?: () => void;
}) {
  if (loading) {
    return <ManagementLoading message="Loading returns and refunds…" />;
  }
  if (errorMessage) {
    return (
      <section className="card card-pad stack" aria-live="assertive">
        <div className="banner danger" role="alert">
          Returns and approvals are temporarily unavailable.
        </div>
        <p>{errorMessage}</p>
        {correlationId ? <p className="muted">Reference {correlationId}</p> : null}
      </section>
    );
  }
  if (!view || view.rows.length === 0) {
    return (
      <section className="card card-pad stack">
        <h2>Returns and approvals</h2>
        <p role="status">No returns or refunds need attention in your management scope.</p>
        {view ? <p className="muted">{scopeCopy(view)}</p> : null}
      </section>
    );
  }

  return (
    <div className="returns-attention-panel stack">
      <p>{scopeCopy(view)}</p>
      {view.truncated ? (
        <p className="muted">
          This view is limited to {view.limit} items. Work that needs attention comes before completed returns.
        </p>
      ) : null}
      <ul className="returns-attention-summary" aria-label="Returns and refund summary">
        <SummaryStat label="Needs attention" value={count(view.rows, "needs_attention")} tone="attention" />
        <SummaryStat label="Waiting for confirmation" value={count(view.rows, "awaiting_reconciliation")} tone="closing" />
        <SummaryStat label="Pending" value={count(view.rows, "pending")} />
        <SummaryStat label="Completed" value={count(view.rows, "informational")} />
      </ul>
      {(Object.keys(PRIORITY_LABEL) as Array<keyof typeof PRIORITY_LABEL>).map((priority) => {
        const rows = view.rows.filter((row) => row.priority === priority);
        if (rows.length === 0) return null;
        const headingId = `returns-attention-${priority}`;
        return (
          <section className="stack" aria-labelledby={headingId} key={priority}>
            <h2 id={headingId}>{PRIORITY_LABEL[priority]}</h2>
            <div className="returns-attention-list">
              {rows.map((row) => <AttentionCard key={row.id} row={row} onChanged={onChanged} />)}
            </div>
          </section>
        );
      })}
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
    <li className={tone ? `returns-attention-stat ${tone}` : "returns-attention-stat"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  );
}

function AttentionCard({
  row,
  onChanged,
}: {
  readonly row: ManagementReturnsAttentionItem;
  readonly onChanged?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const location = row.locationName ?? row.locationId;
  const register = row.registerName ?? row.registerId;

  async function approve() {
    if (!row.returnId || pending) return;
    setPending(true);
    setActionError(null);
    const result = await approveManagementReturn(row.returnId);
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    setNotice("Manager approval recorded. The cashier can continue the same return.");
    onChanged?.();
  }

  async function reconcile() {
    if (!row.refundId || pending) return;
    setPending(true);
    setActionError(null);
    const result = await reconcileManagementRefund(row.refundId);
    setPending(false);
    if (!result.ok) {
      setActionError(result.error.message);
      return;
    }
    setNotice(`Refund check finished. Status: ${paymentStatusLabel(result.data.status)}.`);
    onChanged?.();
  }
  return (
    <article
      className="card card-pad returns-attention-card"
      data-attention-priority={row.priority}
      data-attention-category={row.category}
      data-layout="attention-card"
    >
      <div className="returns-attention-card-main">
        <div className="stack">
          <div className="returns-attention-head">
            <div>
              <h3>{row.statusLabel}</h3>
              <p>{location}{register ? ` · ${register}` : ""}</p>
            </div>
            <span className={statusClass(row.priority)}>{PRIORITY_LABEL[row.priority]}</span>
          </div>
          <p>{row.summary}</p>
          <p>{INTERVENTION_LABEL[row.intervention]}</p>
          <p>{row.approvalState === "recorded"
            ? "Manager approval recorded. The cashier can continue the same return."
            : row.nextAction}</p>
          {notice ? <p role="status">{notice}</p> : null}
          {actionError ? <div className="banner danger" role="alert">{actionError}</div> : null}
          {row.canApprove && row.returnId ? (
            <button className="btn primary" type="button" disabled={pending} onClick={() => void approve()}>
              {pending ? "Approving…" : "Approve return"}
            </button>
          ) : null}
          {row.canReconcile && row.refundId ? (
            <button className="btn" type="button" disabled={pending} onClick={() => void reconcile()}>
              {pending ? "Checking…" : "Check refund"}
            </button>
          ) : null}
        </div>
        <div className="returns-attention-facts">
          {row.amount ? (
            <p><span>Amount</span><strong>{formatMoneyLabel(row.amount)}</strong></p>
          ) : null}
          {row.operationLabel ? <p><span>Work</span><strong>{row.operationLabel}</strong></p> : null}
        </div>
      </div>
      <details>
        <summary>Reference</summary>
        {row.returnId ? <p className="muted">Return {row.returnId}</p> : null}
        {row.saleId ? <p className="muted">Sale {row.saleId}</p> : null}
        {row.transactionId ? <p className="muted">Transaction {row.transactionId}</p> : null}
        {row.refundId ? <p className="muted">Refund {row.refundId}</p> : null}
      </details>
    </article>
  );
}

function statusClass(priority: ManagementReturnsAttentionItem["priority"]): string {
  if (priority === "needs_attention") return "status-pill danger";
  if (priority === "awaiting_reconciliation") return "status-pill warning";
  return "status-pill neutral";
}

function scopeCopy(view: ManagementReturnsAttentionView): string {
  if (view.scope.kind === "organization") return "Showing returns and refunds for the whole organization.";
  const names = [...new Set(view.rows.map((row) => row.locationName).filter((name): name is string => Boolean(name)))];
  if (names.length === 1) return `Showing returns and refunds for ${names[0]}.`;
  if (names.length > 1) return `Showing returns and refunds for ${names.join(", ")}.`;
  return "Showing returns and refunds only for locations you manage.";
}

function count(
  rows: readonly ManagementReturnsAttentionItem[],
  priority: ManagementReturnsAttentionItem["priority"],
): number {
  return rows.filter((row) => row.priority === priority).length;
}
