"use client";

import { useMemo, useState } from "react";
import type { StaffAssignmentRole } from "../../server/auth/roles";
import type { OrganizationControlRole } from "../../server/auth/policy";
import type { StaffAccessLocation, StaffAccessRecord } from "../../server/admin/staff-access-directory";
import type { ManagementLocation } from "../../server/admin/management-topology-directory";
import { ManagementLoading } from "./ManagementLoading";

export function StaffAccessPanel({
  rows,
  topology = [],
  canManage = false,
  managedLocationIds = [],
  loading,
  savingActorId,
  errorMessage,
  callerControlRole,
  currentActorId,
  onSaveAssignment,
  onSaveControlMembership,
  onSaveAccessStatus,
  onResetTemporaryPassword,
  inviting = false,
  onInviteStaff,
  onCreateStaff,
}: {
  readonly rows: readonly StaffAccessRecord[];
  readonly topology?: readonly ManagementLocation[];
  readonly canManage?: boolean;
  readonly managedLocationIds?: readonly string[];
  readonly loading?: boolean;
  readonly savingActorId?: string | null;
  readonly errorMessage?: string;
  readonly callerControlRole?: OrganizationControlRole | null;
  readonly currentActorId?: string;
  readonly onSaveAssignment?: (input: {
    readonly actorId: string;
    readonly locationId: string;
    readonly role: StaffAssignmentRole;
    readonly registerIds: readonly string[];
  }) => void;
  readonly onSaveControlMembership?: (input: {
    readonly actorId: string;
    readonly controlRole: OrganizationControlRole;
    readonly status: "active" | "disabled";
  }) => void;
  readonly onSaveAccessStatus?: (input: {
    readonly actorId: string;
    readonly status: "active" | "disabled";
    readonly reason?: string;
  }) => void;
  readonly onResetTemporaryPassword?: (input: {
    readonly actorId: string;
    readonly temporaryPassword: string;
  }) => void;
  readonly inviting?: boolean;
  readonly onInviteStaff?: (input: {
    readonly email: string;
    readonly displayName: string;
  }) => void;
  readonly onCreateStaff?: (input: {
    readonly email: string;
    readonly displayName: string;
    readonly temporaryPassword: string;
    readonly controlRole: "owner" | "admin" | "support" | null;
    readonly locations: readonly {
      readonly locationId: string;
      readonly role: "cashier" | "manager";
      readonly registerIds: readonly string[];
    }[];
    readonly enableAccess: boolean;
  }) => void;
}) {
  const [filter, setFilter] = useState<"all" | "active" | "inactive" | "unlinked">("all");
  const visibleRows = rows.filter((row) => {
    const linked = hasLinkedIdentity(row);
    const active = linked && row.authStatus === "active" && (row.posAccessStatus ?? "active") === "active";
    return filter === "all" || (filter === "unlinked" ? !linked : filter === "active" ? active : linked && !active);
  });
  if (loading) {
    return <ManagementLoading variant="staff" showCreate={canManage && Boolean(onInviteStaff && onCreateStaff)} message="Loading staff access…" />;
  }
  const addStaff = canManage && onInviteStaff && onCreateStaff ? (
    <AddStaffCard
      inviting={inviting}
      callerControlRole={callerControlRole}
      topology={topology}
      onInvite={onInviteStaff}
      onCreate={onCreateStaff}
    />
  ) : null;

  return (
    <div className="management-staff-list">
      {errorMessage ? <section className="card card-pad"><div className="banner danger" role="alert">{errorMessage}</div></section> : null}
      {addStaff}
      <section className="card card-pad stack">
        <label className="stack">
          Show staff
          <select className="select" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
            <option value="all">All staff and references</option>
            <option value="active">Active staff</option>
            <option value="inactive">Inactive staff</option>
            <option value="unlinked">Unlinked references</option>
          </select>
        </label>
        <p className="muted">Deactivating staff removes their POS access and signs them out. Their sales, shifts and activity history stay available.</p>
        {!canManage ? (
          <p className="muted">Owners and Admins manage staff accounts. Managers may change register access for staff already assigned to their locations.</p>
        ) : null}
        <p role="status" className="muted">Showing {visibleRows.length} of {rows.length} staff records.</p>
      </section>
      {visibleRows.length === 0 ? (
        <section className="card card-pad"><p>{rows.length === 0 ? errorMessage ? "Staff records are unavailable while this request cannot be checked." : "No staff records are visible in your management scope." : "No staff match this view. Choose another view to see their retained records."}</p></section>
      ) : null}
      {visibleRows.map((row) => (
        <StaffCard
          key={row.actorId}
          row={row}
          topology={topology}
          canManage={canManage}
          managedLocationIds={managedLocationIds}
          callerControlRole={callerControlRole}
          currentActorId={currentActorId}
          saving={savingActorId === row.actorId}
          onSaveAssignment={onSaveAssignment}
          onSaveControlMembership={onSaveControlMembership}
          onSaveAccessStatus={onSaveAccessStatus}
          onResetTemporaryPassword={onResetTemporaryPassword}
        />
      ))}
    </div>
  );
}

