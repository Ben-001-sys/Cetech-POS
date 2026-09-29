import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { Session } from "../../../../../docs/contracts/domain.generated";
import { STAFF_CSRF_COOKIE, STAFF_CSRF_HEADER } from "../../config/auth";
import type { StaffSessionGateway } from "./staff-identity-port";
import { reportStaffSignInDiagnostic } from "./report-sign-in-diagnostic";
import {
  parseStaffSessionContext,
  type StaffSessionContext,
} from "./staff-session-context";

export type StaffSessionEstablishRequest = {
  readonly accessToken: string;
  readonly correlationId: string;
};

export type StaffSessionBffGateway = StaffSessionGateway & {
  establish(request: StaffSessionEstablishRequest): Promise<ApiResult<StaffSessionContext>>;
  readContext(): Promise<ApiResult<StaffSessionContext>>;
};

type FetchLike = typeof fetch;

export type BffStaffSessionGatewayOptions = {
  readonly fetchImpl?: FetchLike;
  readonly correlationId?: () => string;
  readonly sessionUrl?: string;
};

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}

function asApiResult<T>(value: unknown, fallback: ApiResult<T>): ApiResult<T> {
  if (value !== null && typeof value === "object" && "ok" in value) {
    return value as ApiResult<T>;
  }
  return fallback;
}

function unavailable(correlationId: string, message: string): ApiResult<StaffSessionContext> {
  return {
    ok: false,
    error: {
      code: "INTEGRATION_UNAVAILABLE",
      message,
      retryable: true,
      nextAction: "resolve",
    },
    correlationId,
  };
}

/**
 * Browser BFF session gateway. Mutations send the readable CSRF cookie in
 * x-csrf-token. The HttpOnly staff session cookie is never read from JS.
 */
export function createBffStaffSessionGateway(
  options: BffStaffSessionGatewayOptions = {},
): StaffSessionBffGateway {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sessionUrl = options.sessionUrl ?? "/api/pos/v1/session";
  const correlationId = options.correlationId ?? (() => crypto.randomUUID());

  async function request(
    method: "GET" | "POST" | "DELETE",
    init: { readonly accessToken?: string; readonly csrf?: boolean; readonly correlationId?: string } = {},
  ): Promise<ApiResult<StaffSessionContext>> {
    const correlation = init.correlationId ?? correlationId();
    const headers: Record<string, string> = {
      "x-correlation-id": correlation,
    };
    if (init.accessToken) {
      headers.authorization = `Bearer ${init.accessToken}`;
    }
    if (init.csrf) {
      headers[STAFF_CSRF_HEADER] = readCookie(STAFF_CSRF_COOKIE) ?? "";
    }
    try {
      const response = await fetchImpl(sessionUrl, {
        method,
        credentials: "include",
        headers,
      });
      const body = asApiResult<StaffSessionContext>(
        await response.json(),
        unavailable(correlation, "staff session response was not JSON"),
      );
      if (!body.ok) {
        return init.correlationId ? { ...body, correlationId: init.correlationId } : body;
      }
      const parsed = parseStaffSessionContext(body.data);
      if (!parsed) {
        if (method === "DELETE") {
          return init.correlationId ? { ...body, correlationId: init.correlationId } : body;
        }
        return unavailable(correlation, "staff session payload is invalid");
      }
      return { ok: true, data: parsed, correlationId: init.correlationId ?? body.correlationId };
    } catch {
      reportStaffSignInDiagnostic({
        correlationId: correlation,
        reason: "transport_failed",
        category: "bff_session",
        fetchImpl,
      });
      return unavailable(correlation, "staff session transport failed");
    }
  }

  return {
    async establish(attempt) {
      const posted = await request("POST", {
        accessToken: attempt.accessToken,
        correlationId: attempt.correlationId,
      });
      if (!posted.ok) {
        return posted;
      }
      const recovered = await request("GET", { correlationId: attempt.correlationId });
      // POST only establishes the cookie. Its Session has no register list, so
      // a failed assignment read stays a failure instead of zero assignments.
      return recovered;
    },
    async readContext() {
      return request("GET");
    },
    async read(): Promise<Session | null> {
      const result = await request("GET");
      return result.ok ? result.data.session : null;
    },
    async clear() {
      const result = await request("DELETE", { csrf: true });
      if (!result.ok && result.error.code === "INTEGRATION_UNAVAILABLE") {
        throw new Error("staff session could not be cleared");
      }
    },
  };
}
