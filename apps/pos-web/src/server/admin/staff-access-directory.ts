import type { StaffAssignmentRole } from "../auth/roles";
import { isStaffAssignmentRole } from "../auth/roles";
import { isOrganizationControlRole, type OrganizationControlRole } from "../auth/policy";
import type { PosRestFetch } from "../http/server-fetch";

export type StaffAccessLocation = {
  readonly locationId: string;
  readonly role: StaffAssignmentRole;
  readonly registerIds: readonly string[];
};

export type StaffAccessRecord = {
  readonly actorId: string;
  readonly displayName: string;
  readonly email?: string;
  /** Missing Auth identity is not evidence that a login account was disabled. */
  readonly identityStatus?: "linked" | "unlinked";
  readonly authStatus: "active" | "disabled" | "unknown";
  readonly posAccessStatus?: "active" | "disabled";
  readonly controlRole: OrganizationControlRole | null;
  readonly locations: readonly StaffAccessLocation[];
  readonly createdAt?: string;
  readonly lastSignInAt?: string;
};

export interface StaffAccessDirectory {
  listOrganization(input: {
    readonly organizationId: string;
  }): Promise<readonly StaffAccessRecord[] | "unavailable">;
}

export function createMemoryStaffAccessDirectory(
  rows: readonly StaffAccessRecord[] = [],
): StaffAccessDirectory {
  return {
    async listOrganization() {
      return rows;
    },
  };
}

