"use client";

import { useMemo, type FormEvent } from "react";
import { cashConfirmEnabled, evaluateCashReceived } from "../state/cashChange";
import { cashTenderSuggestions } from "../state/cashTenderSuggestions";
import { formatMinorDecimal, type PreparedSaleView } from "../state/checkoutSession";
import { formatMoneyDisplay } from "../state/quotePresentation";

export function CashPaymentForm({
  prepared,
  cashReceived,
  onCashReceivedChange,
  inputError,
  busy,
  onBack,
  onConfirm,
}: {
  prepared: PreparedSaleView;
  cashReceived: string;
  onCashReceivedChange: (value: string) => void;
  inputError?: string;
  busy: boolean;
  onBack: () => void;
  onConfirm: (value: string) => void;
}) {
  const evaluation = useMemo(
    () =>
      evaluateCashReceived({
        raw: cashReceived,
        dueMinor: prepared.total.minor,
        currency: prepared.total.currency,
      }),
    [cashReceived, prepared.total.currency, prepared.total.minor],
  );
  const suggestions = useMemo(() => cashTenderSuggestions(prepared.total.minor), [prepared.total.minor]);
  const confirmEnabled = cashConfirmEnabled(evaluation, { busy, prepared: true });
  const validationMessage =
    inputError ??
    (evaluation.kind === "invalid" ? evaluation.message : evaluation.kind === "under" ? evaluation.message : undefined);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirmEnabled) {
      return;
    }
    onConfirm(cashReceived);
  }

  return (
    <form className="cash-payment stack" onSubmit={handleSubmit}>
      <div className="cash-amount-due">
        <span className="muted">Amount due</span>
        <div className="big-money cash-total" data-checkout-due="prepared">
          {formatMoneyDisplay(prepared.total)}
        </div>
      </div>
      <div className="field">
        <label htmlFor="cash-received">Cash received</label>
        <input
          id="cash-received"
          className="input cash-received-input"
          inputMode="decimal"
          value={cashReceived}
          disabled={busy}
          autoComplete="off"
          autoFocus
          data-autofocus-primary=""
          onChange={(event) => onCashReceivedChange(event.target.value)}
          aria-invalid={validationMessage ? true : undefined}
          aria-describedby={validationMessage ? "cash-received-error" : undefined}
        />
        {validationMessage ? (
          <div id="cash-received-error" className="qty-error" role="alert">
            {validationMessage}
          </div>
        ) : null}
      </div>
      <div className="change-due-row">
        <span>Change due</span>
        <strong data-change-due="">
          {evaluation.kind === "ready" ? formatMoneyDisplay({ minor: evaluation.changeDueMinor, currency: prepared.total.currency }) : formatMoneyDisplay({ minor: 0, currency: prepared.total.currency })}
        </strong>
      </div>
      <div className="tender-shortcuts">
        <button
          type="button"
          className="btn small"
          disabled={busy}
          onClick={() => onCashReceivedChange(formatMinorDecimal(prepared.total.minor))}
        >
          Exact
        </button>
        {suggestions.map((minor) => (
          <button
            key={minor}
            type="button"
            className="btn small"
            disabled={busy}
            onClick={() => onCashReceivedChange(formatMinorDecimal(minor))}
          >
            {formatMoneyDisplay({ minor, currency: prepared.total.currency })}
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="btn" disabled={busy} onClick={onBack}>
          Back
        </button>
        <button type="submit" className="btn primary" disabled={!confirmEnabled}>
          Confirm cash
        </button>
      </div>
    </form>
  );
}
