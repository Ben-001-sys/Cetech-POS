import { isCanonicalInvitationRedirect } from "./invitation-redirect";
import type { PosRestFetch } from "../http/server-fetch";

export type InvitedStaffIdentity = {
  readonly authUserId: string;
  readonly actorId: string;
  readonly organizationId: string;
  readonly email: string;
  readonly displayName: string;
};

export interface StaffIdentityAdminStore {
  invite(input: {
    readonly organizationId: string;
    readonly email: string;
    readonly displayName: string;
    readonly actorId?: string;
    /** Server-resolved `{origin}/auth/invite`. Never taken from the request body. */
    readonly redirectTo?: string;
  }): Promise<InvitedStaffIdentity | "conflict" | "unavailable">;
  createWithTemporaryPassword(input: {
    readonly organizationId: string;
    readonly email: string;
    readonly displayName: string;
    readonly temporaryPassword: string;
    readonly actorId?: string;
  }): Promise<InvitedStaffIdentity | "conflict" | "unavailable">;
  resetTemporaryPassword(input: {
    readonly authUserId: string;
    readonly temporaryPassword: string;
  }): Promise<"ok" | "unavailable">;
  replaceOwnPassword(input: {
    readonly authUserId: string;
    readonly password: string;
  }): Promise<"ok" | "unavailable">;
  findByActor(input: {
    readonly organizationId: string;
    readonly actorId: string;
  }): Promise<{ readonly authUserId: string } | "missing" | "unavailable">;
  suspendAuthUser(authUserId: string): Promise<"ok" | "unavailable">;
}

export function createMemoryStaffIdentityAdminStore(): StaffIdentityAdminStore & {
  readonly rows: InvitedStaffIdentity[];
  readonly inviteCalls: Array<{ readonly email: string; readonly redirectTo: string | null }>;
} {
  const rows: InvitedStaffIdentity[] = [];
  const inviteCalls: Array<{ readonly email: string; readonly redirectTo: string | null }> = [];
  return {
    rows,
    inviteCalls,
    async invite(input) {
      inviteCalls.push({ email: input.email, redirectTo: input.redirectTo ?? null });
      if (rows.some((row) => row.email.toLowerCase() === input.email.toLowerCase())) {
        return "conflict";
      }
      const row: InvitedStaffIdentity = {
        authUserId: crypto.randomUUID(),
        actorId: input.actorId ?? crypto.randomUUID(),
        organizationId: input.organizationId,
        email: input.email,
        displayName: input.displayName,
      };
      rows.push(row);
      return row;
    },
    async createWithTemporaryPassword(input) {
      if (rows.some((row) => row.email.toLowerCase() === input.email.toLowerCase())) {
        return "conflict";
      }
      const row: InvitedStaffIdentity = {
        authUserId: crypto.randomUUID(),
        actorId: input.actorId ?? crypto.randomUUID(),
        organizationId: input.organizationId,
        email: input.email,
        displayName: input.displayName,
      };
      rows.push(row);
      return row;
    },
    async resetTemporaryPassword() {
      return "ok";
    },
    async replaceOwnPassword() {
      return "ok";
    },
    async findByActor(input) {
      const row = rows.find(
        (item) => item.organizationId === input.organizationId && item.actorId === input.actorId,
      );
      return row ? { authUserId: row.authUserId } : "missing";
    },
    async suspendAuthUser() {
      return "ok";
    },
  };
}

