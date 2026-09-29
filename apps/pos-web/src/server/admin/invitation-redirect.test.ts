import { describe, expect, test } from "vitest";
import {
  isCanonicalInvitationRedirect,
  resolveStaffInvitationRedirect,
} from "./invitation-redirect";

describe("staff invitation redirect", () => {
  test("local development accepts localhost and defaults to /auth/invite", () => {
    expect(resolveStaffInvitationRedirect({ APP_ENV: "local" })).toEqual({
      ok: true,
      redirectTo: "http://localhost:3000/auth/invite",
    });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "local",
      APP_ORIGIN: "http://127.0.0.1:3000",
      VERCEL_URL: "cetech-pos-abc123.vercel.app",
    })).toEqual({
      ok: true,
      redirectTo: "http://127.0.0.1:3000/auth/invite",
    });
  });

  test("staging uses the explicit https origin and ignores a Vercel deployment hash", () => {
    const resolved = resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "https://pos-staging.example.com",
      VERCEL_URL: "cetech-pos-staging-abc123.vercel.app",
    });
    expect(resolved).toEqual({
      ok: true,
      redirectTo: "https://pos-staging.example.com/auth/invite",
    });
  });

  test("a configured origin must be a root and is not silently trimmed", () => {
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "https://pos-staging.example.com/some/path",
    })).toEqual({ ok: false, reason: "malformed_origin" });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "https://pos-staging.example.com/?next=/admin",
    })).toEqual({ ok: false, reason: "malformed_origin" });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "https://pos-staging.example.com/#invite",
    })).toEqual({ ok: false, reason: "malformed_origin" });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "local",
      APP_ORIGIN: "http://localhost:3000/pos",
    })).toEqual({ ok: false, reason: "malformed_origin" });
  });

  test("a deployed environment without an explicit origin fails closed", () => {
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      VERCEL_URL: "cetech-pos-staging-abc123.vercel.app",
    })).toEqual({ ok: false, reason: "missing_origin" });
    expect(resolveStaffInvitationRedirect({
      VERCEL_ENV: "preview",
      VERCEL_URL: "cetech-pos-preview-hash.vercel.app",
    })).toEqual({ ok: false, reason: "missing_origin" });
  });

  test("deployed localhost and plain http fail before an invitation can be sent", () => {
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "production",
      APP_ORIGIN: "http://localhost:3000",
    })).toEqual({ ok: false, reason: "localhost_prohibited" });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "https://localhost",
    })).toEqual({ ok: false, reason: "localhost_prohibited" });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "http://pos-staging.example.com",
    })).toEqual({ ok: false, reason: "insecure_origin" });
  });

  test("malformed origins fail closed", () => {
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "not a url",
    })).toEqual({ ok: false, reason: "malformed_origin" });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "local",
      APP_ORIGIN: "javascript:alert(1)",
    })).toEqual({ ok: false, reason: "malformed_origin" });
    expect(resolveStaffInvitationRedirect({
      APP_ENV: "staging",
      APP_ORIGIN: "https://user:secret@pos.example.com",
    })).toEqual({ ok: false, reason: "malformed_origin" });
  });

  test("only the canonical invitation path is accepted by the delivery adapter", () => {
    expect(isCanonicalInvitationRedirect("https://pos.example.com/auth/invite", { allowLocalhost: false })).toBe(true);
    expect(isCanonicalInvitationRedirect("https://pos.example.com/auth/invite?next=/admin", { allowLocalhost: false })).toBe(false);
    expect(isCanonicalInvitationRedirect("http://localhost:3000/auth/invite", { allowLocalhost: true })).toBe(true);
    expect(isCanonicalInvitationRedirect("http://localhost:3000/auth/invite", { allowLocalhost: false })).toBe(false);
    expect(isCanonicalInvitationRedirect("https://pos.example.com/staff/invite", { allowLocalhost: false })).toBe(false);
  });
});
