import type { AdminAuditRecord } from "./admin-audit-directory";

export type ManagementAuditChange = {
  readonly label: string;
  readonly before?: string;
  readonly after?: string;
};

export type ManagementAuditItem = {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly actionLabel: string;
  readonly targetType: string;
  readonly targetLabel: string;
  readonly targetId?: string;
  readonly locationId?: string;
  readonly registerId?: string;
  readonly correlationId?: string;
  readonly createdAt: string;
  readonly changes: readonly ManagementAuditChange[];
};

export type ManagementAuditScope =
  | { readonly kind: "organization" }
  | { readonly kind: "locations"; readonly locationIds: readonly string[] };

export type ManagementAuditView = {
  readonly scope: ManagementAuditScope;
  readonly limit: number;
  readonly truncated: boolean;
  readonly rows: readonly ManagementAuditItem[];
};

const ACTION_LABELS: Record<string, string> = {
  "operational_policy.set": "Shift policy changed",
  "staff.assignment.set": "Staff assignment changed",
  "organization_membership.set": "Organization role changed",
  "staff.access_status.set": "POS access changed",
  "staff.identity.invited": "Staff invited",
  "staff.password.reset.requested": "Password reset requested",
  "staff.password.reset.completed": "Password reset completed",
  "receipt_settings.set": "Receipt settings changed",
  "receipt_settings.shared.set": "Shared receipt defaults changed",
  "receipt_settings.inherit_layout": "Shared receipt layout applied",
  "sale.recovery.requested": "Manager sale recovery requested",
  "sale.recovery.result": "Manager sale recovery checked",
};

type FieldSpec = { readonly label: string; readonly keys: readonly string[] };

const FIELDS: Record<string, readonly FieldSpec[]> = {
  operational_policy: [
    { label: "Cashier may close shift", keys: ["cashier_can_close_shift", "cashierCanCloseShift"] },
    { label: "Manager may close shift", keys: ["manager_can_close_shift", "managerCanCloseShift"] },
    { label: "Cashier own shift only", keys: ["cashier_own_shift_only", "cashierOwnShiftOnly"] },
    { label: "Manager may close other shifts", keys: ["manager_can_close_others_shift", "managerCanCloseOthersShift"] },
    { label: "Variance requires manager", keys: ["non_zero_variance_requires_manager", "nonZeroVarianceRequiresManager"] },
    { label: "Variance tolerance", keys: ["variance_tolerance_minor", "varianceToleranceMinor"] },
    { label: "Variance currency", keys: ["variance_currency", "varianceCurrency"] },
  ],
  staff_assignment: [
    { label: "Role", keys: ["role"] },
    { label: "Registers", keys: ["registerIds", "register_ids"] },
  ],
  organization_membership: [
    { label: "Control role", keys: ["control_role", "controlRole"] },
    { label: "Status", keys: ["status"] },
  ],
  staff_access: [
    { label: "POS access", keys: ["status"] },
    { label: "Revoked sessions", keys: ["revokedSessionCount", "revoked_session_count"] },
  ],
  staff_identity: [
    { label: "Staff name", keys: ["displayName", "display_name"] },
    { label: "POS access", keys: ["posAccessStatus", "pos_access_status"] },
    { label: "Password reset", keys: ["status"] },
    { label: "Password change required", keys: ["mustChangePassword", "must_change_password"] },
  ],
  receipt_settings: [
    { label: "Shorten product names", keys: ["shorten_product_names", "shortenProductNames"] },
    { label: "Maximum product-name characters", keys: ["product_name_max_characters", "productNameMaxCharacters"] },
    { label: "Show SKU", keys: ["show_sku", "showSku"] },
  ],
};

export function presentManagementAuditRecord(record: AdminAuditRecord): ManagementAuditItem {
  return {
    id: record.id,
    actorId: record.actorId,
    action: record.action,
    actionLabel: ACTION_LABELS[record.action] ?? readableLabel(record.action),
    targetType: record.targetType,
    targetLabel: readableLabel(record.targetType),
    ...(record.targetId ? { targetId: record.targetId } : {}),
    ...(record.locationId ? { locationId: record.locationId } : {}),
    ...(record.registerId ? { registerId: record.registerId } : {}),
    ...(record.correlationId ? { correlationId: record.correlationId } : {}),
    createdAt: record.createdAt,
    changes: changesFor(record),
  };
}

function changesFor(record: AdminAuditRecord): readonly ManagementAuditChange[] {
  const specs = FIELDS[record.targetType] ?? [];
  const before = asRecord(record.beforeState);
  const after = asRecord(record.afterState);
  const changes: ManagementAuditChange[] = [];
  for (const spec of specs) {
    const previous = findValue(before, spec.keys);
    const next = findValue(after, spec.keys);
    if (!previous.found && !next.found) continue;
    if (JSON.stringify(previous.value) === JSON.stringify(next.value)) continue;
    const beforeLabel = formatValue(previous.value);
    const afterLabel = formatValue(next.value);
    changes.push({
      label: spec.label,
      ...(previous.found && beforeLabel !== undefined ? { before: beforeLabel } : {}),
      ...(next.found && afterLabel !== undefined ? { after: afterLabel } : {}),
    });
  }
  return changes;
}

function findValue(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): { readonly found: boolean; readonly value?: unknown } {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) return { found: true, value: value[key] };
  }
  return { found: false };
}

function formatValue(value: unknown): string | undefined {
  if (value === null) return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const parts = value.flatMap((item) =>
      typeof item === "string" || typeof item === "number" ? [String(item)] : [],
    );
    return parts.length > 0 ? parts.join(", ") : "None";
  }
  return undefined;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readableLabel(value: string): string {
  const words = value.replaceAll(".", " ").replaceAll("_", " ").replaceAll("-", " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Audit event";
}
