import type { HealthCheck, StoreHealth } from "../../../../../docs/contracts/domain.generated";
import type { StaffSignInDiagnostic } from "../../core/identity/sign-in-diagnostic";

export type ManagementHealthStatus = HealthCheck["status"];

export type ManagementSystemHealthCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: ManagementHealthStatus;
  readonly summary: string;
  readonly detail?: string;
  readonly checkedAt: string;
};

export type ManagementSystemHealthView = {
  readonly overall: ManagementHealthStatus;
  readonly buildId: string;
  readonly checks: readonly ManagementSystemHealthCheck[];
  readonly signInDiagnostics?: readonly StaffSignInDiagnostic[];
};

const STATUS_RANK: Record<ManagementHealthStatus, number> = {
  unavailable: 0,
  degraded: 1,
  unverified: 2,
  healthy: 3,
};

const CHECK_LABELS: Record<string, string> = {
  supabase: "Store data",
  bridge: "Commerce connection",
  "bridge-contract": "Commerce contract",
};

export function presentManagementSystemHealth(health: StoreHealth): ManagementSystemHealthView {
  const checks = health.checks
    .map(presentCheck)
    .sort((left, right) => {
      const rank = STATUS_RANK[left.status] - STATUS_RANK[right.status];
      if (rank !== 0) return rank;
      return left.label.localeCompare(right.label);
    });
  return {
    overall: checks.reduce<ManagementHealthStatus>(
      (worst, check) => (STATUS_RANK[check.status] < STATUS_RANK[worst] ? check.status : worst),
      checks.length === 0 ? "unverified" : "healthy",
    ),
    buildId: health.buildId,
    checks,
  };
}

function presentCheck(check: HealthCheck): ManagementSystemHealthCheck {
  const detail = safeDetail(check.message);
  return {
    id: check.id,
    label: CHECK_LABELS[check.id] ?? readableLabel(check.id),
    status: check.status,
    summary: summaryFor(check.status),
    ...(detail ? { detail } : {}),
    checkedAt: check.checkedAt,
  };
}

function summaryFor(status: ManagementHealthStatus): string {
  switch (status) {
    case "healthy":
      return "This check succeeded.";
    case "degraded":
      return "This check is working with a limitation.";
    case "unavailable":
      return "This check could not be completed.";
    default:
      return "This check has not been confirmed.";
  }
}

function safeDetail(message: string): string | undefined {
  const trimmed = message.trim();
  if (!trimmed) return undefined;
  if (/service[_-]?role|apikey|bearer |secret|password|prep_only|\bmock\b/i.test(trimmed)) {
    return "A live check was not run from this screen.";
  }
  return trimmed;
}

function readableLabel(id: string): string {
  const words = id.replaceAll("-", " ").replaceAll("_", " ").trim();
  if (!words) return "Service check";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
