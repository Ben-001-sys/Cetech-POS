import type {
  StaffSignInDiagnosticCategory,
  StaffSignInDiagnosticReason,
} from "./sign-in-diagnostic";

/**
 * Browser report of a sign-in failure. The correlation id is the one already
 * chosen for that attempt. This function never mints a replacement.
 * The body is the reason enum, an optional HTTP status, and the category.
 */
export function reportStaffSignInDiagnostic(input: {
  readonly correlationId: string;
  readonly reason: StaffSignInDiagnosticReason;
  readonly httpStatus?: number;
  readonly category: StaffSignInDiagnosticCategory;
  readonly fetchImpl?: typeof fetch;
}): void {
  const correlationId = input.correlationId.trim();
  if (!correlationId) return;
  const fetchImpl = input.fetchImpl ?? (typeof window === "undefined" ? undefined : fetch);
  if (!fetchImpl) return;
  void fetchImpl("/api/pos/v1/session", {
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
