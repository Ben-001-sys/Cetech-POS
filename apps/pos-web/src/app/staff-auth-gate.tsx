"use client";

import { LoginScreen, type AuthNoticeState } from "../features/auth";
import type { StaffSignInRequest } from "../core/identity";
import { toCashierError } from "../ui/cashier-language";

export function StaffAuthGate({
  noticeState,
  busy,
  errorMessage,
  supportReference,
  onSignIn,
}: {
  readonly noticeState: AuthNoticeState;
  readonly busy: boolean;
  readonly errorMessage?: string;
  readonly supportReference?: string;
  readonly onSignIn: (request: StaffSignInRequest) => void;
}) {
  return (
    <div className="staff-auth-gate">
      <LoginScreen
        noticeState={noticeState}
        busy={busy}
        errorMessage={
          errorMessage
            ? toCashierError({ message: errorMessage, domain: "auth" }).message
            : undefined
        }
        supportReference={supportReference}
        onSignIn={onSignIn}
      />
    </div>
  );
}
