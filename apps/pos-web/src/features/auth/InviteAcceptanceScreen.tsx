"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { chosenPasswordError } from "../../server/auth/password-policy";
import {
  ACCEPTED_INVITE_COPY,
  EXPIRED_INVITE_COPY,
  INVALID_INVITE_COPY,
  READY_INVITE_COPY,
  UNAVAILABLE_INVITE_COPY,
  type InviteAcceptancePhase,
} from "./invite-acceptance";

export function InviteAcceptanceScreen({
  phase,
  busy = false,
  errorMessage,
  onSubmit,
}: {
  readonly phase: InviteAcceptancePhase;
  readonly busy?: boolean;
  readonly errorMessage?: string | null;
  readonly onSubmit?: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [visible, setVisible] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !onSubmit) return;
    const problem = chosenPasswordError(password);
    if (problem) {
      setLocalError(problem);
      return;
    }
    if (password !== confirm) {
      setLocalError("The two passwords do not match.");
      return;
    }
    setLocalError(null);
    onSubmit(password);
  }

  return (
    <main className="auth-screen" id="main-content">
      <section className="card auth-card" aria-labelledby="invite-title">
        <div className="eyebrow">Staff invitation</div>
        <h1 id="invite-title">Accept invitation</h1>
        {phase === "checking" ? <p>Checking invitation…</p> : null}
        {phase === "invalid" ? <div className="banner danger" role="alert">{INVALID_INVITE_COPY}</div> : null}
        {phase === "expired" ? <div className="banner danger" role="alert">{EXPIRED_INVITE_COPY}</div> : null}
        {phase === "unavailable" ? <div className="banner warning" role="alert">{UNAVAILABLE_INVITE_COPY}</div> : null}
        {phase === "accepted" ? (
          <>
            <div className="banner success" role="status">{ACCEPTED_INVITE_COPY}</div>
            <Link className="btn primary" href="/">Sign in</Link>
          </>
        ) : null}
        {phase === "ready" || phase === "unavailable" ? (
          <>
            {phase === "ready" ? <p className="subtle">{READY_INVITE_COPY}</p> : null}
            {errorMessage ? <div className="banner danger" role="alert">{errorMessage}</div> : null}
            {localError ? <div className="banner danger" role="alert">{localError}</div> : null}
            <form className="auth-actions stack" onSubmit={handleSubmit}>
              <label className="field">
                <span>Password</span>
                <input
                  className="input"
                  type={visible ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Confirm password</span>
                <input
                  className="input"
                  type={visible ? "text" : "password"}
                  autoComplete="new-password"
                  value={confirm}
                  disabled={busy}
                  onChange={(event) => setConfirm(event.target.value)}
                />
              </label>
              <button className="btn" type="button" onClick={() => setVisible((current) => !current)}>
                {visible ? "Hide password" : "Show password"}
              </button>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Saving…" : phase === "unavailable" ? "Try again" : "Save password"}
              </button>
            </form>
          </>
        ) : null}
      </section>
    </main>
  );
}
