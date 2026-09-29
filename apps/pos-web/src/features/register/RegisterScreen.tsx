"use client";

import { CloseShiftForm } from "./CloseShiftForm";
import { OpenRegisterForm, type OpenRegisterFormProps, type RegisterChoice } from "./OpenRegisterForm";
import { formatMoneyDisplay } from "../sell/state/quotePresentation";
import { describeShiftStatus, formatSignedMoneyDisplay, type ShiftWorkspaceView } from "./shiftView";

export function RegisterScreen({
  openForm,
  session,
  inFlight,
  onOpen,
  onClose,
  onShowXReport,
  onBindApproval,
  closePresentation,
}: {
  openForm: OpenRegisterFormProps;
  session: ShiftWorkspaceView;
  inFlight: boolean;
  onOpen?: (openingFloatMinor: number) => void;
  onClose?: (countedCashText: string) => void;
  onShowXReport?: () => void;
  onBindApproval?: () => void;
  closePresentation?: { readonly showClose: boolean; readonly notice: string };
}) {
  const copy = describeShiftStatus(session.status);
  const showOpen = session.status === "no_open_shift" || session.status === "opening";
  const showClose = (session.status === "open" || session.status === "closing")
    && (closePresentation?.showClose ?? false);
  const showClosed = session.status === "closed";
  const showAttention = session.status === "requires_attention";

  return (
    <div className="register-screen" data-shift-status={session.status} data-close-succeeded={session.closeSucceeded ? "true" : "false"}>
      {showOpen ? (
        <OpenRegisterForm
          {...openForm}
          submitting={inFlight || session.status === "opening" || openForm.submitting}
          errorMessage={session.inputError ?? session.message !== copy.status ? session.inputError ?? openForm.errorMessage : openForm.errorMessage}
          onSubmit={
            onOpen
              ? (input) => {
                  onOpen(input.openingFloatMinor);
                }
              : openForm.onSubmit
          }
        />
      ) : null}
      {!showOpen ? (
        <div className="page-head">
          <div>
            <h1>{copy.title}</h1>
            <p role="status">{session.message || copy.status}</p>
          </div>
        </div>
      ) : null}
      {session.status === "open" ? (
        <section className="card card-pad">
          <p className="muted">{session.registerName ?? "Shift open"}</p>
          <WorkingRegister choices={openForm.registers} selectedId={openForm.selectedRegisterId} onSelect={openForm.onRegisterChange} />
          {onShowXReport ? (
            <button type="button" className="btn" disabled={inFlight} onClick={onShowXReport}>
              View shift summary (X report)
            </button>
          ) : null}
        </section>
      ) : null}
      {(session.status === "open" || session.status === "closing") && closePresentation?.notice ? (
        <p className="muted" role="status">{closePresentation.notice}</p>
      ) : null}
      {showClose ? (
        <CloseShiftForm
          submitting={inFlight || session.status === "closing"}
          errorMessage={session.inputError}
          onSubmit={onClose}
        />
      ) : null}
      {showAttention ? (
        <div className="banner warning" role="alert" data-shift-attention="">
          This shift needs manager review. It is not closed.
          {onBindApproval ? (
            <button type="button" className="btn" disabled={inFlight} onClick={onBindApproval}>
              Request manager approval
            </button>
          ) : (
            <span> Manager approval is required.</span>
          )}
        </div>
      ) : null}
      {session.reportPhase === "loading" ? (
        <section className="card card-pad" data-shift-report="loading" role="status">
          {session.report?.kind === "Z" || session.status === "closed"
            ? "Loading the end-of-shift report."
            : "Loading the shift summary."}
        </section>
      ) : null}
      {session.reportPhase === "empty" ? (
        <section className="card card-pad" data-shift-report="empty" role="status">
          No shift totals are available for this report.
        </section>
      ) : null}
      {session.reportPhase === "error" ? (
        <div className="banner danger" role="alert" data-shift-report="error">
          {session.message || "The shift summary could not be loaded."}
        </div>
      ) : null}
      {session.report && session.reportPhase === "ready" && session.report.kind === "X" && (session.status === "open" || session.status === "closing") ? (
        <section className="card card-pad" data-x-report="" data-shift-report="ready">
          <strong>Shift summary (X report)</strong>
          <div data-x-expected="">Expected {formatMoneyDisplay(session.report.expectedCash)}</div>
          {session.report.countedCash ? (
            <div>Counted {formatMoneyDisplay(session.report.countedCash)}</div>
          ) : null}
          {session.report.variance ? (
            <div>Variance {formatSignedMoneyDisplay(session.report.variance)}</div>
          ) : null}
          <p className="muted">This is a live summary. The shift stays open.</p>
        </section>
      ) : null}
      {showClosed ? (
        <section className="card card-pad" data-shift-closed="">
          <div className="banner success" role="status">
            Shift closed successfully.
          </div>
          {session.countedCash ? (
            <div data-closed-counted="">
              Counted {formatMoneyDisplay(session.countedCash)}
            </div>
          ) : null}
          {session.expectedCash ? (
            <div data-closed-expected="" data-expected-cash-editable="false">
              Expected {formatMoneyDisplay(session.expectedCash)}
            </div>
          ) : null}
          {session.variance ? (
            <div data-closed-variance="">Variance {formatSignedMoneyDisplay(session.variance)}</div>
          ) : null}
        </section>
      ) : null}
      {session.report && session.status === "closed" && session.report.kind === "Z" && session.reportPhase !== "loading" && session.reportPhase !== "error" && session.reportPhase !== "empty" ? (
        <section className="card card-pad" data-z-report="">
          <strong>End-of-shift report (Z report)</strong>
          <div>Expected {formatMoneyDisplay(session.report.expectedCash)}</div>
          {session.report.countedCash ? <div>Counted {formatMoneyDisplay(session.report.countedCash)}</div> : null}
          {session.report.variance ? <div>Variance {formatSignedMoneyDisplay(session.report.variance)}</div> : null}
        </section>
      ) : null}
    </div>
  );
}

function WorkingRegister({
  choices,
  selectedId,
  onSelect,
}: {
  readonly choices: readonly RegisterChoice[];
  readonly selectedId?: string;
  readonly onSelect?: (registerId: string) => void;
}) {
  if (choices.length === 0) return null;
  const current = choices.find((choice) => choice.id === selectedId);
  return (
    <div className="field" data-working-register="">
      <label htmlFor="working-register">Working register</label>
      {current?.locationLabel ? <p>{current.locationLabel}</p> : null}
      {choices.length > 1 && onSelect ? (
        <select
          className="select"
          id="working-register"
          value={selectedId ?? ""}
          onChange={(event) => onSelect(event.target.value)}
        >
          {selectedId ? null : <option value="">Select a register</option>}
          {choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.locationLabel ? `${choice.name} · ${choice.locationLabel}` : choice.name}
            </option>
          ))}
        </select>
      ) : (
        <p id="working-register">{current?.name ?? "Assigned register"}</p>
      )}
    </div>
  );
}
