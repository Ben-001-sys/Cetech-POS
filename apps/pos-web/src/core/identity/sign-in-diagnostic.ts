/**
 * Support classification for a failed staff sign-in.
 * The record is safe to log or show on an authorized system-health screen.
 * It never carries an email, password, bearer token, access token, service-role secret, or invitation token.
 *
 * `recentStaffSignInDiagnostics()` is the current process only. It is not a
 * durable store and it is not shared across Vercel instances. The canonical
 * cross-instance lookup is the structured `staff_sign_in_diagnostic` log,
 * keyed by `correlationId`.
 */

export const STAFF_SIGN_IN_DIAGNOSTIC_REASONS = [
  "provider_timeout",
  "provider_unavailable",
  "provider_rejected",
  "verifier_malformed",
  "session_store_unavailable",
  "runtime_not_configured",
  "transport_failed",
] as const;

export type StaffSignInDiagnosticReason = (typeof STAFF_SIGN_IN_DIAGNOSTIC_REASONS)[number];

export type StaffSignInDiagnosticCategory = "identity_provider" | "bff_session";

export type StaffSignInHttpStatusClass = "none" | "2xx" | "4xx" | "5xx";

export type StaffSignInDiagnosticDraft = {
  readonly correlationId: string;
  readonly category: StaffSignInDiagnosticCategory;
  readonly httpStatusClass: StaffSignInHttpStatusClass;
  readonly reason: StaffSignInDiagnosticReason;
  readonly sessionStoreReached: boolean;
};

export type StaffSignInDiagnostic = StaffSignInDiagnosticDraft & {
  /** Server clock. A client report cannot choose this value. */
  readonly createdAt: string;
};

const SECRET_PATTERN = /password|bearer |access[_ ]?token|service[_-]?role|@/i;

export function httpStatusClass(status: number | undefined): StaffSignInHttpStatusClass {
  if (typeof status !== "number" || !Number.isFinite(status)) return "none";
  if (status >= 500) return "5xx";
  if (status >= 400) return "4xx";
  if (status >= 200 && status < 300) return "2xx";
  return "none";
}

export function isStaffSignInDiagnosticReason(value: unknown): value is StaffSignInDiagnosticReason {
  return typeof value === "string" && (STAFF_SIGN_IN_DIAGNOSTIC_REASONS as readonly string[]).includes(value);
}

/** Client password-grant failures. Wrong-password and disabled-access stay out of this list. */
export function classifyPasswordGrantDiagnostic(input: {
  readonly configured: boolean;
  readonly timeout?: boolean;
  readonly transport?: boolean;
  readonly httpStatus?: number;
  readonly credentialRejection?: boolean;
  readonly accessDisabled?: boolean;
  readonly missingAccessToken?: boolean;
}): StaffSignInDiagnosticReason | null {
  if (!input.configured) return "runtime_not_configured";
  if (input.timeout) return "provider_timeout";
  if (input.transport) return "transport_failed";
  if (input.accessDisabled || input.credentialRejection) return null;
  if (input.missingAccessToken) return "verifier_malformed";
  if (typeof input.httpStatus === "number" && input.httpStatus >= 500) return "provider_unavailable";
  if (typeof input.httpStatus === "number" && input.httpStatus >= 400) return "provider_rejected";
  return null;
}

export function classifyVerifierDiagnostic(reason: string): StaffSignInDiagnosticReason | null {
  switch (reason) {
    case "timeout":
      return "provider_timeout";
    case "unavailable":
      return "provider_unavailable";
    case "transport":
      return "transport_failed";
    case "rejected":
      return "provider_rejected";
    case "malformed":
      return "verifier_malformed";
    default:
      return null;
  }
}

export function diagnosticFromVerifier(input: {
  readonly correlationId: string;
  readonly reason: string;
  readonly httpStatus?: number;
}): StaffSignInDiagnosticDraft | null {
  const reason = classifyVerifierDiagnostic(input.reason);
  if (!reason) return null;
  return {
    correlationId: input.correlationId,
    category: "bff_session",
    httpStatusClass: httpStatusClass(input.httpStatus),
    reason,
    sessionStoreReached: false,
  };
}

export function sessionStoreDiagnostic(correlationId: string): StaffSignInDiagnosticDraft {
  return {
    correlationId,
    category: "bff_session",
    httpStatusClass: "none",
    reason: "session_store_unavailable",
    sessionStoreReached: true,
  };
}

export function runtimeNotConfiguredDiagnostic(correlationId: string): StaffSignInDiagnosticDraft {
  return {
    correlationId,
    category: "bff_session",
    httpStatusClass: "none",
    reason: "runtime_not_configured",
    sessionStoreReached: false,
  };
}

/**
 * Accepts only the enumerated report. Any secret-shaped text, or any field
 * other than reason / httpStatus / category, is refused.
 */
export function acceptStaffSignInReport(body: unknown, correlationId: string): StaffSignInDiagnosticDraft | null {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.some((key) => !["reason", "httpStatus", "category"].includes(key))) return null;
  const serialized = JSON.stringify(record);
  if (SECRET_PATTERN.test(serialized)) return null;
  if (!isStaffSignInDiagnosticReason(record.reason)) return null;
  const httpStatus = record.httpStatus === null || record.httpStatus === undefined
    ? undefined
    : typeof record.httpStatus === "number"
      ? record.httpStatus
      : null;
  if (httpStatus === null) return null;
  const category = record.category === "bff_session" || record.category === "identity_provider"
    ? record.category
    : record.reason === "transport_failed"
      ? "bff_session"
      : "identity_provider";
  return {
    correlationId,
    category,
    httpStatusClass: httpStatusClass(httpStatus),
    reason: record.reason,
    sessionStoreReached: false,
  };
}

const recent: StaffSignInDiagnostic[] = [];
const LIMIT = 20;

export function recordStaffSignInDiagnostic(
  diagnostic: StaffSignInDiagnosticDraft,
  now: () => Date = () => new Date(),
): void {
  const recorded: StaffSignInDiagnostic = {
    correlationId: diagnostic.correlationId,
    category: diagnostic.category,
    httpStatusClass: diagnostic.httpStatusClass,
    reason: diagnostic.reason,
    sessionStoreReached: diagnostic.sessionStoreReached,
    createdAt: now().toISOString(),
  };
  const serialized = JSON.stringify(recorded);
  if (SECRET_PATTERN.test(serialized)) return;
  recent.push(recorded);
  if (recent.length > LIMIT) recent.shift();
  console.info(JSON.stringify({ event: "staff_sign_in_diagnostic", ...recorded }));
}

export function recentStaffSignInDiagnostics(): readonly StaffSignInDiagnostic[] {
  return [...recent];
}

export function clearStaffSignInDiagnostics(): void {
  recent.length = 0;
}
