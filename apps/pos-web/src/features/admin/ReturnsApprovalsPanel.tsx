"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { ManagementReturnDetailView } from "../../server/admin/handle-management-return-detail";
import type { ManagementReturnsAttentionItem, ManagementReturnsAttentionView } from "../../server/admin/management-returns-attention-directory";
import { approveManagementReturn, reconcileManagementRefund } from "../../app/management-client";
import { formatMoneyLabel, paymentStatusLabel } from "../../ui/cashier-language";
import { ManagementLoading } from "./ManagementLoading";

const PRIORITY_LABEL = {
  needs_attention: "Needs attention",
  awaiting_reconciliation: "Waiting for confirmation",
  pending: "Pending",
  informational: "History",
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
  onReviewReturn,
}: {
  readonly view: ManagementReturnsAttentionView | null;
  readonly loading?: boolean;
  readonly errorMessage?: string;
  readonly correlationId?: string;
  readonly onChanged?: () => void;
  readonly onReviewReturn?: (returnId: string) => Promise<ApiResult<ManagementReturnDetailView>>;
}) {
  if (loading) {
    return <ManagementLoading message="Loading returns and refunds…" {...{ variant: "returns" as const }} />;
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
      <p className="muted">Counts are work items. One return can have separate refund and stock items; previews are not approvals.</p>
      {view.truncated ? (
        <p className="muted">
          This view is limited to {view.limit} items. Work that needs attention comes before completed returns.
        </p>
      ) : null}
      <ul className="returns-attention-summary" aria-label="Returns and refund summary">
        <SummaryStat label="Needs attention" value={count(view.rows, "needs_attention")} tone="attention" />
        <SummaryStat label="Waiting for confirmation" value={count(view.rows, "awaiting_reconciliation")} tone="closing" />
        <SummaryStat label="Pending" value={count(view.rows, "pending")} />
        <SummaryStat label="History" value={count(view.rows, "informational")} />
      </ul>
      {(Object.keys(PRIORITY_LABEL) as Array<keyof typeof PRIORITY_LABEL>).map((priority) => {
        const rows = view.rows.filter((row) => row.priority === priority);
        if (rows.length === 0) return null;
        const headingId = `returns-attention-${priority}`;
        return (
          <section className="stack" aria-labelledby={headingId} key={priority}>
            <h2 id={headingId}>{PRIORITY_LABEL[priority]}</h2>
            <div className="returns-attention-list">
              {rows.map((row) => <AttentionCard key={`${row.id}:${row.organizationId}:${row.locationId}:${row.registerId ?? ""}:${row.saleId ?? ""}`} row={row} onChanged={onChanged} onReviewReturn={onReviewReturn} />)}
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
  onReviewReturn,
}: {
  readonly row: ManagementReturnsAttentionItem;
  readonly onChanged?: () => void;
  readonly onReviewReturn?: (returnId: string) => Promise<ApiResult<ManagementReturnDetailView>>;
}) {
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ManagementReturnDetailView | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewCapabilityUnconfirmed, setReviewCapabilityUnconfirmed] = useState(false);
  const mounted = useRef(false);
  const reviewSequence = useRef(0);
  const location = row.locationName ?? row.locationId;
  const register = row.registerName ?? row.registerId;
  const currentDetail = detail && detailMatchesRow(detail, row) ? detail : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      reviewSequence.current += 1;
    };
  }, [row.returnId, row.organizationId, row.locationId, row.registerId, row.saleId]);

  async function review() {
    if (!row.returnId || !onReviewReturn || reviewing) return;
    const sequence = ++reviewSequence.current;
    setDetail(null);
    setReviewCapabilityUnconfirmed(true);
    setReviewing(true);
    setReviewError(null);
    try {
      const result = await onReviewReturn(row.returnId);
      if (!mounted.current || sequence !== reviewSequence.current) return;
      if (!result.ok) {
        setReviewError(result.error.message);
        if (result.error.code === "AUTH_REQUIRED" || result.error.code === "FORBIDDEN") onChanged?.();
      } else if (!detailMatchesRow(result.data, row)) {
        setReviewError("The saved return reference did not match. Refresh this list and review the same return.");
      } else {
        setDetail(result.data);
        setReviewCapabilityUnconfirmed(false);
      }
    } catch {
      if (mounted.current && sequence === reviewSequence.current) {
        setReviewError("Saved return details could not be loaded. Try reviewing the same return again.");
      }
    } finally {
      if (mounted.current && sequence === reviewSequence.current) setReviewing(false);
    }
  }

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
    setDetail(null);
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
    setDetail(null);
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
          <p>{row.approvalState === "recorded" && row.previewState === "current"
            ? "Manager approval recorded. The cashier can continue the same return."
            : row.nextAction}</p>
          {row.actionUnavailableReason ? <p className="muted">{row.actionUnavailableReason}</p> : null}
          {row.reviewUnavailableReason ? <p className="muted">{row.reviewUnavailableReason}</p> : null}
          {row.previewExpiresAt && row.previewState ? (
            <p className="muted">Preview {row.previewState === "expired" ? "expired" : "expires"}: <time dateTime={row.previewExpiresAt}>{formatSavedTime(row.previewExpiresAt)}</time></p>
          ) : null}
          {notice ? <p role="status">{notice}</p> : null}
          {actionError ? <div className="banner danger" role="alert">{actionError}</div> : null}
          {row.canApprove && !reviewCapabilityUnconfirmed && (!currentDetail || currentDetail.canApprove) && row.returnId ? (
            <button className="btn primary" type="button" disabled={pending} onClick={() => void approve()}>
              {pending ? "Approving…" : "Approve return"}
            </button>
          ) : null}
          {row.canReconcile && !reviewCapabilityUnconfirmed && row.refundId ? (
            <button className="btn" type="button" disabled={pending} onClick={() => void reconcile()}>
              {pending ? "Checking…" : "Check refund"}
            </button>
          ) : null}
          {row.canReview && row.returnId && onReviewReturn ? (
            <button className="btn" type="button" disabled={reviewing} onClick={() => void review()}>
              {reviewing ? "Loading saved return…" : currentDetail ? "Refresh return details" : "Review existing return"}
            </button>
          ) : null}
          {reviewError ? <div className="banner danger" role="alert">{reviewError}</div> : null}
        </div>
        <div className="returns-attention-facts">
          {row.amount ? (
            <p><span>Amount</span><strong>{formatMoneyLabel(row.amount)}</strong></p>
          ) : null}
          {row.operationLabel ? <p><span>Work</span><strong>{row.operationLabel}</strong></p> : null}
        </div>
      </div>
      {currentDetail ? (
        <div className="stack">
          <ManagementReturnDetail detail={currentDetail} />
          <button className="btn" type="button" onClick={() => setDetail(null)}>Close return details</button>
        </div>
      ) : null}
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

function detailMatchesRow(detail: ManagementReturnDetailView, row: ManagementReturnsAttentionItem): boolean {
  return detail.returnId === row.returnId
    && detail.locationId === row.locationId
    && (!row.registerId || detail.registerId === row.registerId)
    && (!row.saleId || detail.saleId === row.saleId);
}

export function ManagementReturnDetail({ detail }: { readonly detail: ManagementReturnDetailView }) {
  return (
    <section className="management-return-detail card card-pad stack" aria-label="Existing return details" data-return-detail={detail.returnId}>
      <h4>Existing return · {detail.saleReference ?? detail.saleId}</h4>
      <p>{detail.statusLabel} · {formatMoneyLabel(detail.refundTotal)}</p>
      <p>{detail.locationName ?? detail.locationId} · {detail.registerName ?? detail.registerId}</p>
      <p className="muted">Reviewing these saved records does not send a refund or change stock.</p>
      {detail.actionUnavailableReason ? <p className="banner warning">{detail.actionUnavailableReason}</p> : null}
      {detail.previewState ? <p>Preview {detail.previewState === "expired" ? "expired" : "expires"}: {formatSavedTime(detail.previewExpiresAt)}</p> : null}
      <h5>Return items</h5>
      {detail.lines.length > 0 ? (
        <ul className="management-return-lines stack">
          {detail.lines.map((line) => (
            <li key={line.orderLineId} className="stack">
              <strong>{line.quantity} × {line.name ?? "Saved sale item"}</strong>
              <span>Reason: {line.reason}</span>
              <span>Condition: {CONDITION_LABELS[line.condition]}</span>
              <span>{line.intendedDisposition === "restock_sellable" ? "Planned stock handling: return to sellable stock" : "Planned stock handling: do not automatically restock"}</span>
              <span>Allocated refund: {formatMoneyLabel(line.allocatedAmount)}</span>
              {!line.name ? <span className="muted">Item reference: {line.orderLineId}. The saved item name is unavailable.</span> : null}
            </li>
          ))}
        </ul>
      ) : <p>No saved item details are available. Keep this existing return for review.</p>}
      <h5>Refund and stock records</h5>
      {detail.effects.length > 0 ? (
        <ul className="management-return-effects stack">
          {detail.effects.map((effect) => (
            <li key={effect.kind} className="stack">
              <strong>{effect.label} · {effectStatusLabel(effect.status)}</strong>
              {effect.amount ? <span>{formatMoneyLabel(effect.amount)}</span> : null}
              {effect.message ? <span>{effect.message}</span> : null}
              <details><summary>Record reference</summary><span>{effect.effectId}</span></details>
            </li>
          ))}
        </ul>
      ) : <p>No saved refund or stock records are available. This does not confirm a refund or stock change.</p>}
      {detail.executed && detail.persistedStatus !== "completed" ? (
        <p className="banner warning">Keep this existing return. Use Check return status in the original Returns workflow; do not refund the customer again or create a replacement stock change.</p>
      ) : null}
    </section>
  );
}

const CONDITION_LABELS: Record<ManagementReturnDetailView["lines"][number]["condition"], string> = {
  resellable: "Resellable",
  opened_resellable: "Opened, resellable",
  damaged: "Damaged",
  defective: "Defective",
  quarantine: "Quarantine",
  not_physically_returned: "Not physically returned",
};

function effectStatusLabel(status: string): string {
  if (status === "verified" || status === "completed") return "Completed";
  if (status === "not_required") return "Not required";
  if (status === "not_started") return "Not started";
  if (status === "not_found") return "Record not found";
  return paymentStatusLabel(status);
}

function formatSavedTime(value: string): string {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Time unavailable";
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
