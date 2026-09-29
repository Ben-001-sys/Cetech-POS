import { readPublicStaffAuthEnv } from "../../config/env";
import { classifyPasswordGrantDiagnostic } from "./sign-in-diagnostic";
import { reportStaffSignInDiagnostic } from "./report-sign-in-diagnostic";

export type StaffSignInRequest = {
  readonly email?: string;
  readonly password?: string;
};

export type StaffAuthProvider = {
  signIn(request?: StaffSignInRequest): Promise<{ readonly accessToken: string }>;
  signOut(): Promise<void>;
};

type FetchLike = typeof fetch;

export type StaffAuthFailureKind =
  | "invalid_credentials"
  | "access_disabled"
  | "provider_unavailable"
  | "credentials_required"
  | "offline";

export type PublicSupabaseStaffAuthOptions = {
  readonly fetchImpl?: FetchLike;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly isOnline?: () => boolean;
};

export function classifySupabasePasswordGrantFailure(status: number, body: unknown): StaffAuthFailureKind {
  const code = readSupabaseErrorCode(body);
  if (code === "invalid_credentials" || code === "invalid_grant") {
    return "invalid_credentials";
  }
  if (code === "user_banned") {
    return "access_disabled";
  }
  if (status === 400 || status === 401) {
    return "invalid_credentials";
  }
  return "provider_unavailable";
}

/**
 * Transitional Identity adapter. Browser uses the publishable Auth key only.
 * Access tokens are exchanged for the BFF staff session and are not POS authority.
 * Later AccessLobby/OIDC can replace this adapter without changing IdentityPort.
 */
export function createPublicSupabaseStaffAuthProvider(
  options: PublicSupabaseStaffAuthOptions = {},
): StaffAuthProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async signIn(request) {
      const env = readPublicStaffAuthEnv(options.env);
      if (!env) {
        reportGrant({ configured: false });
        throw new StaffAuthError("provider_unavailable", "identity provider is not configured");
      }
      if (options.isOnline && !options.isOnline()) {
        throw new StaffAuthError("offline", "internet connection required to sign in");
      }
      const email = request?.email?.trim() ?? "";
      const password = request?.password ?? "";
      if (!email || !password) {
        throw new StaffAuthError("credentials_required", "staff credentials are required");
      }
      let response: Response;
      try {
        response = await fetchImpl(`${env.url.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
          method: "POST",
          headers: {
            apikey: env.publishableKey,
            authorization: `Bearer ${env.publishableKey}`,
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify({ email, password }),
        });
      } catch (error) {
        const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
        reportGrant({
          configured: true,
          timeout,
          transport: !timeout,
        });
        throw new StaffAuthError("provider_unavailable", "identity provider is unavailable");
      }
      if (!response.ok) {
        const body = await readJson(response);
        const kind = classifySupabasePasswordGrantFailure(response.status, body);
        reportGrant({
          configured: true,
          httpStatus: response.status,
          credentialRejection: kind === "invalid_credentials",
          accessDisabled: kind === "access_disabled",
        });
        throw new StaffAuthError(
          kind,
          kind === "invalid_credentials"
            ? "staff credentials were rejected"
            : kind === "access_disabled"
              ? "staff pos access is disabled"
              : "identity provider is unavailable",
        );
      }
      const payload = (await response.json()) as { access_token?: unknown };
      if (typeof payload.access_token !== "string" || payload.access_token.length < 1) {
        reportGrant({ configured: true, httpStatus: response.status, missingAccessToken: true });
        throw new StaffAuthError("provider_unavailable", "identity provider did not return an access token");
      }
      if (payload.access_token.toUpperCase().includes("SERVICE_ROLE")) {
        throw new StaffAuthError("invalid_credentials", "staff identity could not be verified");
      }
      return { accessToken: payload.access_token };
    },
    async signOut() {
      return;
    },
  };
}

export class StaffAuthError extends Error {
  readonly kind: StaffAuthFailureKind;

  constructor(kind: StaffAuthFailureKind, message: string) {
    super(message);
    this.name = "StaffAuthError";
    this.kind = kind;
  }
}

function reportGrant(input: Parameters<typeof classifyPasswordGrantDiagnostic>[0]): void {
  const reason = classifyPasswordGrantDiagnostic(input);
  if (!reason) return;
  reportStaffSignInDiagnostic({
    reason,
    category: "identity_provider",
    ...(typeof input.httpStatus === "number" ? { httpStatus: input.httpStatus } : {}),
  });
}

function readSupabaseErrorCode(body: unknown): string | null {
  if (body === null || typeof body !== "object") {
    return null;
  }
  const record = body as Record<string, unknown>;
  const code = record.error_code ?? record.error ?? record.code;
  return typeof code === "string" ? code : null;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