function StaffCard({
  row,
  topology,
  canManage,
  managedLocationIds,
  callerControlRole,
  currentActorId,
  saving,
  onSaveAssignment,
  onSaveControlMembership,
  onSaveAccessStatus,
  onResetTemporaryPassword,
}: {
  readonly row: StaffAccessRecord;
  readonly topology: readonly ManagementLocation[];
  readonly canManage: boolean;
  readonly managedLocationIds: readonly string[];
  readonly callerControlRole?: OrganizationControlRole | null;
  readonly currentActorId?: string;
  readonly saving: boolean;
  readonly onSaveAssignment?: (input: {
    readonly actorId: string;
    readonly locationId: string;
    readonly role: StaffAssignmentRole;
    readonly registerIds: readonly string[];
  }) => void;
  readonly onSaveControlMembership?: (input: {
    readonly actorId: string;
    readonly controlRole: OrganizationControlRole;
    readonly status: "active" | "disabled";
  }) => void;
  readonly onSaveAccessStatus?: (input: {
    readonly actorId: string;
    readonly status: "active" | "disabled";
    readonly reason?: string;
  }) => void;
  readonly onResetTemporaryPassword?: (input: {
    readonly actorId: string;
    readonly temporaryPassword: string;
  }) => void;
}) {
  const linked = hasLinkedIdentity(row);
  const firstUnassigned = topology.find(
    (location) => !row.locations.some((assignment) => assignment.locationId === location.id),
  );
  return (
    <section className="card card-pad stack management-staff-card" aria-busy={saving}>
      <div className="management-staff-head">
        <div>
          <h2>{linked ? row.displayName : "Unlinked staff reference"}</h2>
          <p className="muted">{linked ? row.email ? `Sign-in email: ${row.email}` : "No sign-in email is recorded for this account." : "No matching login account was found. This reference is retained for access and activity history."}</p>
          {linked && row.lastSignInAt ? <p className="muted">Last sign-in: <time dateTime={row.lastSignInAt}>{signInTime(row.lastSignInAt)}</time></p> : null}
        </div>
        <div className="management-staff-statuses">
          <span className={row.authStatus === "active" ? "status-pill success" : "status-pill warning"}>
            {linked ? `Login account ${row.authStatus}` : "Login account not linked"}
          </span>
          <span className={(row.posAccessStatus ?? "active") === "active" ? "status-pill success" : "status-pill warning"}>
            POS access {row.posAccessStatus ?? "active"}
          </span>
        </div>
      </div>
      <div className="management-meta-grid">
        <ControlRoleEditor
          row={row}
          callerControlRole={callerControlRole}
          currentActorId={currentActorId}
          saving={saving}
          onSave={linked ? onSaveControlMembership : undefined}
        />
        <details className="management-reference">
          <summary>Reference</summary>
          <p className="muted">Staff ID {row.actorId}</p>
        </details>
      </div>

      {canManage && onSaveAccessStatus ? (
        <StaffAccessStatusEditor
          row={row}
          currentActorId={currentActorId}
          callerControlRole={callerControlRole}
          saving={saving}
          onSave={onSaveAccessStatus}
        />
      ) : null}

      {canManage && linked && onResetTemporaryPassword ? (
        callerControlRole === "admin" && row.controlRole === "owner" ? (
          <p className="muted">An admin cannot reset an owner password.</p>
        ) : (
          <PasswordResetEditor actorId={row.actorId} saving={saving} onSave={onResetTemporaryPassword} />
        )
      ) : null}
      {!linked ? <p className="muted">A password cannot be reset for this reference. Ask an Owner or Admin to check its identity mapping before restoring access.</p> : null}

      <div className="stack">
        <strong>Location and register assignments</strong>
        {row.locations.length === 0 ? <p className="muted">No location assignment.</p> : null}
        {row.locations.map((assignment) => (
          <AssignmentEditor
            key={assignment.locationId}
            actorId={row.actorId}
            assignment={assignment}
            location={topology.find((item) => item.id === assignment.locationId)}
            canManage={canManage && linked}
            registersOnly={linked && !canManage && managedLocationIds.includes(assignment.locationId) && row.actorId !== currentActorId}
            saving={saving}
            onSave={onSaveAssignment}
          />
        ))}
        {canManage && linked && firstUnassigned && onSaveAssignment ? (
          <NewAssignmentEditor
            actorId={row.actorId}
            topology={topology}
            initialLocationId={firstUnassigned.id}
            saving={saving}
            onSave={onSaveAssignment}
          />
        ) : null}
      </div>
    </section>
  );
}

