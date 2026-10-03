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

const NAV_GROUPS: readonly { readonly label: string; readonly sections: readonly ManagementSection[] }[] = [
  { label: "Workspace", sections: ["overview", "staff_access", "locations", "registers", "devices"] },
  { label: "Operations", sections: ["shifts_cash", "returns_approvals"] },
  { label: "Configuration", sections: ["policies", "receipt_settings"] },
  { label: "Support", sections: ["system_health", "audit"] },
];

const ICON_PATHS: Record<ManagementSection, string> = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  staff_access: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M20 21v-2a4 4 0 0 0-3-4 M16 3a4 4 0 0 1 0 8",
  locations: "M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0Z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  registers: "M3 4h18v12H3z M8 20h8 M12 16v4 M7 8h4 M7 12h10",
  devices: "M7 2h10v20H7z M10 18h4",
  shifts_cash: "M12 3v18 M16 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H8",
  returns_approvals: "M9 4 4 9l5 5 M4 9h11a6 6 0 0 1 0 12h-3",
  policies: "M4 7h16 M4 17h16 M8 4v6 M16 14v6",
  receipt_settings: "M6 3h12v18l-3-2-3 2-3-2-3 2Z M9 7h6 M9 11h6 M9 15h3",
  system_health: "M3 12h4l3-8 4 16 3-8h4",
  audit: "M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h6",
};

function ManagementIcon({ section }: { readonly section: ManagementSection }) {
  return (
    <svg className="management-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[section]} />
    </svg>
  );
}

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
      <a className="skip-link" href="#management-workspace">Skip to management content</a>
      <aside className="management-sidebar" aria-label="Management navigation">
        <div className="management-brand">
          <span className="brand-mark">CT</span>
          <div>
            <strong>CETECH POS</strong>
            <span>Management</span>
          </div>
        </div>
        <nav className="management-nav" aria-label="Management sections">
          {NAV_GROUPS.map((group) => {
            const sections = group.sections.filter((section) => context.sections.includes(section));
            if (sections.length === 0) return null;
            return (
              <div className="management-nav-group" key={group.label}>
                <span className="management-nav-label">{group.label}</span>
                {sections.map((section) => (
                  <button
                    key={section}
                    type="button"
                    className={activeSection === section ? "management-nav-item active" : "management-nav-item"}
                    aria-current={activeSection === section ? "page" : undefined}
                    onClick={() => onSelectSection?.(section)}
                  >
                    <ManagementIcon section={section} />
                    <span>{LABELS[section].label}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </nav>
        {onBackToPos ? (
          <button className="btn block management-back" type="button" onClick={onBackToPos}>
            <span aria-hidden="true">←</span> Back to POS
          </button>
        ) : null}
      </aside>

      <main className="management-main" id="management-workspace" tabIndex={-1}>
        <header className="management-topbar">
          <div>
            <span className="eyebrow">Management</span>
            <h1>{active.label}</h1>
          </div>
          <div className="management-identity">
            <strong>{context.displayName}</strong>
            <span className="management-role-label">{roleLabel}</span>
          </div>
        </header>

        <section className={activeSection === "receipt_settings" ? "management-content" : "management-content management-workspace"} aria-label={active.label}>
          <p className="management-lead">{active.description}</p>

          {activeSection === "overview" ? (
            <div className="management-grid">
              <ManagementCard title="Access">
                <dl className="management-overview-facts">
                  <div><dt>Organization role</dt><dd>{context.controlRole
                    ? context.controlRole[0]!.toUpperCase() + context.controlRole.slice(1)
                    : "No organization role"}</dd></div>
                  <div><dt>Managed locations</dt><dd>{context.managerLocationIds.length}</dd></div>
                </dl>
                <p className="muted">Your role and assigned locations determine the actions available here.</p>
              </ManagementCard>
              <ManagementCard title="Staff & access" action={context.sections.includes("staff_access") && onSelectSection ? { label: "View staff & access", onClick: () => onSelectSection("staff_access") } : undefined}>
                <p>Staff access is limited to the organization and locations you are allowed to manage.</p>
                <p>Owners and Admins manage organization access. Managers may update register assignments only for staff already assigned to their locations.</p>
              </ManagementCard>
              <ManagementCard title="Shift-closing rules" action={context.sections.includes("policies") && onSelectSection ? { label: "View operational rules", onClick: () => onSelectSection("policies") } : undefined}>
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
  action,
}: {
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}) {
  return (
    <section className="card card-pad stack management-card">
      <h2>{title}</h2>
      {children}
      {action ? <button className="btn management-card-action" type="button" onClick={action.onClick}>{action.label}<span aria-hidden="true">→</span></button> : null}
    </section>
  );
}
