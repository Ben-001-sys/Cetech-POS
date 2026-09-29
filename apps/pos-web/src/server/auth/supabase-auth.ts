import { parseStaffIdentityClaims, type StaffIdentityClaims } from "./claims";
import type { TokenIntrospection, TokenIntrospector } from "./identity-verifier";

export type FetchLike = (
  input: string,
  init: { readonly headers: Record<string, string>; readonly signal?: AbortSignal },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly json: () => Promise<unknown> }>;

export type SupabaseAuthIntrospectorOptions = {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly fetchImpl?: FetchLike;
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 5_000;

export function createSupabaseAuthIntrospector(options: SupabaseAuthIntrospectorOptions): TokenIntrospector {
  if (credentialLooksLikeServiceRole(options.publishableKey)) {
    throw new Error("service-role credential must not be used as staff authorization");
  }
  const base = options.supabaseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? defaultFetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async introspect(accessToken, now) {
      if (credentialLooksLikeServiceRole(accessToken)) {
        return { status: "malformed" };
      }
      try {
        const response = await fetchImpl(`${base}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: options.publishableKey,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 401 || response.status === 403) {
          return expiredOrRevoked(accessToken, now);
        }
        if (response.status === 400 || response.status === 422) {
          return { status: "rejected" };
        }
        if (!response.ok) {
          return { status: response.status >= 500 ? "unavailable" : "malformed" };
        }
        const user = await response.json();
        const payload = staffPayloadFromAuthUser(user, accessToken);
        if (!payload) {
          return { status: "malformed" };
        }
        return { status: "active", payload };
      } catch (error) {
        if (isTimeout(error)) {
          return { status: "timeout" };
        }
        if (error instanceof TypeError) {
          return { status: "transport" };
        }
        return { status: "unavailable" };
      }
    },
  };
}

export function mapSupabaseUserToStaffClaims(user: unknown, accessToken: string): StaffIdentityClaims | null {
  const payload = staffPayloadFromAuthUser(user, accessToken);
  return payload ? parseStaffIdentityClaims(payload) : null;
}

function staffPayloadFromAuthUser(user: unknown, accessToken: string): Record<string, unknown> | null {
  if (user === null || typeof user !== "object") {
    return null;
  }
  const root = user as Record<string, unknown>;
  const jwt = decodeJwtPayload(accessToken) ?? {};
  return {
    ...root,
    exp: jwt.exp,
    expiresAt: jwt.expiresAt,
    app_metadata: root.app_metadata,
    user_metadata: root.user_metadata,
  };
}

function expiredOrRevoked(accessToken: string, now: Date): TokenIntrospection {
  const jwt = decodeJwtPayload(accessToken);
  if (typeof jwt?.exp === "number" && jwt.exp * 1000 <= now.getTime()) {
    return { status: "expired" };
  }
  return { status: "revoked" };
}

export function credentialLooksLikeServiceRole(value: string): boolean {
  if (value.toUpperCase().includes("SERVICE_ROLE")) {
    return true;
  }
  const payload = decodeJwtPayload(value);
  return payload?.role === "service_role";
}

export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const payloadPart = parts[1];
  if (!payloadPart) {
    return null;
  }
  try {
    const json = Buffer.from(payloadPart, "base64url").toString("utf8");
    const parsed: unknown = JSON.parse(json);
    if (parsed === null || typeof parsed !== "object") {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isTimeout(error: unknown): boolean {
  return (
    (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "TimeoutError")
  );
}

const defaultFetch: FetchLike = async (input, init) => {
  const response = await fetch(input, init);
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
  };
};
