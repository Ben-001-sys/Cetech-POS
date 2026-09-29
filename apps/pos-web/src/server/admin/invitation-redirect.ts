/**
 * Server-owned staff invitation redirect.
 * Callers cannot choose the destination. Deployed environments never fall
 * back to a Vercel deployment hash or to localhost.
 */
export const STAFF_INVITE_ACCEPT_PATH = "/auth/invite";

export type InvitationRedirectFailure =
  | "missing_origin"
  | "malformed_origin"
  | "insecure_origin"
  | "localhost_prohibited";

export type InvitationRedirectResolution =
  | { readonly ok: true; readonly redirectTo: string }
  | { readonly ok: false; readonly reason: InvitationRedirectFailure };

const DEPLOYED_APP_ENVS = new Set(["staging", "production"]);
const DEPLOYED_VERCEL_ENVS = new Set(["preview", "production"]);

export function isDeployedInvitationEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  const appEnv = (env.APP_ENV ?? "local").trim().toLowerCase();
  const vercelEnv = (env.VERCEL_ENV ?? "").trim().toLowerCase();
  return DEPLOYED_APP_ENVS.has(appEnv) || DEPLOYED_VERCEL_ENVS.has(vercelEnv);
}

export function resolveStaffInvitationRedirect(
  env: Readonly<Record<string, string | undefined>>,
): InvitationRedirectResolution {
  const deployed = isDeployedInvitationEnvironment(env);
  const explicit = env.APP_ORIGIN?.trim() || env.NEXT_PUBLIC_APP_ORIGIN?.trim() || "";
  if (!explicit) {
    if (deployed) return { ok: false, reason: "missing_origin" };
    return { ok: true, redirectTo: `http://localhost:3000${STAFF_INVITE_ACCEPT_PATH}` };
  }

  let parsed: URL;
  try {
    parsed = new URL(explicit);
  } catch {
    return { ok: false, reason: "malformed_origin" };
  }
  if (parsed.username || parsed.password) return { ok: false, reason: "malformed_origin" };
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "malformed_origin" };
  }
  if (!isRootOrigin(parsed)) return { ok: false, reason: "malformed_origin" };

  const local = isLoopbackHost(parsed.hostname);
  if (deployed) {
    if (local) return { ok: false, reason: "localhost_prohibited" };
    if (parsed.protocol !== "https:") return { ok: false, reason: "insecure_origin" };
  } else if (parsed.protocol !== "https:" && !local) {
    return { ok: false, reason: "insecure_origin" };
  }

  return { ok: true, redirectTo: `${parsed.origin}${STAFF_INVITE_ACCEPT_PATH}` };
}

export function isCanonicalInvitationRedirect(
  value: string | undefined,
  options: { readonly allowLocalhost: boolean },
): value is string {
  if (!value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.pathname !== STAFF_INVITE_ACCEPT_PATH) return false;
  if (parsed.search || parsed.hash) return false;
  const local = isLoopbackHost(parsed.hostname);
  if (local && !options.allowLocalhost) return false;
  if (parsed.protocol === "https:") return true;
  return parsed.protocol === "http:" && local && options.allowLocalhost;
}

export function invitationRedirectFailureMessage(reason: InvitationRedirectFailure): string {
  switch (reason) {
    case "missing_origin":
      return "Staff invitations need a configured application address before an email can be sent.";
    case "malformed_origin":
      return "Staff invitations need a valid application address before an email can be sent.";
    case "insecure_origin":
      return "Staff invitations on a deployed environment require an https application address.";
    case "localhost_prohibited":
      return "Staff invitations on a deployed environment cannot use a localhost address.";
  }
}

function isRootOrigin(parsed: URL): boolean {
  if (parsed.search || parsed.hash) return false;
  return parsed.pathname === "" || parsed.pathname === "/";
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}