function AssignmentEditor({
  actorId,
  assignment,
  location,
  canManage,
  registersOnly = false,
  saving,
  onSave,
}: {
  readonly actorId: string;
  readonly assignment: StaffAccessLocation;
  readonly location?: ManagementLocation;
  readonly canManage: boolean;
  readonly registersOnly?: boolean;
  readonly saving: boolean;
  readonly onSave?: (input: {
    readonly actorId: string;
    readonly locationId: string;
    readonly role: StaffAssignmentRole;
    readonly registerIds: readonly string[];
  }) => void;
}) {
  const [role, setRole] = useState<StaffAssignmentRole>(assignment.role);
  const [registerIds, setRegisterIds] = useState<readonly string[]>(assignment.registerIds);
  const choices = location?.registers ?? [];
  const editable = canManage || registersOnly;
  return (
    <div className="management-assignment-editor">
      <div className="management-assignment-title">
        <div>
          <strong>{location?.name ?? assignment.locationId}</strong>
          <span className="muted">{assignment.locationId}</span>
        </div>
        <select
          className="select"
          value={role}
          disabled={!canManage || saving}
          onChange={(event) => setRole(event.target.value as StaffAssignmentRole)}
        >
          <option value="cashier">Cashier</option>
          <option value="manager">Manager</option>
        </select>
      </div>
      <div className="management-register-checks">
        {choices.length === 0 ? (
          <span className="muted">No registers are available at this location.</span>
        ) : choices.map((register) => {
          const alreadyAssigned = registerIds.includes(register.id);
          const unavailableForNewAssignment = register.status !== "active" && !alreadyAssigned;
          return (
            <label key={register.id}>
              <input
                type="checkbox"
                checked={alreadyAssigned}
                disabled={!editable || saving || unavailableForNewAssignment}
                onChange={(event) => {
                  setRegisterIds((current) =>
                    event.target.checked
                      ? [...new Set([...current, register.id])]
                      : current.filter((id) => id !== register.id),
                  );
                }}
              />
              <span>
                {register.name}
                {register.status !== "active" ? ` · ${statusLabel(register.status)}` : ""}
              </span>
            </label>
          );
        })}
      </div>
      {editable && onSave ? (
        <button
          className="btn small"
          type="button"
          disabled={saving}
          onClick={() => onSave({
            actorId,
            locationId: assignment.locationId,
            role: registersOnly ? assignment.role : role,
            registerIds,
          })}
        >
          {saving ? "Saving…" : "Save assignment"}
        </button>
      ) : null}
    </div>
  );
}