export function createSupabaseStaffIdentityAdminStore(input: {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
  readonly timeoutMs?: number;
  /** Local development may invite to localhost. Deployed environments must not. */
  readonly allowLocalhostInvitationRedirect?: boolean;
}): StaffIdentityAdminStore {
  const base = input.url.replace(/\/+$/, "");
  const timeoutMs = input.timeoutMs ?? 8_000;
  const headers = {
    apikey: input.serviceRoleKey,
    Authorization: `Bearer ${input.serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function request(url: string, method: string, body?: unknown) {
    try {
      const response = await input.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let json: unknown = null;
      try {
        json = await response.json();
      } catch {
        json = null;
      }
      return { ok: response.ok, status: response.status, body: json };
    } catch {
      return { ok: false, status: 0, body: null };
    }
  }

  async function suspendAuthUser(authUserId: string): Promise<"ok" | "unavailable"> {
    const result = await request(
      `${base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
      "PUT",
      { ban_duration: "876000h" },
    );
    return result.ok ? "ok" : "unavailable";
  }

  return {
    async invite(value) {
      const allowLocalhost = input.allowLocalhostInvitationRedirect === true;
      if (!isCanonicalInvitationRedirect(value.redirectTo, { allowLocalhost })) {
        return "unavailable";
      }
      const invited = await request(
        `${base}/auth/v1/invite?redirect_to=${encodeURIComponent(value.redirectTo)}`,
        "POST",
        {
          email: value.email,
          data: { display_name: value.displayName },
        },
      );
      if (invited.status === 422 || invited.status === 409) return "conflict";
      if (!invited.ok) return "unavailable";

      const user = extractUser(invited.body);
      if (!user) return "unavailable";
      const actorId = value.actorId ?? crypto.randomUUID();
      const existingAppMetadata =
        user.app_metadata && typeof user.app_metadata === "object" && !Array.isArray(user.app_metadata)
          ? user.app_metadata as Record<string, unknown>
          : {};

      const updated = await request(
        `${base}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
        "PUT",
        {
          app_metadata: {
            ...existingAppMetadata,
            actor_id: actorId,
            organization_id: value.organizationId,
            location_ids: [],
            capabilities: [],
          },
          user_metadata: {
            display_name: value.displayName,
          },
        },
      );
      if (!updated.ok) {
        await suspendAuthUser(user.id);
        return "unavailable";
      }

      return {
        authUserId: user.id,
        actorId,
        organizationId: value.organizationId,
        email: typeof user.email === "string" ? user.email : value.email,
        displayName: value.displayName,
      };
    },
    async createWithTemporaryPassword(value) {
      const actorId = value.actorId ?? crypto.randomUUID();
      const created = await request(`${base}/auth/v1/admin/users`, "POST", {
        email: value.email,
        password: value.temporaryPassword,
        email_confirm: true,
        app_metadata: {
          actor_id: actorId,
          organization_id: value.organizationId,
          location_ids: [],
          capabilities: [],
          must_change_password: true,
        },
        user_metadata: { display_name: value.displayName },
      });
      if (created.status === 422 || created.status === 409) return "conflict";
      if (!created.ok) return "unavailable";
      const user = extractUser(created.body);
      if (!user) return "unavailable";
      return {
        authUserId: user.id,
        actorId,
        organizationId: value.organizationId,
        email: typeof user.email === "string" ? user.email : value.email,
        displayName: value.displayName,
      };
    },
    async resetTemporaryPassword(value) {
      return updatePassword(value.authUserId, value.temporaryPassword, true);
    },
    async replaceOwnPassword(value) {
      return updatePassword(value.authUserId, value.password, false);
    },
    async findByActor(value) {
      for (let page = 1; page <= 5; page += 1) {
        const listed = await request(
          `${base}/auth/v1/admin/users?page=${page}&per_page=200`,
          "GET",
        );
        if (!listed.ok) return "unavailable";
        const users = extractUsers(listed.body);
        const match = users.find((user) => {
          const metadata = user.app_metadata;
          if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
          const row = metadata as Record<string, unknown>;
          return row.actor_id === value.actorId && row.organization_id === value.organizationId;
        });
        if (match) return { authUserId: match.id };
        if (users.length < 200) return "missing";
      }
      return "missing";
    },
    suspendAuthUser,
  };

  async function updatePassword(
    authUserId: string,
    password: string,
    mustChangePassword: boolean,
  ): Promise<"ok" | "unavailable"> {
    const current = await request(
      `${base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
      "GET",
    );
    if (!current.ok) return "unavailable";
    const user = extractUser(current.body);
    if (!user) return "unavailable";
    const existing =
      user.app_metadata && typeof user.app_metadata === "object" && !Array.isArray(user.app_metadata)
        ? user.app_metadata as Record<string, unknown>
        : {};
    const updated = await request(
      `${base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`,
      "PUT",
      {
        password,
        app_metadata: {
          ...existing,
          must_change_password: mustChangePassword,
        },
      },
    );
    return updated.ok ? "ok" : "unavailable";
  }
}

function extractUsers(value: unknown): Array<{
  readonly id: string;
  readonly app_metadata?: unknown;
}> {
  const root = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  const list = root && Array.isArray(root.users) ? root.users : Array.isArray(value) ? value : [];
  return list.flatMap((item) => {
    const user = extractUser(item);
    return user ? [user] : [];
  });
}

function extractUser(value: unknown): {
  readonly id: string;
  readonly email?: string;
  readonly app_metadata?: unknown;
} | null {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? ("user" in (value as Record<string, unknown>)
          ? (value as Record<string, unknown>).user
          : value)
      : null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const row = candidate as Record<string, unknown>;
  if (typeof row.id !== "string") return null;
  return {
    id: row.id,
    ...(typeof row.email === "string" ? { email: row.email } : {}),
    ...(row.app_metadata !== undefined ? { app_metadata: row.app_metadata } : {}),
  };
}
