import { readPublicStaffAuthEnv } from "../../config/env";
import { chosenPasswordError } from "../../server/auth/password-policy";

export type InviteMaterial =
  | { readonly kind: "session"; readonly accessToken: string }
  | { readonly kind: "verify"; readonly tokenHash: string }
  | { readonly kind: "verify_token"; readonly token: string }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" };

export type InviteAcceptancePhase =
  | "checking"
  | "ready"
  | "invalid"
  | "expired"
  | "accepted"
  | "unavailable";

const SECRET_QUERY_KEYS = new Set([
  "access_token",
  "refresh_token",
  "provider_token",
  "id_token",
  "token",
  "token_hash",
  "code",
]);

export function consumeInviteLocation(input: {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}): { readonly material: InviteMaterial; readonly nextPath: string } {
  const nextPath = input.pathname.replace(/\/+$/, "") || "/auth/invite";
  return {
    material: readInviteMaterial(input.search, input.hash),
    nextPath,
  };
}

export function phaseForInviteMaterial(material: InviteMaterial): InviteAcceptancePhase {
  if (material.kind === "missing" || material.kind === "invalid") return "invalid";
  return "ready";
}

export type HeldInviteMaterial = {
  readonly material: InviteMaterial;
  readonly nextPath: string;
};

/**
 * One browser invitation is captured once. React Strict Mode runs setup,
 * cleanup, and setup again; the second setup must reuse this capture instead
 * of reading the cleaned URL.
 */
let heldInvite: HeldInviteMaterial | null = null;
let inviteHolders = 0;

export function acquireInviteMaterial(
  readLocation: () => { readonly pathname: string; readonly search: string; readonly hash: string },
): HeldInviteMaterial {
  inviteHolders += 1;
  if (heldInvite) return heldInvite;
  const consumed = consumeInviteLocation(readLocation());
  heldInvite = { material: consumed.material, nextPath: consumed.nextPath };
  return heldInvite;
}

export function releaseInviteMaterialHolder(): void {
  inviteHolders = Math.max(0, inviteHolders - 1);
  queueMicrotask(() => {
    if (inviteHolders === 0) retireInviteMaterial();
  });
}

export function retireInviteMaterial(): void {
  heldInvite = null;
}

export function resetInviteMaterialForTests(): void {
  heldInvite = null;
  inviteHolders = 0;
}

export function inviteMaterialIsSecret(material: InviteMaterial): boolean {
  return material.kind === "session" || material.kind === "verify" || material.kind === "verify_token";
}

export type InviteAcceptanceResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "expired" | "unavailable" | "password_rejected";
      readonly message: string;
    };

/**
 * Completes a Supabase invitation by setting a password on the invited Auth user.
 * Does not create a POS session, role, register, or organization membership.
 */
