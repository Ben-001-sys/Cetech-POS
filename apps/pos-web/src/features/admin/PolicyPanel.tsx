"use client";

import { useState } from "react";
import type { ShiftClosePolicyOverride } from "../../server/auth/policy";
import type { OperationalPolicyView } from "../../server/admin/handle-operational-policy";
import { parseDecimalToMinorUnits } from "../register/parseDecimalToMinorUnits";
import { ManagementLoading } from "./ManagementLoading";

export type PolicyScopeChoice = {
  readonly id: string;
  readonly label: string;
};

export function PolicyPanel({
  view,
  loading,
  saving,
  errorMessage,
  onSave,
  scopes = [],
  selectedScopeId,
  onSelectScope,
}: {
  readonly view: OperationalPolicyView | null;
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  readonly onSave?: (override: ShiftClosePolicyOverride) => void;
  readonly scopes?: readonly PolicyScopeChoice[];
  readonly selectedScopeId?: string;
  readonly onSelectScope?: (id: string) => void;
}) {
  if (loading) {
    return <ManagementLoading message="Loading operational rules…" />;
  }
  if (errorMessage) {
    return <section className="card card-pad"><div className="banner danger" role="alert">{errorMessage}</div></section>;
  }
  if (!view) {
    return <section className="card card-pad"><p>Operational rules are not available.</p></section>;
  }

  const editorKey = [
    view.scope.organizationId,
    view.scope.locationId ?? "",
    view.scope.registerId ?? "",
    view.effective.cashierCanCloseShift,
    view.effective.managerCanCloseShift,
    view.effective.cashierOwnShiftOnly,
    view.effective.managerCanCloseOthersShift,
    view.effective.nonZeroVarianceRequiresManager,
    view.effective.varianceToleranceMinor ?? "",
    view.effective.varianceCurrency ?? "",
    view.effective.returnApprovalRequired,
  ].join(":");

  return (
    <div className="stack">
      {scopes.length > 0 ? (
        <label className="field">
          <span>Configure rules for</span>
          <select
            className="input"
            value={selectedScopeId ?? scopes[0]?.id}
            onChange={(event) => onSelectScope?.(event.target.value)}
          >
            {scopes.map((scope) => (
              <option key={scope.id} value={scope.id}>{scope.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      <PolicyEditor
        key={editorKey}
        view={view}
        saving={saving}
        onSave={onSave}
      />
    </div>
  );
}

function PolicyEditor({
  view,
  saving,
  onSave,
}: {
  readonly view: OperationalPolicyView;
  readonly saving?: boolean;
  readonly onSave?: (override: ShiftClosePolicyOverride) => void;
}) {
  const [draft, setDraft] = useState<ShiftClosePolicyOverride>(() => ({
    cashierCanCloseShift: view.effective.cashierCanCloseShift,
    managerCanCloseShift: view.effective.managerCanCloseShift,
    cashierOwnShiftOnly: view.effective.cashierOwnShiftOnly,
    managerCanCloseOthersShift: view.effective.managerCanCloseOthersShift,
    nonZeroVarianceRequiresManager: view.effective.nonZeroVarianceRequiresManager,
    returnApprovalRequired: view.effective.returnApprovalRequired,
    ...(view.effective.varianceToleranceMinor !== undefined
      ? { varianceToleranceMinor: view.effective.varianceToleranceMinor }
      : {}),
    ...(view.effective.varianceCurrency
      ? { varianceCurrency: view.effective.varianceCurrency }
      : {}),
  }));
  const [toleranceText, setToleranceText] = useState(
    ((view.effective.varianceToleranceMinor ?? 0) / 100).toFixed(2),
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const currency = view.effective.varianceCurrency ?? "GHS";

  function setBoolean(key: keyof ShiftClosePolicyOverride, value: boolean) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit() {
    const parsed = parseDecimalToMinorUnits(toleranceText, {
      emptyMessage: "Enter a variance tolerance.",
    });
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    setLocalError(null);
    onSave?.({
      cashierCanCloseShift: draft.cashierCanCloseShift ?? view.effective.cashierCanCloseShift,
      managerCanCloseShift: draft.managerCanCloseShift ?? view.effective.managerCanCloseShift,
      cashierOwnShiftOnly: draft.cashierOwnShiftOnly ?? view.effective.cashierOwnShiftOnly,
      managerCanCloseOthersShift:
        draft.managerCanCloseOthersShift ?? view.effective.managerCanCloseOthersShift,
      nonZeroVarianceRequiresManager:
        draft.nonZeroVarianceRequiresManager ??
        view.effective.nonZeroVarianceRequiresManager,
      varianceToleranceMinor: parsed.minor,
      varianceCurrency: currency,
      returnApprovalRequired:
        draft.returnApprovalRequired ?? view.effective.returnApprovalRequired,
    });
  }

  return (
    <section className="card card-pad stack management-policy" aria-busy={saving}>
      <div className="management-policy-head">
        <div>
          <h2>Shift closing</h2>
          <p className="muted">
            Applies to: {view.scope.registerId
              ? "this register"
              : view.scope.locationId
                ? "this location"
                : "organization default"}
            . {view.valueSource === "explicit"
              ? "These values are saved for this scope."
              : "These values are inherited. Saving creates an override for this scope."}
          </p>
        </div>
        <span className="status-pill">{view.canManage ? "Editable" : "Read only"}</span>
      </div>

      <label className="management-policy-row">
        <span>
          <strong>Cashier may close shift</strong>
          <small>Allows a cashier to submit shift close when other rules permit it.</small>
        </span>
        <input
          type="checkbox"
          checked={draft.cashierCanCloseShift ?? view.effective.cashierCanCloseShift}
          disabled={!view.canManage || saving}
          onChange={(event) => setBoolean("cashierCanCloseShift", event.target.checked)}
        />
      </label>

      <label className="management-policy-row">
        <span>
          <strong>Manager may close shift</strong>
          <small>Allows operational managers to close shifts in their assigned scope.</small>
        </span>
        <input
          type="checkbox"
          checked={draft.managerCanCloseShift ?? view.effective.managerCanCloseShift}
          disabled={!view.canManage || saving}
          onChange={(event) => setBoolean("managerCanCloseShift", event.target.checked)}
        />
      </label>

      <label className="management-policy-row">
        <span>
          <strong>Cashier can close only their own shift</strong>
          <small>Prevents a cashier from closing a shift opened by another staff member.</small>
        </span>
        <input
          type="checkbox"
          checked={draft.cashierOwnShiftOnly ?? view.effective.cashierOwnShiftOnly}
          disabled={!view.canManage || saving}
          onChange={(event) => setBoolean("cashierOwnShiftOnly", event.target.checked)}
        />
      </label>

      <label className="management-policy-row">
        <span>
          <strong>Manager may close another staff member&apos;s shift</strong>
          <small>Applies only inside the manager&apos;s authorized location/register scope.</small>
        </span>
        <input
          type="checkbox"
          checked={
            draft.managerCanCloseOthersShift ??
            view.effective.managerCanCloseOthersShift
          }
          disabled={!view.canManage || saving}
          onChange={(event) =>
            setBoolean("managerCanCloseOthersShift", event.target.checked)
          }
        />
      </label>

      <label className="management-policy-row">
        <span>
          <strong>Cash difference requires manager review</strong>
          <small>Cashier shift close needs manager review when the drawer difference exceeds the allowed amount.</small>
        </span>
        <input
          type="checkbox"
          checked={
            draft.nonZeroVarianceRequiresManager ??
            view.effective.nonZeroVarianceRequiresManager
          }
          disabled={!view.canManage || saving}
          onChange={(event) =>
            setBoolean("nonZeroVarianceRequiresManager", event.target.checked)
          }
        />
      </label>

      <label className="field">
        <span>Allowed cash difference ({currency})</span>
        <input
          className="input"
          inputMode="decimal"
          value={toleranceText}
          disabled={!view.canManage || saving}
          onChange={(event) => {
            setToleranceText(event.target.value);
            setLocalError(null);
          }}
        />
      </label>

      {localError ? <div className="banner danger" role="alert">{localError}</div> : null}

      <div className="settings-divider" />

      <div className="stack">
        <h3>Return approval</h3>
        <label className="management-policy-row">
          <span>
            <strong>Require manager approval before completing a return</strong>
            <small>
              New returns covered by these rules wait for a manager approval before completion. Approval does not refund a payment or change stock. Checking an existing refund is a separate step.
            </small>
          </span>
          <input
            type="checkbox"
            checked={draft.returnApprovalRequired ?? view.effective.returnApprovalRequired}
            disabled={!view.canManage || saving}
            onChange={(event) => setBoolean("returnApprovalRequired", event.target.checked)}
          />
        </label>
      </div>

      {view.canManage && onSave ? (
        <button className="btn primary" type="button" disabled={saving} onClick={submit}>
          {saving ? "Saving…" : "Save operational rules"}
        </button>
      ) : (
        <div className="banner warning" role="status">
          You can review these rules, but only an Owner or Admin can change them.
        </div>
      )}
    </section>
  );
}
