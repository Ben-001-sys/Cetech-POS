"use client";

import { useEffect, useState } from "react";
import { InviteAcceptanceScreen } from "@/features/auth/InviteAcceptanceScreen";
import {
  acceptStaffInvitation,
  consumeInviteLocation,
  phaseForInviteMaterial,
  type InviteAcceptancePhase,
  type InviteMaterial,
} from "@/features/auth/invite-acceptance";

export default function InviteAcceptancePage() {
  const [phase, setPhase] = useState<InviteAcceptancePhase>("checking");
  const [material, setMaterial] = useState<InviteMaterial>({ kind: "missing" });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const consumed = consumeInviteLocation({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    });
    const clean = `${window.location.origin}${consumed.nextPath}`;
    window.history.replaceState(null, "", clean);
    // Invite tokens arrive in the browser hash after SSR, so they cannot be read during render.
    queueMicrotask(() => {
      setMaterial(consumed.material);
      setPhase(phaseForInviteMaterial(consumed.material));
    });
  }, []);

  async function submit(password: string) {
    setBusy(true);
    setErrorMessage(null);
    const result = await acceptStaffInvitation({ material, password });
    setBusy(false);
    if (result.ok) {
      setPhase("accepted");
      return;
    }
    if (result.reason === "password_rejected") {
      setErrorMessage(result.message);
      return;
    }
    setPhase(result.reason === "unavailable" ? "unavailable" : result.reason);
  }

  return (
    <InviteAcceptanceScreen
      phase={phase}
      busy={busy}
      errorMessage={errorMessage}
      onSubmit={submit}
    />
  );
}
