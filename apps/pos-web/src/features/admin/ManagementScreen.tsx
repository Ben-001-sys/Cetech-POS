"use client";

import type { ReactNode } from "react";
import type { ManagementContext, ManagementSection } from "../../server/admin/management-context";
import type { StaffAccessRecord } from "../../server/admin/staff-access-directory";
import type { OperationalPolicyView } from "../../server/admin/handle-operational-policy";
import type { ManagementLocation } from "../../server/admin/management-topology-directory";
import type { ManagementShiftCashView } from "../../server/admin/management-shift-cash-directory";
import type { ManagementReturnsAttentionView } from "../../server/admin/management-returns-attention-directory";
import type { StaffAssignmentRole } from "../../server/auth/roles";
import type { ShiftClosePolicyOverride } from "../../server/auth/policy";
import { StaffAccessPanel } from "./StaffAccessPanel";
import { PolicyPanel, type PolicyScopeChoice } from "./PolicyPanel";
import { TopologyPanel, type TopologyChange } from "./TopologyPanel";
import { ShiftCashPanel } from "./ShiftCashPanel";
import { ReturnsApprovalsPanel } from "./ReturnsApprovalsPanel";
import { ReceiptSettingsPanel, type ReceiptLocationOption } from "./ReceiptSettingsPanel";
import { SystemHealthPanel } from "./SystemHealthPanel";
import { AuditPanel } from "./AuditPanel";
import type { ManagementSystemHealthView } from "../../server/admin/management-system-health";
import type { ManagementAuditView } from "../../server/admin/management-audit";
import type { ManagementReceiptSettingsView } from "../../server/admin/handle-management-receipt-settings";
import type { ReceiptSettings } from "../../../../../docs/contracts/domain.generated";

const LABELS: Record<ManagementSection, { label: string; description: string }> = {
  overview: { label: "Overview", description: "Current store-management summary." },
  staff_access: { label: "Staff & access", description: "Staff accounts, organization roles, locations and register assignments." },
  locations: { label: "Locations", description: "Store locations and the registers available at each one." },
  registers: { label: "Registers", description: "Registers, status and location." },
  devices: { label: "Devices", description: "POS devices assigned to each location." },
  shifts_cash: { label: "Shifts & cash", description: "Open and closed shifts, cash differences, reports and shift-closing rules." },
  returns_approvals: { label: "Returns & approvals", description: "Returns, approvals and refund checks that need attention." },
  system_health: { label: "System status", description: "Service availability and support details." },
  audit: { label: "Activity log", description: "Who changed what, where and when." },
  policies: { label: "Operational rules", description: "Shift-closing and return-approval rules by organization, location and register." },
  receipt_settings: {
    label: "Receipt settings",
    description: "Receipt branding and presentation by location.",
  },
};

