"use client";

import { useState, type FormEvent } from "react";
import { parseDecimalToMinorUnits } from "./parseDecimalToMinorUnits";

export function CloseShiftForm({
  currencyLabel = "Cash counted",
  submitting = false,
  errorMessage,
  onSubmit,
}: {
  currencyLabel?: string;
  submitting?: boolean;
  errorMessage?: string;
  onSubmit?: (countedCashText: string) => void;
}) {
  const [counted, setCounted] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const canSubmit = Boolean(onSubmit) && !submitting;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const parsed = parseDecimalToMinorUnits(counted, { emptyMessage: "Enter the counted cash." });
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    setLocalError(null);
    onSubmit?.(counted);
  }

  return (
    <section className="card card-pad register-close" aria-labelledby="close-register-title" data-blind-close="true">
      <h2 id="close-register-title">End shift</h2>
      <div className="banner info" role="status">
        <strong>Count drawer cash</strong>
        <span>Enter what you counted. Expected cash will be shown after you finish.</span>
      </div>
      <form className="stack" onSubmit={handleSubmit} aria-busy={submitting}>
        <div className="field">
          <label htmlFor="closing-count">{currencyLabel}</label>
          <input
            className="input"
            id="closing-count"
            name="countedCash"
            inputMode="decimal"
            value={counted}
            disabled={submitting}
            onChange={(event) => {
              setLocalError(null);
              setCounted(event.target.value);
            }}
            aria-describedby={localError ? "closing-count-help closing-count-error" : "closing-count-help"}
            aria-invalid={Boolean(localError)}
          />
          <div className="muted" id="closing-count-help">
            {"Enter what you counted. We'll compare your count with the expected cash after you end the shift."}
          </div>
        </div>
        {(localError || errorMessage) ? (
          <div className="banner danger" role="alert" id="closing-count-error">
            {localError || errorMessage}
          </div>
        ) : null}
        <button className="btn primary" type="submit" disabled={!canSubmit}>
          {submitting ? "Ending…" : "End shift"}
        </button>
      </form>
    </section>
  );
}
