"use client";

import { useState, type ReactNode } from "react";
import type { ManagementLocation } from "../../server/admin/management-topology-directory";
import { ManagementLoading } from "./ManagementLoading";

export type TopologyChange =
  | {
      readonly kind: "location";
      readonly locationId?: string;
      readonly name: string;
      readonly status: "active" | "inactive";
    }
  | {
      readonly kind: "register";
      readonly registerId?: string;
      readonly locationId: string;
      readonly name: string;
      readonly currency?: string;
      readonly status: "active" | "disabled" | "maintenance";
    }
  | {
      readonly kind: "device";
      readonly deviceId?: string;
      readonly locationId: string;
      readonly label: string;
      readonly status: "active" | "inactive";
    };

export function TopologyPanel({
  rows,
  mode,
  loading,
  saving,
  errorMessage,
  canManage = false,
  onSave,
}: {
  readonly rows: readonly ManagementLocation[];
  readonly mode: "locations" | "registers" | "devices";
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  readonly canManage?: boolean;
  readonly onSave?: (change: TopologyChange) => void;
}) {
  if (loading) {
    return <ManagementLoading message={`Loading ${mode}…`} />;
  }
  if (errorMessage) {
    return <section className="card card-pad"><div className="banner danger" role="alert">{errorMessage}</div></section>;
  }
  if (rows.length === 0 && !canManage) {
    return <section className="card card-pad"><p>No {mode} are visible in your management access.</p></section>;
  }

  if (mode === "locations") {
    return (
      <div className="stack">
        {canManage && onSave ? (
          <CreateCard title="Add location" saving={saving}>
            {(draft) => (
              <button
                type="button"
                className="btn primary"
                disabled={saving || draft.trim().length === 0}
                onClick={() => onSave({ kind: "location", name: draft, status: "active" })}
              >
                {saving ? "Saving…" : "Add location"}
              </button>
            )}
          </CreateCard>
        ) : null}
        <div className="management-grid">
          {rows.map((location) => (
            <section className="card card-pad stack" key={location.id}>
              <div className="management-staff-head">
                <h2>{location.name}</h2>
                <span className={location.status === "inactive" ? "status-pill warning" : "status-pill success"}>
                  {location.status === "inactive" ? "Inactive" : "Active"}
                </span>
              </div>
              <p>{location.registers.length} register{location.registers.length === 1 ? "" : "s"}</p>
              {canManage && onSave ? (
                <LocationEditor location={location} saving={saving} onSave={onSave} />
              ) : (
                <p className="muted">Location changes are limited to an organization owner or admin.</p>
              )}
              <details className="management-reference">
                <summary>Reference</summary>
                <p className="muted">Location ID {location.id}</p>
              </details>
            </section>
          ))}
        </div>
      </div>
    );
  }

  if (mode === "registers") {
    return (
      <div className="stack">
        {canManage && onSave ? (
          <RegisterCreate rows={rows} saving={saving} onSave={onSave} />
        ) : null}
        <div className="management-grid">
          {rows.flatMap((location) =>
            location.registers.map((register) => (
              <section className="card card-pad stack" key={register.id}>
                <div className="management-staff-head">
                  <div>
                    <h2>{register.name}</h2>
                    <p className="muted">{location.name}</p>
                  </div>
                  <span className={register.status === "active" ? "status-pill success" : "status-pill warning"}>
                    {statusLabel(register.status)}
                  </span>
                </div>
                <p>Currency: {register.currency}</p>
                <p className="muted">Currency stays the same after the register is created.</p>
                {register.status === "active" &&
                location.devices.filter((device) => device.status === "active").length === 0 ? (
                  <div className="banner warning" role="status">
                    Cannot open a shift until this location has an active POS device.
                  </div>
                ) : null}
                {canManage && onSave ? (
                  <RegisterEditor locationId={location.id} register={register} saving={saving} onSave={onSave} />
                ) : null}
                <details className="management-reference">
                  <summary>Reference</summary>
                  <p className="muted">Register ID {register.id}</p>
                </details>
              </section>
            )),
          )}
        </div>
      </div>
    );
  }

  const devices = rows.flatMap((location) =>
    location.devices.map((device) => ({ location, device })),
  );
  return (
    <div className="stack">
      {canManage && onSave ? <DeviceCreate rows={rows} saving={saving} onSave={onSave} /> : null}
      <div className="management-grid">
        {devices.map(({ location, device }) => (
          <section className="card card-pad stack" key={device.id}>
            <div className="management-staff-head">
              <div>
                <h2>{device.label}</h2>
                <p className="muted">{location.name}</p>
              </div>
              <span className={device.status === "active" ? "status-pill success" : "status-pill warning"}>
                {statusLabel(device.status)}
              </span>
            </div>
            <p className="muted">This device is assigned to the location and is not linked to a specific register.</p>
            {canManage && onSave ? (
              <DeviceEditor rows={rows} locationId={location.id} device={device} saving={saving} onSave={onSave} />
            ) : null}
            <details className="management-reference">
              <summary>Reference</summary>
              <p className="muted">Device ID {device.id}</p>
            </details>
          </section>
        ))}
      </div>
    </div>
  );
}

