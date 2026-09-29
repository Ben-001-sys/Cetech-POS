import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { StoreHealth, Uuid } from "../../../../../docs/contracts/domain.generated";
import type { StaffAssignmentDirectory } from "../auth/assignments";
import { authFailure } from "../auth/errors";
import type { StaffSessionStore } from "../auth/session-store";
import type { ControlPlaneDirectory } from "./control-plane-directory";
import { loadManagementAuthority } from "./management-authority";
import {
  presentManagementSystemHealth,
  type ManagementSystemHealthView,
} from "./management-system-health";
import { recentStaffSignInDiagnostics } from "../../core/identity/sign-in-diagnostic";

export type { ManagementSystemHealthView };

export async function handleGetManagementSystemHealth(input: {
  readonly correlationId: Uuid;
  readonly cookieHeader?: string;
  readonly now: Date;
  readonly sessions: StaffSessionStore;
  readonly assignments: StaffAssignmentDirectory;
  readonly controlPlane: ControlPlaneDirectory;
  readonly readHealth: () => Promise<StoreHealth | "unavailable">;
}): Promise<ApiResult<ManagementSystemHealthView>> {
  const authority = await loadManagementAuthority(input);
  if (!authority.ok) return authority;
  if (!authority.data.sections.includes("system_health")) {
    return authFailure(
      "FORBIDDEN",
      "system health is outside management authority",
      input.correlationId,
    );
  }

  let health: StoreHealth | "unavailable";
  try {
    health = await input.readHealth();
  } catch {
    health = "unavailable";
  }
  if (health === "unavailable") {
    return authFailure(
      "INTEGRATION_UNAVAILABLE",
      "system health is unavailable",
      input.correlationId,
    );
  }

  return {
    ok: true,
    data: {
      ...presentManagementSystemHealth(health),
      signInDiagnostics: recentStaffSignInDiagnostics(),
    },
    correlationId: input.correlationId,
  };
}
