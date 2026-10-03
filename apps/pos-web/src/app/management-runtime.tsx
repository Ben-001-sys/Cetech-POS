"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiResult } from "../../../../docs/contracts/ports";
import type { ManagementContext, ManagementSection } from "../server/admin/management-context";
import type { StaffAccessRecord } from "../server/admin/staff-access-directory";
import type { OperationalPolicyView } from "../server/admin/handle-operational-policy";
import type { ManagementLocation } from "../server/admin/management-topology-directory";
import type { ManagementShiftCashView } from "../server/admin/management-shift-cash-directory";
import type { ManagementReturnsAttentionView } from "../server/admin/management-returns-attention-directory";
import type { ManagementReceiptSettingsView } from "../server/admin/handle-management-receipt-settings";
import type { ManagementSystemHealthView } from "../server/admin/management-system-health";
import type { ManagementAuditView } from "../server/admin/management-audit";
import type { ReceiptSettings } from "../../../../docs/contracts/domain.generated";
import type { ReceiptSettingsOverride, ReceiptSettingsScope } from "../core/receipt/settings-override";
import type { ShiftClosePolicyOverride } from "../server/auth/policy";
import { ManagementScreen } from "../features/admin/ManagementScreen";
import type { TopologyChange } from "../features/admin/TopologyPanel";
import {
  fetchManagementAudit,
  fetchManagementContext,
  fetchManagementReceiptSettings,
  fetchManagementReturnDetail,
  fetchManagementReturnsAttention,
  fetchManagementShiftsCash,
  fetchManagementSystemHealth,
  fetchManagementTopology,
  fetchOperationalPolicy,
  fetchStaffAccess,
  createStaffAccount,
  inviteStaff,
  resetStaffTemporaryPassword,
  saveTopology,
  updateControlMembership,
  updateManagementReceiptSettings,
  updateOperationalPolicy,
  updateStaffAccessStatus,
  updateStaffAssignment,
  type ManagementReceiptSettingsChange,
} from "./management-client";