function CreateCard({
  title,
  saving,
  children,
}: {
  readonly title: string;
  readonly saving?: boolean;
  readonly children: (draft: string) => ReactNode;
}) {
  const [draft, setDraft] = useState("");
  return (
    <section className="card card-pad stack management-topology-create" aria-busy={saving}>
      <h2>{title}</h2>
      <label className="field">
        Name
        <input className="input" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={saving} />
      </label>
      {children(draft)}
    </section>
  );
}

function LocationEditor({
  location,
  saving,
  onSave,
}: {
  readonly location: ManagementLocation;
  readonly saving?: boolean;
  readonly onSave: (change: TopologyChange) => void;
}) {
  const [name, setName] = useState(location.name);
  const [status, setStatus] = useState<"active" | "inactive">(location.status === "inactive" ? "inactive" : "active");
  return (
    <form
      className="management-topology-form"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind: "location", locationId: location.id, name, status });
      }}
    >
      <label className="field">
        Location name
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
      </label>
      <label className="field">
        Status
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value === "inactive" ? "inactive" : "active")} disabled={saving}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
      <button type="submit" className="btn" disabled={saving || name.trim().length === 0}>{saving ? "Saving…" : "Save location"}</button>
    </form>
  );
}

function RegisterCreate({
  rows,
  saving,
  onSave,
}: {
  readonly rows: readonly ManagementLocation[];
  readonly saving?: boolean;
  readonly onSave: (change: TopologyChange) => void;
}) {
  const [locationId, setLocationId] = useState(rows[0]?.id ?? "");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("GHS");
  return (
    <form
      className="card card-pad management-topology-form"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind: "register", locationId, name, currency, status: "active" });
        setName("");
      }}
    >
      <h2>Add register</h2>
      <label className="field">
        Location
        <select className="input" value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={saving}>
          {rows.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </label>
      <label className="field">
        Register name
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
      </label>
      <label className="field">
        Currency
        <input className="input" value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} disabled={saving} />
      </label>
      <p className="muted">Currency cannot be changed after the register is created.</p>
      <button type="submit" className="btn primary" disabled={saving || !locationId || name.trim().length === 0 || !/^[A-Z]{3}$/.test(currency)}>
        {saving ? "Saving…" : "Add register"}
      </button>
    </form>
  );
}

function RegisterEditor({
  locationId,
  register,
  saving,
  onSave,
}: {
  readonly locationId: string;
  readonly register: ManagementLocation["registers"][number];
  readonly saving?: boolean;
  readonly onSave: (change: TopologyChange) => void;
}) {
  const [name, setName] = useState(register.name);
  const [status, setStatus] = useState(register.status);
  return (
    <form
      className="management-topology-form"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind: "register", registerId: register.id, locationId, name, status });
      }}
    >
      <label className="field">
        Register name
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={saving} />
      </label>
      <label className="field">
        Status
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value as typeof status)} disabled={saving}>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </label>
      <button type="submit" className="btn" disabled={saving || name.trim().length === 0}>{saving ? "Saving…" : "Save register"}</button>
    </form>
  );
}

function DeviceCreate({
  rows,
  saving,
  onSave,
}: {
  readonly rows: readonly ManagementLocation[];
  readonly saving?: boolean;
  readonly onSave: (change: TopologyChange) => void;
}) {
  const [locationId, setLocationId] = useState(rows[0]?.id ?? "");
  const [label, setLabel] = useState("");
  return (
    <form
      className="card card-pad management-topology-form"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind: "device", locationId, label, status: "active" });
        setLabel("");
      }}
    >
      <h2>Add device</h2>
      <label className="field">
        Location
        <select className="input" value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={saving}>
          {rows.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </label>
      <label className="field">
        Device name
        <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} disabled={saving} />
      </label>
      <button type="submit" className="btn primary" disabled={saving || !locationId || label.trim().length === 0}>{saving ? "Saving…" : "Add device"}</button>
    </form>
  );
}

function DeviceEditor({
  rows,
  locationId,
  device,
  saving,
  onSave,
}: {
  readonly rows: readonly ManagementLocation[];
  readonly locationId: string;
  readonly device: ManagementLocation["devices"][number];
  readonly saving?: boolean;
  readonly onSave: (change: TopologyChange) => void;
}) {
  const [label, setLabel] = useState(device.label);
  const [nextLocationId, setNextLocationId] = useState(locationId);
  const [status, setStatus] = useState(device.status);
  return (
    <form
      className="management-topology-form"
      aria-busy={saving}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ kind: "device", deviceId: device.id, locationId: nextLocationId, label, status });
      }}
    >
      <label className="field">
        Device name
        <input className="input" value={label} onChange={(event) => setLabel(event.target.value)} disabled={saving} />
      </label>
      <label className="field">
        Location
        <select className="input" value={nextLocationId} onChange={(event) => setNextLocationId(event.target.value)} disabled={saving}>
          {rows.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </label>
      <label className="field">
        Status
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value === "inactive" ? "inactive" : "active")} disabled={saving}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </label>
      <button type="submit" className="btn" disabled={saving || label.trim().length === 0}>{saving ? "Saving…" : "Save device"}</button>
    </form>
  );
}

function statusLabel(status: string): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}