function NewAssignmentEditor({
  actorId,
  topology,
  initialLocationId,
  saving,
  onSave,
}: {
  readonly actorId: string;
  readonly topology: readonly ManagementLocation[];
  readonly initialLocationId: string;
  readonly saving: boolean;
  readonly onSave: (input: {
    readonly actorId: string;
    readonly locationId: string;
    readonly role: StaffAssignmentRole;
    readonly registerIds: readonly string[];
  }) => void;
}) {
  const activeTopology = useMemo(
    () => topology.filter((item) => item.status !== "inactive"),
    [topology],
  );
  const initialActiveLocationId = activeTopology.some((item) => item.id === initialLocationId)
    ? initialLocationId
    : activeTopology[0]?.id ?? "";
  const [locationId, setLocationId] = useState(initialActiveLocationId);
  const [role, setRole] = useState<StaffAssignmentRole>("cashier");
  const [registerIds, setRegisterIds] = useState<readonly string[]>([]);
  const location = useMemo(
    () => activeTopology.find((item) => item.id === locationId),
    [activeTopology, locationId],
  );
  return (
    <div className="management-assignment-editor new">
      <strong>Add location assignment</strong>
      <div className="management-assignment-title">
        <select
          className="select"
          value={locationId}
          disabled={saving}
          onChange={(event) => {
            setLocationId(event.target.value);
            setRegisterIds([]);
          }}
        >
          {activeTopology.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select
          className="select"
          value={role}
          disabled={saving}
          onChange={(event) => setRole(event.target.value as StaffAssignmentRole)}
        >
          <option value="cashier">Cashier</option>
          <option value="manager">Manager</option>
        </select>
      </div>
      <div className="management-register-checks">
        {(location?.registers ?? []).filter((register) => register.status === "active").map((register) => (
          <label key={register.id}>
            <input
              type="checkbox"
              checked={registerIds.includes(register.id)}
              disabled={saving}
              onChange={(event) => {
                setRegisterIds((current) =>
                  event.target.checked
                    ? [...new Set([...current, register.id])]
                    : current.filter((id) => id !== register.id),
                );
              }}
            />
            <span>{register.name}</span>
          </label>
        ))}
      </div>
      <button
        className="btn small primary"
        type="button"
        disabled={saving || !locationId}
        onClick={() => onSave({ actorId, locationId, role, registerIds })}
      >
        {saving ? "Saving…" : "Add assignment"}
      </button>
    </div>
  );
}


function ControlRoleEditor({
  row,
  callerControlRole,
  currentActorId,
  saving,
  onSave,
}: {
  readonly row: StaffAccessRecord;
  readonly callerControlRole?: OrganizationControlRole | null;
  readonly currentActorId?: string;
  readonly saving: boolean;
  readonly onSave?: (input: {
    readonly actorId: string;
    readonly controlRole: OrganizationControlRole;
    readonly status: "active" | "disabled";
  }) => void;
}) {
  const canEditOwner = callerControlRole === "owner";
  const targetIsOwner = row.controlRole === "owner";
  const canEdit =
    Boolean(onSave) &&
    (callerControlRole === "owner" ||
      (callerControlRole === "admin" && !targetIsOwner));

  const [draft, setDraft] = useState<"none" | OrganizationControlRole>(
    row.controlRole ?? "none",
  );

  const options: Array<"none" | OrganizationControlRole> =
    callerControlRole === "owner"
      ? ["none", "owner", "admin", "support"]
      : ["none", "admin", "support"];

  function save() {
    if (!onSave || !canEdit) return;
    if (draft === "none") {
      if (!row.controlRole) return;
      onSave({
        actorId: row.actorId,
        controlRole: row.controlRole,
        status: "disabled",
      });
      return;
    }
    onSave({
      actorId: row.actorId,
      controlRole: draft,
      status: "active",
    });
  }

  return (
    <div className="management-control-role">
      <span className="label">Organization role</span>
      {canEdit ? (
        <div className="management-control-role-edit">
          <select
            className="select"
            value={draft}
            disabled={saving}
            onChange={(event) =>
              setDraft(event.target.value as "none" | OrganizationControlRole)
            }
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {value === "none"
                  ? "No organization role"
                  : value[0]!.toUpperCase() + value.slice(1)}
              </option>
            ))}
          </select>
          <button
            className="btn small"
            type="button"
            disabled={
              saving ||
              draft === (row.controlRole ?? "none") ||
              (draft === "owner" && !canEditOwner)
            }
            onClick={save}
          >
            {saving ? "Saving…" : "Save role"}
          </button>
        </div>
      ) : (
        <strong>{row.controlRole ?? "No organization role"}</strong>
      )}
      {currentActorId === row.actorId && row.controlRole === "owner" ? (
        <small className="muted">At least one Owner must remain active.</small>
      ) : null}
    </div>
  );
}