export function createSupabaseStaffAccessDirectory(input: {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
  readonly timeoutMs?: number;
}): StaffAccessDirectory {
  const base = input.url.replace(/\/+$/, "");
  const restRoot = `${base}/rest/v1`;
  const authRoot = `${base}/auth/v1`;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const headers = {
    apikey: input.serviceRoleKey,
    Authorization: `Bearer ${input.serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function getJson(url: string, signal: AbortSignal): Promise<unknown | "unavailable"> {
    if (signal.aborted) return "unavailable";
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<"unavailable">((resolve) => {
        onAbort = () => resolve("unavailable");
        signal.addEventListener("abort", onAbort, { once: true });
      });
      // The same deadline covers every page, operational read, and JSON body.
      // Race it explicitly so even a stalled response body has bounded feedback.
      return await Promise.race([
        (async () => {
          const response = await input.fetchImpl(url, { method: "GET", headers, signal });
          if (!response.ok) return "unavailable";
          return await response.json();
        })(),
        aborted,
      ]);
    } catch {
      return "unavailable";
    } finally {
      if (onAbort) signal.removeEventListener("abort", onAbort);
    }
  }

  async function listAuthUsers(signal: AbortSignal): Promise<ParsedAuthUser[] | "unavailable"> {
    const rows: ParsedAuthUser[] = [];
    const seenUserIds = new Set<string>();
    // Bound a shared-project scan; an incomplete scan must never become a list
    // of supposedly disabled accounts. Identity lookup uses the same page bound.
    for (let page = 1; page <= 5; page += 1) {
      const body = await getJson(`${authRoot}/admin/users?page=${page}&per_page=200`, signal);
      const parsed = parseAuthUsers(body);
      if (!parsed) return "unavailable";
      for (const authUserId of parsed.authUserIds) {
        if (seenUserIds.has(authUserId)) return "unavailable";
        seenUserIds.add(authUserId);
      }
      rows.push(...parsed.rows);
      if (parsed.count < 200) return rows;
    }
    return "unavailable";
  }

  return {
    async listOrganization({ organizationId }) {
      const budget = new AbortController();
      const timer = setTimeout(() => budget.abort(), timeoutMs);
      try {
        const [authBody, locationBody, registerBody, membershipBody, accessBody] = await Promise.all([
          listAuthUsers(budget.signal),
          getJson(
            `${restRoot}/pos_staff_location_assignments?organization_id=eq.${encodeURIComponent(
              organizationId,
            )}&select=actor_id,location_id,role`, budget.signal,
          ),
          getJson(
            `${restRoot}/pos_staff_register_assignments?organization_id=eq.${encodeURIComponent(
              organizationId,
            )}&select=actor_id,location_id,register_id`, budget.signal,
          ),
          getJson(
            `${restRoot}/pos_organization_memberships?organization_id=eq.${encodeURIComponent(
              organizationId,
            )}&select=actor_id,control_role,status`, budget.signal,
          ),
          getJson(
            `${restRoot}/pos_staff_access_controls?organization_id=eq.${encodeURIComponent(
              organizationId,
            )}&select=actor_id,status`, budget.signal,
          ),
        ]);

        if (
          authBody === "unavailable" ||
          locationBody === "unavailable" ||
          registerBody === "unavailable" ||
          membershipBody === "unavailable" ||
          accessBody === "unavailable"
        ) {
          return "unavailable";
        }

        const authUsers = authBody.filter(
          (user) => user.organizationId === organizationId,
        );
        if (![locationBody, registerBody, membershipBody, accessBody].every(Array.isArray)) {
          return "unavailable";
        }
        const locationRows = locationBody as unknown[];
        const registerRows = registerBody as unknown[];
        const membershipRows = membershipBody as unknown[];
        const accessRows = accessBody as unknown[];
        if (
          locationRows.some((row) => !isRecord(row) || !hasId(row.actor_id) || !hasId(row.location_id) || !isStaffAssignmentRole(row.role)) ||
          registerRows.some((row) => !isRecord(row) || !hasId(row.actor_id) || !hasId(row.location_id) || !hasId(row.register_id)) ||
          membershipRows.some((row) => !isRecord(row) || !hasId(row.actor_id) || !isOrganizationControlRole(row.control_role) || !isAccessStatus(row.status)) ||
          accessRows.some((row) => !isRecord(row) || !hasId(row.actor_id) || !isAccessStatus(row.status))
        ) {
          return "unavailable";
        }
        // Multiple login accounts for one actor cannot be consolidated by email
        // or by choosing whichever user the provider listed first.
        if (new Set(authUsers.map((row) => row.actorId)).size !== authUsers.length) {
          return "unavailable";
        }

        const actorIds = new Set<string>();
        authUsers.forEach((row) => actorIds.add(row.actorId));
        for (const row of locationRows) {
          if (isRecord(row) && typeof row.actor_id === "string") actorIds.add(row.actor_id);
        }
        for (const row of membershipRows) {
          if (isRecord(row) && typeof row.actor_id === "string") actorIds.add(row.actor_id);
        }
        for (const row of accessRows) {
          if (isRecord(row) && typeof row.actor_id === "string") actorIds.add(row.actor_id);
        }

        return [...actorIds]
          .map((actorId) => {
            const auth = authUsers.find((row) => row.actorId === actorId);
            const membership = membershipRows.find(
              (row) => isRecord(row) && row.actor_id === actorId,
            );
            const controlRole =
              isRecord(membership) &&
              membership.status === "active" &&
              isOrganizationControlRole(membership.control_role)
                ? membership.control_role
                : null;
            const access = accessRows.find(
              (row) => isRecord(row) && row.actor_id === actorId,
            );
            const posAccessStatus =
              isRecord(access) && access.status === "disabled" ? "disabled" : "active";

            const locations: StaffAccessLocation[] = [];
            for (const row of locationRows) {
              if (!isRecord(row) || row.actor_id !== actorId) continue;
              if (typeof row.location_id !== "string" || !isStaffAssignmentRole(row.role)) continue;
              const registerIds = registerRows.flatMap((registerRow) => {
                if (
                  !isRecord(registerRow) ||
                  registerRow.actor_id !== actorId ||
                  registerRow.location_id !== row.location_id ||
                  typeof registerRow.register_id !== "string"
                ) {
                  return [];
                }
                return [registerRow.register_id];
              });
              locations.push({
                locationId: row.location_id,
                role: row.role,
                registerIds,
              });
            }

            return {
              actorId,
              displayName: auth?.displayName ?? "Unlinked staff reference",
              ...(auth?.email ? { email: auth.email } : {}),
              identityStatus: auth ? "linked" : "unlinked",
              authStatus: auth?.authStatus ?? "unknown",
              posAccessStatus,
              controlRole,
              locations,
              ...(auth?.createdAt ? { createdAt: auth.createdAt } : {}),
              ...(auth?.lastSignInAt ? { lastSignInAt: auth.lastSignInAt } : {}),
            } satisfies StaffAccessRecord;
          })
          .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.actorId.localeCompare(b.actorId));
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

type ParsedAuthUser = {
  readonly actorId: string;
  readonly organizationId: string;
  readonly displayName: string;
  readonly email?: string;
  readonly authStatus: "active" | "disabled";
  readonly createdAt?: string;
  readonly lastSignInAt?: string;
};

function parseAuthUsers(value: unknown): {
  readonly rows: ParsedAuthUser[];
  readonly authUserIds: readonly string[];
  readonly count: number;
} | null {
  if (!isRecord(value) || !Array.isArray(value.users) || value.users.length > 200) return null;
  const rows: ParsedAuthUser[] = [];
  const authUserIds: string[] = [];
  for (const item of value.users) {
    if (!isRecord(item) || typeof item.id !== "string" || item.id.length === 0) return null;
    authUserIds.push(item.id);
    const appMetadata = isRecord(item.app_metadata) ? item.app_metadata : {};
    const userMetadata = isRecord(item.user_metadata) ? item.user_metadata : {};
    const actorId = typeof appMetadata.actor_id === "string" ? appMetadata.actor_id : null;
    const organizationId =
      typeof appMetadata.organization_id === "string"
        ? appMetadata.organization_id
        : null;
    if (!actorId || !organizationId) continue;

    const bannedUntil =
      typeof item.banned_until === "string" ? Date.parse(item.banned_until) : Number.NaN;
    const deleted = item.deleted_at !== null && item.deleted_at !== undefined;
    const disabled = deleted || (!Number.isNaN(bannedUntil) && bannedUntil > Date.now());
    const displayName =
      typeof userMetadata.display_name === "string" && userMetadata.display_name.trim().length > 0
        ? userMetadata.display_name.trim()
        : typeof item.email === "string" && item.email.trim().length > 0
          ? item.email.trim()
          : actorId;

    rows.push({
      actorId,
      organizationId,
      displayName,
      ...(typeof item.email === "string" && item.email.trim().length > 0 ? { email: item.email.trim() } : {}),
      authStatus: disabled ? "disabled" : "active",
      ...(typeof item.created_at === "string" ? { createdAt: item.created_at } : {}),
      ...(typeof item.last_sign_in_at === "string"
        ? { lastSignInAt: item.last_sign_in_at }
        : {}),
    });
  }
  return { rows, authUserIds, count: value.users.length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAccessStatus(value: unknown): value is "active" | "disabled" {
  return value === "active" || value === "disabled";
}