export function ManagementRuntime({ fetchImpl = fetch }: { readonly fetchImpl?: typeof fetch }) {
  const router = useRouter();
  const [result, setResult] = useState<ApiResult<ManagementContext> | null>(null);
  const [section, setSection] = useState<ManagementSection>("overview");
  const [staffResult, setStaffResult] = useState<ApiResult<readonly StaffAccessRecord[]> | null>(null);
  const [policyResult, setPolicyResult] = useState<ApiResult<OperationalPolicyView> | null>(null);
  const [policySaving, setPolicySaving] = useState(false);
  const [topologyResult, setTopologyResult] = useState<ApiResult<readonly ManagementLocation[]> | null>(null);
  const [topologySaving, setTopologySaving] = useState(false);
  const [topologyMutationError, setTopologyMutationError] = useState<string | null>(null);
  const [shiftCashResult, setShiftCashResult] = useState<ApiResult<ManagementShiftCashView> | null>(null);
  const [shiftCashRefresh, setShiftCashRefresh] = useState(0);
  const [returnsAttentionResult, setReturnsAttentionResult] = useState<ApiResult<ManagementReturnsAttentionView> | null>(null);
  const [returnsAttentionRefresh, setReturnsAttentionRefresh] = useState(0);
  const [receiptSettingsResponse, setReceiptSettingsResult] = useState<ApiResult<ManagementReceiptSettingsView> | null>(null);
  const [receiptLoadedKey, setReceiptLoadedKey] = useState<string | null>(null);
  const [systemHealthResult, setSystemHealthResult] = useState<ApiResult<ManagementSystemHealthView> | null>(null);
  const [auditResult, setAuditResult] = useState<ApiResult<ManagementAuditView> | null>(null);
  const [receiptLocationId, setReceiptLocationId] = useState<string | null>(null);
  const [receiptScope, setReceiptScope] = useState<ReceiptSettingsScope | null>(null);
  const [receiptSaving, setReceiptSaving] = useState(false);
  const [receiptSaveError, setReceiptSaveError] = useState<string | null>(null);
  const [receiptSaveMessage, setReceiptSaveMessage] = useState<string | null>(null);
  const [staffSavingActorId, setStaffSavingActorId] = useState<string | null>(null);
  const [staffMutationError, setStaffMutationError] = useState<string | null>(null);
  const [invitingStaff, setInvitingStaff] = useState(false);
  const receiptGeneration = useRef(0);
  const topologyGeneration = useRef(0);
  const receiptMutation = useRef(false);
  const topologyMutation = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void fetchManagementContext(fetchImpl).then((next) => {
      if (!cancelled) setResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchImpl]);

  const context = result?.ok ? result.data : null;
  const allowedSection = context
    ? context.sections.includes(section)
      ? section
      : context.sections[0] ?? "overview"
    : "overview";

  const [policyScope, setPolicyScope] = useState<{ locationId?: string; registerId?: string }>({});
  const effectivePolicyScope = useMemo(() => {
    if (!context) return {};
    if (context.controlRole === "owner" || context.controlRole === "admin") return policyScope;
    const locationId = policyScope.locationId && context.managerLocationIds.includes(policyScope.locationId)
      ? policyScope.locationId
      : context.managerLocationIds[0];
    if (!locationId) return {};
    const registerAllowed = topologyResult?.ok
      ? topologyResult.data.some((location) =>
          location.id === locationId && location.registers.some((register) => register.id === policyScope.registerId))
      : false;
    return {
      locationId,
      ...(policyScope.registerId && registerAllowed ? { registerId: policyScope.registerId } : {}),
    };
  }, [context, policyScope, topologyResult]);

  useEffect(() => {
    if (!context || allowedSection !== "staff_access") return;
    let cancelled = false;
    void fetchStaffAccess(fetchImpl).then((next) => {
      if (!cancelled) setStaffResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl]);

  useEffect(() => {
    if (
      !context || topologySaving || topologyMutation.current ||
      !["staff_access", "locations", "registers", "devices", "receipt_settings", "policies"].includes(allowedSection)
    ) {
      return;
    }
    let cancelled = false;
    const generation = ++topologyGeneration.current;
    void fetchManagementTopology(fetchImpl).then((next) => {
      if (!cancelled && generation === topologyGeneration.current) setTopologyResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl, topologySaving]);

  useEffect(() => {
    if (!context || allowedSection !== "shifts_cash") return;
    let cancelled = false;
    void fetchManagementShiftsCash(fetchImpl).then((next) => {
      if (!cancelled) setShiftCashResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl, shiftCashRefresh]);

  useEffect(() => {
    if (!context || allowedSection !== "system_health") return;
    let cancelled = false;
    void fetchManagementSystemHealth(fetchImpl).then((next) => {
      if (!cancelled) setSystemHealthResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl]);

  useEffect(() => {
    if (!context || allowedSection !== "audit") return;
    let cancelled = false;
    void fetchManagementAudit(fetchImpl).then((next) => {
      if (!cancelled) setAuditResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl]);

  useEffect(() => {
    if (!context || allowedSection !== "returns_approvals") return;
    let cancelled = false;
    void fetchManagementReturnsAttention(fetchImpl).then((next) => {
      if (!cancelled) setReturnsAttentionResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl, returnsAttentionRefresh]);

  const receiptLocations = useMemo(() => {
    if (!context || !topologyResult?.ok) return [];
    const rows = topologyResult.data.map((row) => ({ id: row.id, name: row.name }));
    if (context.controlRole === "owner" || context.controlRole === "admin") return rows;
    return rows.filter((row) => context.managerLocationIds.includes(row.id));
  }, [context, topologyResult]);
  const policyScopeChoices = useMemo(() => {
    const rows = topologyResult?.ok ? topologyResult.data : [];
    const visible = !context || context.controlRole === "owner" || context.controlRole === "admin"
      ? rows
      : rows.filter((row) => context.managerLocationIds.includes(row.id));
    const choices: { id: string; label: string }[] = [];
    if (context?.controlRole === "owner" || context?.controlRole === "admin") {
      choices.push({ id: "organization", label: "Organization default" });
    }
    for (const location of visible) {
      choices.push({ id: `location:${location.id}`, label: location.name });
      for (const register of location.registers) {
        choices.push({
          id: `register:${location.id}:${register.id}`,
          label: `${location.name} / ${register.name}`,
        });
      }
    }
    return choices;
  }, [context, topologyResult]);
  const selectedPolicyScopeId = effectivePolicyScope.registerId && effectivePolicyScope.locationId
    ? `register:${effectivePolicyScope.locationId}:${effectivePolicyScope.registerId}`
    : effectivePolicyScope.locationId
      ? `location:${effectivePolicyScope.locationId}`
      : "organization";
  const selectedReceiptLocationId = receiptLocations.some((row) => row.id === receiptLocationId)
    ? receiptLocationId
    : receiptLocations[0]?.id ?? null;
  const organizationReceiptAuthority = context?.controlRole === "owner" || context?.controlRole === "admin";
  const effectiveReceiptScope = organizationReceiptAuthority ? receiptScope ?? "organization" : "location";
  const receiptSelectionKey = JSON.stringify([context?.organizationId, context?.actorId, organizationReceiptAuthority, effectiveReceiptScope,
    effectiveReceiptScope === "location" ? selectedReceiptLocationId : null]);
  const receiptSettingsResult = receiptLoadedKey === receiptSelectionKey ? receiptSettingsResponse : null;

  useEffect(() => {
    if (!context || receiptSaving || receiptMutation.current || allowedSection !== "receipt_settings" || (effectiveReceiptScope === "location" && !selectedReceiptLocationId)) return;
    let cancelled = false;
    const generation = ++receiptGeneration.current;
    void fetchManagementReceiptSettings({
      scope: effectiveReceiptScope,
      ...(effectiveReceiptScope === "location" && selectedReceiptLocationId ? { locationId: selectedReceiptLocationId } : {}),
    }, fetchImpl).then((next) => {
      if (!cancelled && generation === receiptGeneration.current) {
        setReceiptSettingsResult(next);
        setReceiptLoadedKey(receiptSelectionKey);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl, selectedReceiptLocationId, effectiveReceiptScope, receiptSaving, receiptSelectionKey]);

  useEffect(() => {
    if (!context || (allowedSection !== "policies" && allowedSection !== "shifts_cash")) return;
    let cancelled = false;
    void fetchOperationalPolicy(effectivePolicyScope, fetchImpl).then((next) => {
      if (!cancelled) setPolicyResult(next);
    });
    return () => {
      cancelled = true;
    };
  }, [allowedSection, context, fetchImpl, effectivePolicyScope]);

  async function saveStaffAssignment(input: {
    readonly actorId: string;
    readonly locationId: string;
    readonly role: "cashier" | "manager";
    readonly registerIds: readonly string[];
  }) {
    setStaffSavingActorId(input.actorId);
    setStaffMutationError(null);
    try {
      const saved = await updateStaffAssignment(input, fetchImpl);
      if (!saved.ok) {
        setStaffMutationError(presentManagementError(saved.error.message));
        return;
      }
      const [staff, topology] = await Promise.all([
        fetchStaffAccess(fetchImpl),
        fetchManagementTopology(fetchImpl),
      ]);
      setStaffResult(staff);
      setTopologyResult(topology);
    } finally {
      setStaffSavingActorId(null);
    }
  }

  async function createStaff(input: {
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
  }) {
    setInvitingStaff(true);
    setStaffMutationError(null);
    try {
      const created = await createStaffAccount(input, fetchImpl);
      if (!created.ok) {
        setStaffMutationError(presentManagementError(created.error.message));
        return;
      }
      if (created.data.setupStatus === "incomplete") {
        setStaffMutationError("Staff account created, but setup is incomplete. POS access remains disabled. Complete the highlighted assignments.");
      }
      const staff = await fetchStaffAccess(fetchImpl);
      setStaffResult(staff);
    } finally {
      setInvitingStaff(false);
    }
  }

  async function sendStaffInvite(input: {
    readonly email: string;
    readonly displayName: string;
  }) {
    setInvitingStaff(true);
    setStaffMutationError(null);
    try {
      const invited = await inviteStaff(input, fetchImpl);
      if (!invited.ok) {
        setStaffMutationError(presentManagementError(invited.error.message));
        return;
      }
      const staff = await fetchStaffAccess(fetchImpl);
      setStaffResult(staff);
    } finally {
      setInvitingStaff(false);
    }
  }

  async function resetTemporaryPassword(input: {
    readonly actorId: string;
    readonly temporaryPassword: string;
  }) {
    setStaffSavingActorId(input.actorId);
    setStaffMutationError(null);
    try {
      const saved = await resetStaffTemporaryPassword(input, fetchImpl);
      if (!saved.ok) {
        setStaffMutationError(presentManagementError(saved.error.message));
      }
    } finally {
      setStaffSavingActorId(null);
    }
  }

  async function saveTopologyChange(change: TopologyChange) {
    if (topologyMutation.current) return;
    topologyMutation.current = true;
    topologyGeneration.current += 1;
    setTopologySaving(true);
    setTopologyMutationError(null);
    try {
      const saved = await saveTopology(change, fetchImpl);
      if (!saved.ok) {
        setTopologyMutationError(presentManagementError(saved.error.message));
        return;
      }
      setTopologyResult(null);
      const next = await fetchManagementTopology(fetchImpl);
      setTopologyResult(next);
      if (!next.ok) setTopologyMutationError(presentManagementError(next.error.message));
    } finally {
      topologyMutation.current = false;
      setTopologySaving(false);
    }
  }

  async function saveStaffAccessStatus(input: {
    readonly actorId: string;
    readonly status: "active" | "disabled";
    readonly reason?: string;
  }) {
    setStaffSavingActorId(input.actorId);
    setStaffMutationError(null);
    try {
      const saved = await updateStaffAccessStatus(input, fetchImpl);
      if (!saved.ok) {
        setStaffMutationError(presentManagementError(saved.error.message));
        return;
      }
      const staff = await fetchStaffAccess(fetchImpl);
      setStaffResult(staff);
    } finally {
      setStaffSavingActorId(null);
    }
  }

  async function saveControlMembership(input: {
    readonly actorId: string;
    readonly controlRole: "owner" | "admin" | "support";
    readonly status: "active" | "disabled";
  }) {
    setStaffSavingActorId(input.actorId);
    setStaffMutationError(null);
    try {
      const saved = await updateControlMembership(input, fetchImpl);
      if (!saved.ok) {
        setStaffMutationError(presentManagementError(saved.error.message));
        return;
      }
      const [staff, contextNext] = await Promise.all([
        fetchStaffAccess(fetchImpl),
        fetchManagementContext(fetchImpl),
      ]);
      setStaffResult(staff);
      setResult(contextNext);
    } finally {
      setStaffSavingActorId(null);
    }
  }

  async function savePolicy(override: ShiftClosePolicyOverride) {
    if (!context) return;
    setPolicySaving(true);
    try {
      setPolicyResult(await updateOperationalPolicy({ scope: effectivePolicyScope, override }, fetchImpl));
    } finally {
      setPolicySaving(false);
    }
  }

  async function saveReceiptSettings(settings: ReceiptSettings) {
    if (effectiveReceiptScope === "organization") {
      await saveReceiptChange({ scope: "organization", settings }, "Shared receipt defaults saved.");
    } else if (selectedReceiptLocationId) {
      await saveReceiptChange({ locationId: selectedReceiptLocationId, settings }, "Receipt settings saved.");
    }
  }

  async function saveReceiptOverrides(overrides: ReceiptSettingsOverride) {
    if (!selectedReceiptLocationId || effectiveReceiptScope !== "location") return;
    await saveReceiptChange({ scope: "location", locationId: selectedReceiptLocationId, overrides }, "Location receipt overrides saved.");
  }

  async function saveReceiptChange(input: ManagementReceiptSettingsChange, message: string) {
    if (!organizationReceiptAuthority || receiptMutation.current) return;
    receiptMutation.current = true;
    receiptGeneration.current += 1;
    setReceiptSaving(true);
    setReceiptSaveError(null);
    setReceiptSaveMessage(null);
    try {
      const saved = await updateManagementReceiptSettings(input, fetchImpl);
      if (!saved.ok) {
        setReceiptSaveError(presentManagementError(saved.error.message));
        return;
      }
      setReceiptSettingsResult(saved);
      setReceiptLoadedKey(receiptSelectionKey);
      setReceiptSaveMessage(message);
    } finally {
      receiptMutation.current = false;
      setReceiptSaving(false);
    }
  }

  if (!result) {
    return (
      <main className="management-standalone-state">
        <div className="card card-pad">
          <h1>Management</h1>
          <p>Loading authorized management workspace…</p>
        </div>
      </main>
    );
  }

  if (!result.ok) {
    return (
      <main className="management-standalone-state">
        <div className="card card-pad stack">
          <h1>Management</h1>
          <div className="banner danger" role="alert">
            {result.error.code === "FORBIDDEN"
              ? "This staff account is not authorized for management."
              : result.error.code === "AUTH_REQUIRED"
                ? "Sign in to the POS before opening Management."
                : "Management is temporarily unavailable."}
          </div>
          <button className="btn" type="button" onClick={() => router.push("/sell")}>
            Back to POS
          </button>
        </div>
      </main>
    );
  }

  return (
    <ManagementScreen
      context={result.data}
      activeSection={allowedSection}
      onSelectSection={(next) => {
        if (next === allowedSection) return;
        if (next === "staff_access") setStaffResult(null);
        if (["staff_access", "locations", "registers", "devices", "receipt_settings"].includes(next)) {
          setTopologyResult(null);
        }
        if (next === "policies" || next === "shifts_cash") setPolicyResult(null);
        if (next === "shifts_cash") setShiftCashResult(null);
        if (next === "returns_approvals") setReturnsAttentionResult(null);
        if (next === "system_health") setSystemHealthResult(null);
        if (next === "audit") setAuditResult(null);
        if (next === "receipt_settings") {
          setReceiptSettingsResult(null);
          setReceiptSaveError(null);
          setReceiptSaveMessage(null);
        }
        setSection(next);
      }}
      onBackToPos={() => router.push("/sell")}
      staffRows={staffResult?.ok ? staffResult.data : []}
      staffLoading={allowedSection === "staff_access" && staffResult === null}
      staffError={
        staffMutationError ??
        (allowedSection === "staff_access" && staffResult && !staffResult.ok
          ? presentManagementError(staffResult.error.message)
          : undefined)
      }
      topologyRows={topologyResult?.ok ? topologyResult.data : []}
      topologySaving={topologySaving}
      onSaveTopology={(change) => {
        void saveTopologyChange(change);
      }}
      topologyLoading={
        ["staff_access", "locations", "registers", "devices", "receipt_settings"].includes(allowedSection) &&
        topologyResult === null
      }
      topologyError={
        topologyMutationError ??
        (["locations", "registers", "devices"].includes(allowedSection) &&
        topologyResult &&
        !topologyResult.ok
          ? presentManagementError(topologyResult.error.message)
          : undefined)
      }
      staffSavingActorId={staffSavingActorId}
      onSaveStaffAssignment={
        result.data.controlRole === "owner" ||
        result.data.controlRole === "admin" ||
        result.data.managerLocationIds.length > 0
          ? (input) => {
              void saveStaffAssignment(input);
            }
          : undefined
      }
      onSaveControlMembership={
        result.data.controlRole === "owner" || result.data.controlRole === "admin"
          ? (input) => {
              void saveControlMembership(input);
            }
          : undefined
      }
      onSaveAccessStatus={
        result.data.controlRole === "owner" || result.data.controlRole === "admin"
          ? (input) => {
              void saveStaffAccessStatus(input);
            }
          : undefined
      }
      onResetTemporaryPassword={
        result.data.controlRole === "owner" || result.data.controlRole === "admin"
          ? (input) => {
              void resetTemporaryPassword(input);
            }
          : undefined
      }
      invitingStaff={invitingStaff}
      onInviteStaff={
        result.data.controlRole === "owner" || result.data.controlRole === "admin"
          ? (input) => {
              void sendStaffInvite(input);
            }
          : undefined
      }
      onCreateStaff={
        result.data.controlRole === "owner" || result.data.controlRole === "admin"
          ? (input) => {
              void createStaff(input);
            }
          : undefined
      }
      policyView={policyResult?.ok ? policyResult.data : null}
      policyLoading={allowedSection === "policies" && policyResult === null}
      policySaving={policySaving}
      policyError={
        allowedSection === "policies" && policyResult && !policyResult.ok
          ? presentManagementError(policyResult.error.message)
          : undefined
      }
      shiftCashView={shiftCashResult?.ok ? shiftCashResult.data : null}
      shiftCashLoading={allowedSection === "shifts_cash" && shiftCashResult === null}
      shiftCashError={
        allowedSection === "shifts_cash" && shiftCashResult && !shiftCashResult.ok
          ? presentManagementError(shiftCashResult.error.message)
          : undefined
      }
      shiftCashCorrelationId={
        allowedSection === "shifts_cash" && shiftCashResult && !shiftCashResult.ok
          ? shiftCashResult.correlationId
          : undefined
      }
      shiftCashPolicyLoading={allowedSection === "shifts_cash" && policyResult === null}
      returnsAttentionView={returnsAttentionResult?.ok ? returnsAttentionResult.data : null}
      returnsAttentionLoading={allowedSection === "returns_approvals" && returnsAttentionResult === null}
      returnsAttentionError={
        allowedSection === "returns_approvals" && returnsAttentionResult && !returnsAttentionResult.ok
          ? presentManagementError(returnsAttentionResult.error.message)
          : undefined
      }
      returnsAttentionCorrelationId={
        allowedSection === "returns_approvals" && returnsAttentionResult && !returnsAttentionResult.ok
          ? returnsAttentionResult.correlationId
          : undefined
      }
      onReturnsChanged={() => {
        setReturnsAttentionRefresh((value) => value + 1);
      }}
      onReviewReturn={(returnId) => fetchManagementReturnDetail(returnId, fetchImpl)}
      onShiftsChanged={() => {
        setShiftCashRefresh((value) => value + 1);
      }}
      receiptLocations={receiptLocations}
      receiptLocationId={selectedReceiptLocationId ?? undefined}
      receiptScope={effectiveReceiptScope}
      onSelectReceiptScope={organizationReceiptAuthority ? (scope) => {
        if (receiptSaving || scope === effectiveReceiptScope) return;
        setReceiptScope(scope);
        setReceiptSettingsResult(null);
        setReceiptSaveError(null);
        setReceiptSaveMessage(null);
      } : undefined}
      onSelectReceiptLocation={(locationId) => {
        if (receiptSaving || locationId === selectedReceiptLocationId) return;
        setReceiptLocationId(locationId);
        setReceiptSettingsResult(null);
        setReceiptSaveError(null);
        setReceiptSaveMessage(null);
      }}
      receiptSettingsView={receiptSettingsResult?.ok ? receiptSettingsResult.data : null}
      receiptSettingsLoading={
        allowedSection === "receipt_settings" && (
          topologyResult === null ||
          ((effectiveReceiptScope === "organization" || selectedReceiptLocationId !== null) && receiptSettingsResult === null)
        )
      }
      receiptSettingsSaving={receiptSaving}
      receiptSettingsError={
        allowedSection === "receipt_settings" && topologyResult && !topologyResult.ok
          ? presentManagementError(topologyResult.error.message)
          : allowedSection === "receipt_settings" && receiptSettingsResult && !receiptSettingsResult.ok
            ? presentManagementError(receiptSettingsResult.error.message)
            : undefined
      }
      receiptSettingsSaveError={receiptSaveError ?? undefined}
      receiptSettingsSaveMessage={receiptSaveMessage ?? undefined}
      systemHealthView={systemHealthResult?.ok ? systemHealthResult.data : null}
      systemHealthLoading={allowedSection === "system_health" && systemHealthResult === null}
      systemHealthError={
        allowedSection === "system_health" && systemHealthResult && !systemHealthResult.ok
          ? presentManagementError(systemHealthResult.error.message)
          : undefined
      }
      systemHealthCorrelationId={
        allowedSection === "system_health" && systemHealthResult && !systemHealthResult.ok
          ? systemHealthResult.correlationId
          : undefined
      }
      auditView={auditResult?.ok ? auditResult.data : null}
      auditLoading={allowedSection === "audit" && auditResult === null}
      auditError={
        allowedSection === "audit" && auditResult && !auditResult.ok
          ? presentManagementError(auditResult.error.message)
          : undefined
      }
      auditCorrelationId={
        allowedSection === "audit" && auditResult && !auditResult.ok
          ? auditResult.correlationId
          : undefined
      }
      onSaveReceiptSettings={
        organizationReceiptAuthority && receiptSettingsResult?.ok && receiptSettingsResult.data.canManage
          ? (settings) => {
              void saveReceiptSettings(settings);
            }
          : undefined
      }
      onSaveReceiptOverrides={organizationReceiptAuthority && receiptSettingsResult?.ok && receiptSettingsResult.data.canManage
        ? (overrides) => { void saveReceiptOverrides(overrides); } : undefined}
      onApplySharedReceiptSettings={organizationReceiptAuthority && receiptSettingsResult?.ok && receiptSettingsResult.data.canManage
        ? () => { void saveReceiptChange({ scope: "organization", action: "apply_shared" }, "Shared layout applied to all locations. Local address, contact and tax details were kept."); } : undefined}
      onSavePolicy={
        policyResult?.ok && policyResult.data.canManage
          ? (override) => {
              void savePolicy(override);
            }
          : undefined
      }
      policyScopes={policyScopeChoices}
      selectedPolicyScopeId={selectedPolicyScopeId}
      onSelectPolicyScope={(id) => {
        if (id === "organization") setPolicyScope({});
        else if (id.startsWith("location:")) setPolicyScope({ locationId: id.slice("location:".length) });
        else if (id.startsWith("register:")) {
          const [, locationId, registerId] = id.split(":");
          if (locationId && registerId) setPolicyScope({ locationId, registerId });
        }
        setPolicyResult(null);
      }}
    />
  );
}

function presentManagementError(message: string): string {
  if (/csrf|service[_ -]?role|sql|postgres|pos_|rpc|schema|endpoint|jwt|stack|function/i.test(message)) {
    return "That change could not be saved. Try again.";
  }
  return message;
}