function StaffAccessStatusEditor({
  row,
  currentActorId,
  callerControlRole,
  saving,
  onSave,
}: {
  readonly row: StaffAccessRecord;
  readonly currentActorId?: string;
  readonly callerControlRole?: OrganizationControlRole | null;
  readonly saving: boolean;
  readonly onSave: (input: {
    readonly actorId: string;
    readonly status: "active" | "disabled";
    readonly reason?: string;
  }) => void;
}) {
  const status = row.posAccessStatus ?? "active";
  const [confirming, setConfirming] = useState(false);
  const cannotDisable = currentActorId === row.actorId || row.controlRole === "owner";
  const next = status === "active" ? "disabled" : "active";
  const ownerProtectedFromAdmin = callerControlRole === "admin" && row.controlRole === "owner";
  const cannotReactivate = !hasLinkedIdentity(row) || row.authStatus !== "active" || ownerProtectedFromAdmin;
  return (
    <div className="management-access-control">
      <div>
        <strong>Staff access</strong>
        <small className="muted">
          Deactivation signs this staff member out and blocks new POS sign-in. It keeps their sales, shifts, assignments and activity history.
        </small>
        {cannotDisable && next === "disabled" ? <p className="muted">{currentActorId === row.actorId ? "You cannot deactivate your own current management access." : "Transfer or remove Owner authority before deactivating this staff member."}</p> : null}
        {cannotReactivate && next === "active" ? <p className="muted">{ownerProtectedFromAdmin ? "Only an Owner can reactivate another Owner's POS access." : "Restore a linked, active login account before reactivating POS access."}</p> : null}
      </div>
      <button
        className={next === "disabled" ? "btn small" : "btn small primary"}
        type="button"
        disabled={saving || confirming || (next === "disabled" ? cannotDisable : cannotReactivate)}
        onClick={() =>
          next === "disabled" ? setConfirming(true) : onSave({
            actorId: row.actorId,
            status: next,
          })
        }
      >
        {saving ? "Saving…" : next === "disabled" ? "Deactivate staff" : "Reactivate staff"}
      </button>
      {confirming && next === "disabled" ? (
        <div className="stack" role="group" aria-label="Confirm staff deactivation">
          <p>Deactivate {hasLinkedIdentity(row) ? row.displayName : "this staff reference"}? Active POS sessions will end. Historical records will remain.</p>
          <div className="row">
            <button className="btn small" type="button" disabled={saving} onClick={() => setConfirming(false)}>Keep active</button>
            <button className="btn small" type="button" disabled={saving} onClick={() => {
              setConfirming(false);
              onSave({ actorId: row.actorId, status: "disabled", reason: "Staff deactivated from POS management; history retained" });
            }}>Confirm deactivation</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function hasLinkedIdentity(row: StaffAccessRecord): boolean {
  return row.identityStatus !== "unlinked" && row.authStatus !== "unknown";
}

function signInTime(value: string): string {
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "Not available" : `${time.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}


function PasswordResetEditor({
  actorId,
  saving,
  onSave,
}: {
  readonly actorId: string;
  readonly saving: boolean;
  readonly onSave: (input: { readonly actorId: string; readonly temporaryPassword: string }) => void;
}) {
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        if (!confirmed) return;
        onSave({ actorId, temporaryPassword });
        setTemporaryPassword("");
        setConfirmed(false);
      }}
    >
      <strong>Temporary password</strong>
      <p className="muted">Sets a temporary password, requires a new password at the next sign-in, and signs this staff member out of the POS.</p>
      <label className="stack">
        Temporary password
        <input
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          value={temporaryPassword}
          onChange={(event) => setTemporaryPassword(event.target.value)}
          disabled={saving}
        />
      </label>
      <div className="row">
        <button type="button" className="btn" disabled={saving} onClick={() => setShowPassword((value) => !value)}>
          {showPassword ? "Hide password" : "Show password"}
        </button>
        <button
          type="button"
          className="btn"
          disabled={saving}
          onClick={() => {
            const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
            const bytes = crypto.getRandomValues(new Uint8Array(18));
            const body = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
            setTemporaryPassword(`Aa7${body}`);
            setShowPassword(true);
          }}
        >
          Generate strong password
        </button>
      </div>
      <label className="row">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={saving} />
        I have shared this temporary password with the staff member through a safe channel.
      </label>
      <button type="submit" className="btn" disabled={saving || !confirmed || temporaryPassword.length < 12}>
        Reset temporary password
      </button>
    </form>
  );
}

function AddStaffCard({
  inviting,
  callerControlRole,
  topology,
  onInvite,
  onCreate,
}: {
  readonly inviting: boolean;
  readonly callerControlRole?: "owner" | "admin" | "support" | null;
  readonly topology: readonly ManagementLocation[];
  readonly onInvite: (input: { readonly email: string; readonly displayName: string }) => void;
  readonly onCreate: (input: {
    readonly email: string;
    readonly displayName: string;
    readonly temporaryPassword: string;
    readonly controlRole: "owner" | "admin" | "support" | null;
    readonly locations: readonly {
      readonly locationId: string;
      readonly role: "cashier" | "manager";
      readonly registerIds: readonly string[];
    }[];
    readonly enableAccess: boolean;
  }) => void;
}) {
  const activeTopology = useMemo(
    () => topology.filter((item) => item.status !== "inactive"),
    [topology],
  );
  const [method, setMethod] = useState<"create" | "invite">("create");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [controlRole, setControlRole] = useState<"" | "admin" | "support" | "owner">("");
  const [locationId, setLocationId] = useState(activeTopology[0]?.id ?? "");
  const [role, setRole] = useState<"cashier" | "manager">("cashier");
  const [registerId, setRegisterId] = useState(
    activeTopology[0]?.registers.find((item) => item.status === "active")?.id ?? "",
  );
  const [enableAccess, setEnableAccess] = useState(true);
  const [localError, setLocalError] = useState<string | null>(null);
  const location = activeTopology.find((item) => item.id === locationId);

  function submit() {
    const cleanEmail = email.trim();
    const cleanName = displayName.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setLocalError("Enter a valid staff email address.");
      return;
    }
    if (!cleanName) {
      setLocalError("Enter the staff member's name.");
      return;
    }
    if (method === "invite") {
      setLocalError(null);
      onInvite({ email: cleanEmail, displayName: cleanName });
      return;
    }
    if (temporaryPassword.length < 12) {
      setLocalError("Use a temporary password of at least 12 characters.");
      return;
    }
    setLocalError(null);
    onCreate({
      email: cleanEmail,
      displayName: cleanName,
      temporaryPassword,
      controlRole: controlRole || null,
      locations: locationId && registerId
        ? [{ locationId, role, registerIds: [registerId] }]
        : [],
      enableAccess: enableAccess && Boolean((locationId && registerId) || controlRole),
    });
  }

  return (
    <section className="card card-pad stack management-invite-card" aria-busy={inviting}>
      <div>
        <h2>Add staff</h2>
        <p className="muted">Create a login now, or email a secure invitation. POS access stays off until setup succeeds.</p>
      </div>
      <fieldset className="stack">
        <legend>How should this account be created?</legend>
        <label>
          <input type="radio" name="staff-create-method" checked={method === "create"} onChange={() => setMethod("create")} />
          {" "}Create account now
        </label>
        <p className="muted">Create a login and temporary password for this staff member.</p>
        <label>
          <input type="radio" name="staff-create-method" checked={method === "invite"} onChange={() => setMethod("invite")} />
          {" "}Send invitation
        </label>
        <p className="muted">Email the staff member a secure link to complete account setup.</p>
      </fieldset>
      <div className="management-invite-grid">
        <label className="field">
          <span>Name</span>
          <input className="input" value={displayName} disabled={inviting} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" value={email} disabled={inviting} onChange={(event) => setEmail(event.target.value)} />
        </label>
      </div>
      {method === "create" ? (
        <div className="stack">
          <label className="field">
            <span>Temporary password</span>
            <input
              className="input"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={temporaryPassword}
              disabled={inviting}
              onChange={(event) => setTemporaryPassword(event.target.value)}
            />
          </label>
          <div className="row">
            <button className="btn small" type="button" onClick={() => setShowPassword((current) => !current)}>
              {showPassword ? "Hide password" : "Show password"}
            </button>
            <button
              className="btn small"
              type="button"
              onClick={() => {
                const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
                const bytes = crypto.getRandomValues(new Uint8Array(18));
                let body = "";
                for (const byte of bytes) body += alphabet[byte % alphabet.length];
                setTemporaryPassword(`Aa7${body}`);
                setShowPassword(true);
              }}
            >
              Generate strong password
            </button>
          </div>
          <p className="muted">The staff member must change this password at first sign-in.</p>
          <label className="field">
            <span>Organization role</span>
            <select className="input" value={controlRole} disabled={inviting} onChange={(event) => setControlRole(event.target.value as "" | "admin" | "support" | "owner")}>
              <option value="">No organization role</option>
              <option value="admin">Admin</option>
              <option value="support">Support</option>
              {callerControlRole === "owner" ? <option value="owner">Owner</option> : null}
            </select>
          </label>
          <label className="field">
            <span>Location</span>
            <select className="input" value={locationId} disabled={inviting} onChange={(event) => {
              const next = event.target.value;
              setLocationId(next);
              const nextLocation = activeTopology.find((item) => item.id === next);
              setRegisterId(nextLocation?.registers.find((item) => item.status === "active")?.id ?? "");
            }}>
              <option value="">No location access</option>
              {activeTopology.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          {location ? (
            <>
              <label className="field">
                <span>Location role</span>
                <select className="input" value={role} disabled={inviting} onChange={(event) => setRole(event.target.value as "cashier" | "manager")}>
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                </select>
              </label>
              <label className="field">
                <span>Register</span>
                <select className="input" value={registerId} disabled={inviting} onChange={(event) => setRegisterId(event.target.value)}>
                  {location.registers
                    .filter((item) => item.status === "active")
                    .map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            </>
          ) : null}
          <label>
            <input type="checkbox" checked={enableAccess} disabled={inviting} onChange={(event) => setEnableAccess(event.target.checked)} />
            {" "}Turn on POS access after setup succeeds
          </label>
        </div>
      ) : (
        <p className="muted">Invited staff cannot use the POS until you assign their locations and registers and enable POS access.</p>
      )}
      {localError ? <div className="banner danger" role="alert">{localError}</div> : null}
      <button className="btn primary" type="button" disabled={inviting} onClick={submit}>
        {inviting ? "Saving…" : method === "invite" ? "Send invitation" : "Create account"}
      </button>
    </section>
  );
}


function statusLabel(status: string): string {
  if (!status) return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1).replaceAll("_", " ");
}
