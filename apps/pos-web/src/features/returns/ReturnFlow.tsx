"use client";

import { formatMoneyDisplay } from "../sell/state/quotePresentation";
import {
  availableBeforeRequestLabel,
  canPresentReturnComplete,
  conditionLabel,
  conditionRestockNotice,
  describeReturnStage,
  dispositionLabel,
  dispositionPolicyLabel,
  OUTSTANDING_RETURN_COPY,
  returnProgressLines,
  returnSafetyCopy,
  unresolvedEffectLabels,
  type ReturnConditionView,
  type ReturnSessionView,
} from "./returnView";

const CONDITIONS: readonly ReturnConditionView[] = [
  "resellable",
  "opened_resellable",
  "damaged",
  "defective",
  "quarantine",
  "not_physically_returned",
];

function EffectRow({
  line,
  status,
  effectId,
}: {
  line: string;
  status: string;
  effectId?: string;
}) {
  return (
    <div
      className="r-row return-effect-row"
      data-effect-status={status}
      data-effect-id={effectId ?? ""}
      data-refund-identity={line.startsWith("Refund —") ? effectId : undefined}
    >
      <span className="return-effect-label">{line}</span>
    </div>
  );
}

export function ReturnFlow({
  session,
  inFlight,
  onUpdateLine,
  onPreview,
  onExecute,
  onResolve,
}: {
  session: ReturnSessionView;
  inFlight: boolean;
  onUpdateLine: (orderLineId: string, patch: { quantity?: string; reason?: string; condition?: ReturnConditionView }) => void;
  onPreview: () => void;
  onExecute: () => void;
  onResolve: () => void;
}) {
  const copy = describeReturnStage(session.stage);
  const complete = canPresentReturnComplete(session);
  const unresolved = unresolvedEffectLabels(session);
  const locked = session.identityLocked;
  const fieldsDisabled = inFlight || locked;
  const safety = returnSafetyCopy(session);
  const progress = returnProgressLines(session);
  const lockCopyAlreadyShown = (session.message || copy.status).includes(OUTSTANDING_RETURN_COPY);

  return (
    <section
      className="return-flow"
      data-return-stage={session.stage}
      data-return-id={session.returnId ?? ""}
      data-return-complete={complete ? "true" : "false"}
      data-return-identity-locked={locked ? "true" : "false"}
      data-approval-required={session.approvalRequired ? "true" : "false"}
      data-approval-id={session.approvalId ?? ""}
    >
      <h2 id="return-flow-title">{copy.title}</h2>
      <p className="muted" role="status" aria-live="polite">
        {session.message || copy.status}
      </p>
      {locked && !lockCopyAlreadyShown ? (
        <div className="banner warning" role="alert" data-outstanding-return="">
          {OUTSTANDING_RETURN_COPY}
        </div>
      ) : null}
      {session.inputError ? (
        <div className="banner danger" role="alert">
          {session.inputError}
        </div>
      ) : null}
      {session.lines.map((line) => {
        const preview = session.previewLines.find((item) => item.orderLineId === line.orderLineId);
        const restockNotice = conditionRestockNotice(line.condition);
        return (
          <article key={line.orderLineId} className="card card-pad return-line" data-order-line-id={line.orderLineId}>
            <div className="row between">
              <div>
                <strong className="return-product-name">{line.name}</strong>
                <div className="muted">Sold {line.originalSoldQuantity}</div>
              </div>
            </div>
            <div className="grid-3">
              <div className="field">
                <label htmlFor={`return-qty-${line.orderLineId}`}>Quantity to return</label>
                <input
                  id={`return-qty-${line.orderLineId}`}
                  className="input"
                  inputMode="decimal"
                  value={line.quantity}
                  disabled={fieldsDisabled}
                  onChange={(event) => onUpdateLine(line.orderLineId, { quantity: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`return-reason-${line.orderLineId}`}>Reason</label>
                <input
                  id={`return-reason-${line.orderLineId}`}
                  className="input"
                  value={line.reason}
                  disabled={fieldsDisabled}
                  onChange={(event) => onUpdateLine(line.orderLineId, { reason: event.target.value })}
                />
              </div>
              <div className="field">
                <label htmlFor={`return-condition-${line.orderLineId}`}>Condition</label>
                <select
                  id={`return-condition-${line.orderLineId}`}
                  className="select"
                  value={line.condition}
                  disabled={fieldsDisabled}
                  onChange={(event) =>
                    onUpdateLine(line.orderLineId, { condition: event.target.value as ReturnConditionView })
                  }
                >
                  {CONDITIONS.map((condition) => (
                    <option key={condition} value={condition}>
                      {conditionLabel(condition)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {restockNotice ? (
              <div className="banner warning" role="status" data-restock-safety={line.condition}>
                {restockNotice}
              </div>
            ) : (
              <p className="muted">The refund and stock handling are confirmed separately.</p>
            )}
            {preview ? (
              <div
                className="return-preview-line"
                data-remaining-qty={preview.remainingReturnableQuantity}
                data-automatic-sellable={preview.automaticSellableRestock ? "true" : "false"}
                data-intended-disposition={preview.intendedDisposition}
                data-disposition-policy={preview.dispositionPolicy}
              >
                <div>{availableBeforeRequestLabel(preview.remainingReturnableQuantity)}</div>
                <div>
                  Stock handling: {dispositionLabel(preview.intendedDisposition)}
                  {dispositionPolicyLabel(preview.dispositionPolicy) === dispositionLabel(preview.intendedDisposition)
                    ? ""
                    : `. ${dispositionPolicyLabel(preview.dispositionPolicy)}`}
                  {preview.intendedDisposition === "no_automatic_restock" ? ". No automatic restock." : ""}
                </div>
              </div>
            ) : null}
          </article>
        );
      })}
      {session.refundTotal ? (
        <div className="big-money" data-refund-total={String(session.refundTotal.minor)}>
          Refund total {formatMoneyDisplay(session.refundTotal)}
        </div>
      ) : null}
      {session.approvalRequired && !session.approvalId ? (
        <div className="banner warning" role="alert" data-approval-missing="">
          Manager approval is required before you can continue.
        </div>
      ) : null}
      {session.approvalId ? (
        <div className="banner success" role="status" data-bound-approval="">
          Manager approval recorded.
        </div>
      ) : null}
      {progress.length > 0 ? (
        <div className="card card-pad return-effect-card" data-return-effects="">
          <strong>Return progress</strong>
          <div className="return-effect-list">
            {progress.map((row) => (
              <EffectRow key={row.text} line={row.text} status={row.status} effectId={row.effectId} />
            ))}
          </div>
          {safety ? (
            <div className="banner warning return-effect-safety" role="alert" data-return-safety="">
              {safety}
            </div>
          ) : null}
        </div>
      ) : null}
      {!complete && !safety && unresolved.length > 0 ? (
        <div className="banner warning" role="alert" data-return-unresolved="">
          This return is not finished yet. Check the progress above before doing anything else.
        </div>
      ) : null}
      {complete ? (
        <div className="banner success" role="status" data-return-complete-banner="">
          Return completed successfully.
        </div>
      ) : null}
      <div className="dialog-actions">
        {!locked && (session.stage === "selecting" || session.stage === "failed" || session.stage === "previewed" || session.stage === "approval_required") ? (
          <button type="button" className="btn" disabled={inFlight} onClick={onPreview}>
            Review return
          </button>
        ) : null}
        {!locked && (session.stage === "previewed" || session.stage === "approval_required") && session.returnId ? (
          <button type="button" className="btn primary" disabled={inFlight} onClick={onExecute}>
            {session.stage === "approval_required" && !session.approvalId ? "Check approval" : "Complete return"}
          </button>
        ) : null}
        {locked || session.stage === "resolving" || session.stage === "in_progress" || session.stage === "refund_pending" || session.stage === "requires_attention" ? (
          <button type="button" className="btn primary" disabled={inFlight} onClick={onResolve}>
            Check return status
          </button>
        ) : null}
      </div>
    </section>
  );
}
