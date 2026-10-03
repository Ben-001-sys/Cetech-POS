"use client";

import { useState, type FormEvent } from "react";
import { parseDecimalToMinorUnits } from "./parseDecimalToMinorUnits";

export type RegisterChoice = {
  readonly id: string;
  readonly name: string;
  readonly locationLabel?: string;
};

export type DeviceChoice = {
  readonly id: string;
  readonly label: string;
};

export type OpenRegisterSubmit = {
  readonly registerId: string;
  readonly openingFloatMinor: number;
};

export type OpenRegisterFormProps = {
  registers: readonly RegisterChoice[];
  selectedRegisterId?: string;
  onRegisterChange?: (registerId: string) => void;
  devices?: readonly DeviceChoice[];
  selectedDeviceId?: string;
  onDeviceChange?: (deviceId: string) => void;
  devicesLoading?: boolean;
  deviceErrorMessage?: string;
  openingFloat?: string;
  onOpeningFloatChange?: (value: string) => void;
  currencyLabel?: string;
  online?: boolean;
  submitting?: boolean;
  errorMessage?: string;
  onSubmit?: (input: OpenRegisterSubmit) => void;
};

export function OpenRegisterForm({
  registers,
  selectedRegisterId,
  onRegisterChange,
  devices,
  selectedDeviceId,
  onDeviceChange,
  devicesLoading = false,
  deviceErrorMessage,
  openingFloat,
  onOpeningFloatChange,
  currencyLabel = "Opening cash",
  online = true,
  submitting = false,
  errorMessage,
  onSubmit,
}: OpenRegisterFormProps) {
  const [uncontrolledFloat, setUncontrolledFloat] = useState("500.00");
  const [uncontrolledRegister, setUncontrolledRegister] = useState(registers[0]?.id ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const floatValue = openingFloat ?? uncontrolledFloat;
  const registerId = selectedRegisterId !== undefined ? selectedRegisterId : uncontrolledRegister;
  const deviceRequired = devices !== undefined;
  const deviceId = selectedDeviceId ?? "";
  const canSubmit =
    online &&
    !submitting &&
    !devicesLoading &&
    Boolean(registerId) &&
    (!deviceRequired || Boolean(deviceId)) &&
    Boolean(onSubmit);
  const needsExplicitChoice = registerId === "" && registers.length > 1;
  const needsExplicitDeviceChoice = deviceRequired && deviceId === "" && (devices?.length ?? 0) > 1;

  function handleFloatChange(value: string) {
    setLocalError(null);
    if (onOpeningFloatChange) onOpeningFloatChange(value);
    else setUncontrolledFloat(value);
  }

  function handleRegisterChange(value: string) {
    if (onRegisterChange) onRegisterChange(value);
    else setUncontrolledRegister(value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;
    const parsed = parseDecimalToMinorUnits(floatValue);
    if (!parsed.ok) {
      setLocalError(parsed.message);
      return;
    }
    onSubmit?.({ registerId, openingFloatMinor: parsed.minor });
  }

  return (
    <div className="register-open-workspace">
      <div className="page-head">
        <div>
          <h1>Register</h1>
          <p>Select a register and open a shift before taking payment.</p>
        </div>
      </div>
      <section className="card card-pad register-open" aria-labelledby="open-register-title">
        <h2 id="open-register-title">
          Open register
        </h2>
        <form className="stack" onSubmit={handleSubmit} aria-busy={submitting}>
          <div className="field">
            <label htmlFor="register-select">Register</label>
            <select
              className="select"
              id="register-select"
              value={registerId}
              onChange={(event) => handleRegisterChange(event.target.value)}
              disabled={submitting || registers.length === 0}
            >
              {registers.length === 0 ? <option value="">No registers available</option> : null}
              {needsExplicitChoice ? <option value="">Select a register</option> : null}
              {registers.map((register) => (
                <option key={register.id} value={register.id}>
                  {register.locationLabel ? `${register.name} · ${register.locationLabel}` : register.name}
                </option>
              ))}
            </select>
          </div>

          {deviceRequired ? (
            <div className="field">
              <label htmlFor="device-select">POS device</label>
              <select
                className="select"
                id="device-select"
                value={deviceId}
                onChange={(event) => onDeviceChange?.(event.target.value)}
                disabled={submitting || devicesLoading || (devices?.length ?? 0) === 0}
              >
                {devicesLoading ? <option value="">Checking devices…</option> : null}
                {!devicesLoading && (devices?.length ?? 0) === 0 ? (
                  <option value="">No active device available</option>
                ) : null}
                {needsExplicitDeviceChoice ? <option value="">Select a device</option> : null}
                {(devices ?? []).map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.label}
                  </option>
                ))}
              </select>
              <div className="muted">
                Only active devices assigned to this register location can open a shift.
              </div>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="opening-float">{currencyLabel}</label>
            <input
              className="input"
              id="opening-float"
              inputMode="decimal"
              value={floatValue}
              onChange={(event) => handleFloatChange(event.target.value)}
              aria-describedby={localError ? "opening-help opening-error" : "opening-help"}
              aria-invalid={Boolean(localError)}
              disabled={submitting}
            />
            <div className="muted" id="opening-help">
              Recorded as the opening float for the shift.
            </div>
          </div>

          {deviceErrorMessage ? (
            <div className="banner warning" role="status">
              {deviceErrorMessage}
            </div>
          ) : null}
          {(localError || errorMessage) ? (
            <div className="banner danger" role="alert" id="opening-error">
              {localError || errorMessage}
            </div>
          ) : null}
          <button className="btn primary" type="submit" disabled={!canSubmit}>
            {submitting ? "Opening…" : "Open register"}
          </button>
          {!online ? (
            <div className="banner warning" role="status">
              Connection required to open a register.
            </div>
          ) : null}
        </form>
      </section>
    </div>
  );
}
