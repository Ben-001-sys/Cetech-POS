import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { InviteAcceptanceScreen } from "./InviteAcceptanceScreen";
import { consumeInviteLocation } from "./invite-acceptance";

describe("InviteAcceptanceScreen", () => {
  test("rendered invitation copy does not include the token or mint a role", () => {
    const secret = "invite-secret-token-value";
    const consumed = consumeInviteLocation({
      pathname: "/auth/invite/",
      search: `?token_hash=${secret}&type=invite&redirect_to=https://evil.example/phish`,
      hash: `#access_token=${secret}`,
    });
    const ready = renderToStaticMarkup(createElement(InviteAcceptanceScreen, { phase: "ready" }));
    const invalid = renderToStaticMarkup(createElement(InviteAcceptanceScreen, { phase: "invalid" }));
    const expired = renderToStaticMarkup(createElement(InviteAcceptanceScreen, { phase: "expired" }));
    const accepted = renderToStaticMarkup(createElement(InviteAcceptanceScreen, { phase: "accepted" }));
    const visible = `${consumed.nextPath}\n${ready}\n${invalid}\n${expired}\n${accepted}`;
    expect(consumed.nextPath).toBe("/auth/invite");
    expect(visible).not.toContain(secret);
    expect(visible).not.toContain("access_token");
    expect(visible).not.toContain("token_hash");
    expect(visible).not.toContain("evil.example");
    expect(ready).toContain("does not assign a role or a register");
    expect(invalid).toContain("not valid");
    expect(expired).toContain("expired");
    expect(accepted).toContain("Sign in");
    expect(accepted).not.toContain("Save password");
  });
});
