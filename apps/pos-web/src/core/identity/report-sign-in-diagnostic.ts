import type {
  StaffSignInDiagnosticCategory,
  StaffSignInDiagnosticReason,
} from "./sign-in-diagnostic";

/**
 * Browser-only report of a sign-in failure. The body is the reason enum,
 * an optional HTTP status, and the category. No credentials are accepted.
 */
export function reportStaffSignInDiagnostic(input: {
  readonly reason: StaffSignInDiagnosticReason;
  readonly httpStatus?: number;
  readonly category: StaffSignInDiagnosticCategory;
}): void {
  const correlationId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000";
  if (typeof window === "undefined") {
    return;
  }
  void fetch("/api/pos/v1/session", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
      "x-cetech-sign-in-report": "1",
      "x-correlation-id": correlationId,
    },
    body: JSON.stringify({
      reason: input.reason,
      httpStatus: input.httpStatus ?? null,
      category: input.category,
    }),
  }).catch(() => undefined);
}
