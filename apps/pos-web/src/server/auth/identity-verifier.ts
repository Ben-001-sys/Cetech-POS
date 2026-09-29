import { parseStaffIdentityClaims, type StaffIdentityClaims } from "./claims";

export type IdentityVerifyFailureReason =
  | "anonymous"
  | "expired"
  | "revoked"
  | "malformed"
  | "access_disabled"
  | "timeout"
  | "unavailable"
  | "transport"
  | "rejected";

export type IdentityVerifyResult =
  | { readonly ok: true; readonly identity: StaffIdentityClaims }
  | { readonly ok: false; readonly reason: IdentityVerifyFailureReason };

export type TokenIntrospection =
  | { readonly status: "active"; readonly payload: unknown }
  | { readonly status: "expired" }
  | { readonly status: "revoked" }
  | { readonly status: "malformed" }
  | { readonly status: "timeout" }
  | { readonly status: "unavailable" }
  | { readonly status: "transport" }
  | { readonly status: "rejected" };

export interface TokenIntrospector {
  introspect(accessToken: string, now: Date): Promise<TokenIntrospection>;
}

export interface StaffIdentityVerifier {
  verify(input: { readonly accessToken?: string; readonly now: Date }): Promise<IdentityVerifyResult>;
}

export function createStaffIdentityVerifier(introspector: TokenIntrospector): StaffIdentityVerifier {
  return {
    async verify({ accessToken, now }) {
      if (!accessToken || accessToken.trim().length < 1) {
        return { ok: false, reason: "anonymous" };
      }
      const introspection = await introspector.introspect(accessToken, now);
      if (introspection.status !== "active") {
        return { ok: false, reason: introspection.status };
      }
      const claims = parseStaffIdentityClaims(introspection.payload);
      if (!claims) {
        return { ok: false, reason: "malformed" };
      }
      if (Date.parse(claims.expiresAt) <= now.getTime()) {
        return { ok: false, reason: "expired" };
      }
      return { ok: true, identity: claims };
    },
  };
}