export async function acceptStaffInvitation(input: {
  readonly material: InviteMaterial;
  readonly password: string;
  readonly fetchImpl?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
}): Promise<InviteAcceptanceResult> {
  const passwordError = chosenPasswordError(input.password);
  if (passwordError) {
    return { ok: false, reason: "password_rejected", message: passwordError };
  }
  if (input.material.kind === "missing" || input.material.kind === "invalid") {
    return { ok: false, reason: "invalid", message: INVALID_INVITE_COPY };
  }

  const env = readPublicStaffAuthEnv(input.env ?? publicAuthEnvFromProcess());
  if (!env) {
    return { ok: false, reason: "unavailable", message: UNAVAILABLE_INVITE_COPY };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const root = env.url.replace(/\/+$/, "");
  const headers = {
    apikey: env.publishableKey,
    authorization: `Bearer ${env.publishableKey}`,
    accept: "application/json",
    "content-type": "application/json",
  };

  let accessToken: string;
  try {
    if (input.material.kind === "session") {
      accessToken = input.material.accessToken;
    } else {
      const verified = await fetchImpl(`${root}/auth/v1/verify`, {
        method: "POST",
        headers,
        body: JSON.stringify(
          input.material.kind === "verify"
            ? { type: "invite", token_hash: input.material.tokenHash }
            : { type: "invite", token: input.material.token },
        ),
      });
      const body = await readJson(verified);
      if (!verified.ok) {
        return verifyFailure(verified.status, body);
      }
      if (typeof body.access_token !== "string" || body.access_token.length < 1) {
        return { ok: false, reason: "invalid", message: INVALID_INVITE_COPY };
      }
      accessToken = body.access_token;
    }
  } catch {
    return { ok: false, reason: "unavailable", message: UNAVAILABLE_INVITE_COPY };
  }

  try {
    const updated = await fetchImpl(`${root}/auth/v1/user`, {
      method: "PUT",
      headers: {
        ...headers,
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ password: input.password }),
    });
    const body = await readJson(updated);
    if (!updated.ok) {
      const code = readErrorCode(body);
      if (code.includes("weak") || code.includes("password")) {
        return {
          ok: false,
          reason: "password_rejected",
          message: "Choose a stronger password.",
        };
      }
      if (updated.status === 401 || updated.status === 403) {
        return { ok: false, reason: "expired", message: EXPIRED_INVITE_COPY };
      }
      if (updated.status >= 500 || updated.status === 0) {
        return { ok: false, reason: "unavailable", message: UNAVAILABLE_INVITE_COPY };
      }
      return { ok: false, reason: "invalid", message: INVALID_INVITE_COPY };
    }
  } catch {
    return { ok: false, reason: "unavailable", message: UNAVAILABLE_INVITE_COPY };
  }

  try {
    await fetchImpl(`${root}/auth/v1/logout`, {
      method: "POST",
      headers: {
        ...headers,
        authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    // The password is already saved. Ordinary POS sign-in does not need this Auth session.
  }

  return { ok: true };
}

export const INVALID_INVITE_COPY =
  "This invitation link is not valid. Ask an owner or admin to send a new one.";
export const EXPIRED_INVITE_COPY =
  "This invitation link has expired. Ask an owner or admin to send a new one.";
export const UNAVAILABLE_INVITE_COPY =
  "The invitation service is unavailable. Try again when you are online.";
export const ACCEPTED_INVITE_COPY =
  "Password saved. Sign in with your email and this password. An owner or admin still has to assign your access before you can use the POS.";
export const READY_INVITE_COPY =
  "Set a password for this invitation. You will sign in to the POS separately. This page does not assign a role or a register.";

function readInviteMaterial(search: string, hash: string): InviteMaterial {
  const fromHash = readParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const fromSearch = readParams(search.startsWith("?") ? search.slice(1) : search);
  const hashType = fromHash.get("type");
  const searchType = fromSearch.get("type");
  if (hashType === "invite" && present(fromHash.get("access_token"))) {
    return { kind: "session", accessToken: fromHash.get("access_token")!.trim() };
  }
  if (searchType === "invite" && present(fromSearch.get("access_token"))) {
    return { kind: "session", accessToken: fromSearch.get("access_token")!.trim() };
  }
  if (searchType === "invite" && present(fromSearch.get("token_hash"))) {
    return { kind: "verify", tokenHash: fromSearch.get("token_hash")!.trim() };
  }
  if (hashType === "invite" && present(fromHash.get("token_hash"))) {
    return { kind: "verify", tokenHash: fromHash.get("token_hash")!.trim() };
  }
  if (searchType === "invite" && present(fromSearch.get("token"))) {
    return { kind: "verify_token", token: fromSearch.get("token")!.trim() };
  }
  if (hashType === "invite" && present(fromHash.get("token"))) {
    return { kind: "verify_token", token: fromHash.get("token")!.trim() };
  }
  const hasSecret =
    [...fromHash.keys()].some((key) => SECRET_QUERY_KEYS.has(key)) ||
    [...fromSearch.keys()].some((key) => SECRET_QUERY_KEYS.has(key));
  if (hasSecret || hashType || searchType) return { kind: "invalid" };
  return { kind: "missing" };
}

function readParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  if (!value) return params;
  const parsed = new URLSearchParams(value);
  for (const [key, item] of parsed.entries()) {
    params.set(key, item);
  }
  return params;
}

function present(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function verifyFailure(status: number, body: Record<string, unknown>): InviteAcceptanceResult {
  const code = readErrorCode(body);
  if (status === 410 || code.includes("expired")) {
    return { ok: false, reason: "expired", message: EXPIRED_INVITE_COPY };
  }
  if (status >= 500 || status === 0) {
    return { ok: false, reason: "unavailable", message: UNAVAILABLE_INVITE_COPY };
  }
  return { ok: false, reason: "invalid", message: INVALID_INVITE_COPY };
}

function readErrorCode(body: Record<string, unknown>): string {
  const candidates = [body.error_code, body.error, body.code, body.msg, body.message];
  return candidates
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase();
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const body = await response.json();
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Ignore a non-JSON Auth response.
  }
  return {};
}

function publicAuthEnvFromProcess(): Readonly<Record<string, string | undefined>> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}