export function ManagementScreen({
  context,
  activeSection = "overview",
  onSelectSection,
  onBackToPos,
  staffRows = [],
  staffLoading = false,
  staffError,
  policyView = null,
  policyLoading = false,
  policySaving = false,
  policyError,
  onSavePolicy,
  policyScopes = [],
  selectedPolicyScopeId,
  onSelectPolicyScope,
  topologyRows = [],
  topologyLoading = false,
  topologySaving = false,
  topologyError,
  onSaveTopology,
  shiftCashView = null,
  shiftCashLoading = false,
  shiftCashError,
  shiftCashCorrelationId,
  shiftCashPolicyLoading = false,
  returnsAttentionView = null,
  returnsAttentionLoading = false,
  returnsAttentionError,
  returnsAttentionCorrelationId,
  receiptLocations = [],
  receiptLocationId,
  onSelectReceiptLocation,
  receiptSettingsView = null,
  receiptSettingsLoading = false,
  receiptSettingsSaving = false,
  receiptSettingsError,
  receiptSettingsSaveError,
  receiptSettingsSaveMessage,
  onSaveReceiptSettings,
  systemHealthView = null,
  systemHealthLoading = false,
  systemHealthError,
  systemHealthCorrelationId,
  auditView = null,
  auditLoading = false,
  auditError,
  auditCorrelationId,
  staffSavingActorId,
  onSaveStaffAssignment,
  onSaveControlMembership,
  onSaveAccessStatus,
  onResetTemporaryPassword,
  invitingStaff = false,
  onInviteStaff,
  onCreateStaff,
  onReturnsChanged,
  onShiftsChanged,
}: {
  readonly context: ManagementContext;
  readonly activeSection?: ManagementSection;
  readonly onSelectSection?: (section: ManagementSection) => void;
  readonly onBackToPos?: () => void;
  readonly staffRows?: readonly StaffAccessRecord[];
  readonly staffLoading?: boolean;
  readonly staffError?: string;
  readonly policyView?: OperationalPolicyView | null;
  readonly policyLoading?: boolean;
  readonly policySaving?: boolean;
  readonly policyError?: string;
  readonly onSavePolicy?: (override: ShiftClosePolicyOverride) => void;
  readonly policyScopes?: readonly PolicyScopeChoice[];
  readonly selectedPolicyScopeId?: string;
  readonly onSelectPolicyScope?: (id: string) => void;
  readonly topologyRows?: readonly ManagementLocation[];
  readonly topologyLoading?: boolean;
  readonly topologySaving?: boolean;
  readonly topologyError?: string;
  readonly onSaveTopology?: (change: TopologyChange) => void;
  readonly shiftCashView?: ManagementShiftCashView | null;
  readonly shiftCashLoading?: boolean;
  readonly shiftCashError?: string;
  readonly shiftCashCorrelationId?: string;
  readonly shiftCashPolicyLoading?: boolean;
  readonly returnsAttentionView?: ManagementReturnsAttentionView | null;
  readonly returnsAttentionLoading?: boolean;
  readonly returnsAttentionError?: string;
  readonly returnsAttentionCorrelationId?: string;
  readonly receiptLocations?: readonly ReceiptLocationOption[];
  readonly receiptLocationId?: string;
  readonly onSelectReceiptLocation?: (locationId: string) => void;
  readonly receiptSettingsView?: ManagementReceiptSettingsView | null;
  readonly receiptSettingsLoading?: boolean;
  readonly receiptSettingsSaving?: boolean;
  readonly receiptSettingsError?: string;
  readonly receiptSettingsSaveError?: string;
  readonly receiptSettingsSaveMessage?: string;
  readonly onSaveReceiptSettings?: (settings: ReceiptSettings) => void;
  readonly systemHealthView?: ManagementSystemHealthView | null;
  readonly systemHealthLoading?: boolean;
  readonly systemHealthError?: string;
  readonly systemHealthCorrelationId?: string;
  readonly auditView?: ManagementAuditView | null;
  readonly auditLoading?: boolean;
  readonly auditError?: string;
  readonly auditCorrelationId?: string;
  readonly staffSavingActorId?: string | null;
  readonly onSaveStaffAssignment?: (input: {
    readonly actorId: string;
    readonly locationId: string;
    readonly role: StaffAssignmentRole;
    readonly registerIds: readonly string[];
  }) => void;
  readonly onSaveControlMembership?: (input: {
    readonly actorId: string;
    readonly controlRole: "owner" | "admin" | "support";
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
  readonly invitingStaff?: boolean;
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
  readonly onReturnsChanged?: () => void;
  readonly onShiftsChanged?: () => void;
}) {
  const active = LABELS[activeSection];
  const roleLabel = context.controlRole
    ? context.controlRole[0]!.toUpperCase() + context.controlRole.slice(1)
    : context.managerLocationIds.length > 0
      ? "Manager"
      : "Management";

  return (
    <div className="management-shell" data-management-role={context.controlRole ?? "manager"}>
      <aside className="management-sidebar" aria-label="Management navigation">
        <div className="management-brand">
          <span className="brand-mark">CT</span>
          <div>
            <strong>CETECH POS</strong>
            <span>Management</span>
          </div>
        </div>
        <nav className="management-nav">
          {context.sections.map((section) => (
            <button
              key={section}
              type="button"
              className={activeSection === section ? "management-nav-item active" : "management-nav-item"}
              aria-current={activeSection === section ? "page" : undefined}
              onClick={() => onSelectSection?.(section)}
            >
              {LABELS[section].label}
            </button>
          ))}
        </nav>
        {onBackToPos ? (
          <button className="btn block" type="button" onClick={onBackToPos}>
            Back to POS
          </button>
        ) : null}
      </aside>

      <main className="management-main">
        <header className="management-topbar">
          <div>
            <span className="eyebrow">Management</span>
            <h1>{active.label}</h1>
          </div>
          <div className="management-identity">
            <strong>{context.displayName}</strong>
            <span>{roleLabel}</span>
          </div>
        </header>

        <section className="management-content">
          <p className="management-lead">{active.description}</p>

          {activeSection === "overview" ? (
            <div className="management-grid">
              <ManagementCard title="Access">
                <p>Organization role: {context.controlRole
                  ? context.controlRole[0]!.toUpperCase() + context.controlRole.slice(1)
                  : "No organization role"}</p>
                <p>Managed locations: {context.managerLocationIds.length}</p>
              </ManagementCard>
              <ManagementCard title="Staff & access">
                <p>Staff access is limited to the organization and locations you are allowed to manage.</p>
                <p>Owners and Admins manage organization access. Managers may update register assignments only for staff already assigned to their locations.</p>
              </ManagementCard>
              <ManagementCard title="Shift-closing rules">
                <p>Rules can be set for the organization, a location, or a register.</p>
                <p>Cashiers, managers, or both can be allowed to close shifts according to the applicable rules.</p>
              </ManagementCard>
              <ManagementCard title="Management boundary">
                <p>Cashier screens stay separate. Support details and privileged actions are available only here.</p>
              </ManagementCard>
            </div>
          ) : activeSection === "staff_access" ? (
            <StaffAccessPanel
              rows={staffRows}
              topology={topologyRows}
              canManage={context.controlRole === "owner" || context.controlRole === "admin"}
              managedLocationIds={context.managerLocationIds}
              callerControlRole={context.controlRole}
              currentActorId={context.actorId}
              loading={staffLoading}
              savingActorId={staffSavingActorId}
              errorMessage={staffError}
              onSaveAssignment={onSaveStaffAssignment}
              onSaveControlMembership={onSaveControlMembership}
              onSaveAccessStatus={onSaveAccessStatus}
              onResetTemporaryPassword={onResetTemporaryPassword}
              inviting={invitingStaff}
              onInviteStaff={onInviteStaff}
              onCreateStaff={onCreateStaff}
            />
          ) : activeSection === "locations" ? (
            <TopologyPanel
              rows={topologyRows}
              mode="locations"
              loading={topologyLoading}
              saving={topologySaving}
              errorMessage={topologyError}
              canManage={context.controlRole === "owner" || context.controlRole === "admin"}
              onSave={onSaveTopology}
            />
          ) : activeSection === "registers" ? (
            <TopologyPanel
              rows={topologyRows}
              mode="registers"
              loading={topologyLoading}
              saving={topologySaving}
              errorMessage={topologyError}
              canManage={context.controlRole === "owner" || context.controlRole === "admin"}
              onSave={onSaveTopology}
            />
          ) : activeSection === "devices" ? (
            <TopologyPanel
              rows={topologyRows}
              mode="devices"
              loading={topologyLoading}
              saving={topologySaving}
              errorMessage={topologyError}
              canManage={context.controlRole === "owner" || context.controlRole === "admin"}
              onSave={onSaveTopology}
            />
          ) : activeSection === "shifts_cash" ? (
            <ShiftCashPanel
              view={shiftCashView}
              loading={shiftCashLoading}
              errorMessage={shiftCashError}
              correlationId={shiftCashCorrelationId}
              policy={policyView}
              policyLoading={shiftCashPolicyLoading}
              onOpenPolicies={
                context.sections.includes("policies")
                  ? () => onSelectSection?.("policies")
                  : undefined
              }
              managedLocationIds={context.managerLocationIds}
              onChanged={onShiftsChanged}
            />
          ) : activeSection === "returns_approvals" ? (
            <ReturnsApprovalsPanel
              view={returnsAttentionView}
              loading={returnsAttentionLoading}
              errorMessage={returnsAttentionError}
              correlationId={returnsAttentionCorrelationId}
              onChanged={onReturnsChanged}
            />
          ) : activeSection === "policies" ? (
            <PolicyPanel
              view={policyView}
              loading={policyLoading}
              saving={policySaving}
              errorMessage={policyError}
              onSave={onSavePolicy}
              scopes={policyScopes}
              selectedScopeId={selectedPolicyScopeId}
              onSelectScope={onSelectPolicyScope}
            />
          ) : activeSection === "receipt_settings" ? (
            <ReceiptSettingsPanel
              locations={receiptLocations}
              selectedLocationId={receiptLocationId}
              onSelectLocation={onSelectReceiptLocation}
              view={receiptSettingsView}
              loading={receiptSettingsLoading}
              saving={receiptSettingsSaving}
              errorMessage={receiptSettingsError}
              saveError={receiptSettingsSaveError}
              saveMessage={receiptSettingsSaveMessage}
              onSave={onSaveReceiptSettings}
            />
          ) : activeSection === "system_health" ? (
            <SystemHealthPanel
              view={systemHealthView}
              loading={systemHealthLoading}
              errorMessage={systemHealthError}
              correlationId={systemHealthCorrelationId}
            />
          ) : activeSection === "audit" ? (
            <AuditPanel
              view={auditView}
              loading={auditLoading}
              errorMessage={auditError}
              correlationId={auditCorrelationId}
            />
          ) : (
            <UnhandledSection section={activeSection} />
          )}
        </section>
      </main>
    </div>
  );
}

function UnhandledSection({ section }: { readonly section: never }) {
  return section;
}

function ManagementCard({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="card card-pad stack management-card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
