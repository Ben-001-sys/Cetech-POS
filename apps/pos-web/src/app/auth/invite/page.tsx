"use client";

import { useEffect, useRef, useState } from "react";
import { InviteAcceptanceScreen } from "@/features/auth/InviteAcceptanceScreen";
import {
  acceptStaffInvitation,
  acquireInviteMaterial,
  inviteMaterialIsSecret,
  phaseForInviteMaterial,
  releaseInviteMaterialHolder,
  retireInviteMaterial,
  type InviteAcceptancePhase,
  type InviteMaterial,
} from "@/features/auth/invite-acceptance";

export default function InviteAcceptancePage() {
  const [phase, setPhase] = useState<InviteAcceptancePhase>("checking");
  const [material, setMaterial] = useState<InviteMaterial>({ kind: "missing" });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const busyRef = useRef(false);
  const materialRef = useRef<InviteMaterial>({ kind: "missing" });

  useEffect(() => {
    const captured = acquireInviteMaterial(() => ({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    }));
    if (window.location.search || window.location.hash) {
      window.history.replaceState(null, "", `${window.location.origin}${captured.nextPath}`);
    }
    materialRef.current = captured.material;
    queueMicrotask(() => {
      setMaterial(captured.material);
      setPhase(phaseForInviteMaterial(captured.material));
    });
    return () => {
      releaseInviteMaterialHolder();
    };
  }, []);

  function forgetInvite(): void {
    retireInviteMaterial();
    const cleared: InviteMaterial = { kind: "missing" };
    materialRef.current = cleared;
    setMaterial(cleared);
  }

  async function submit(password: string) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setErrorMessage(null);
    const current = materialRef.current;
    try {
      const result = await acceptStaffInvitation({ material: current, password });
      if (result.ok) {
        forgetInvite();
        setPhase("accepted");
        return;
      }
      if (result.reason === "password_rejected") {
        setErrorMessage(result.message);
        setPhase("ready");
        return;
      }
      if (result.reason === "unavailable") {
        materialRef.current = current;
        setMaterial(current);
        setErrorMessage(null);
        setPhase("unavailable");
        return;
      }
      forgetInvite();
      setPhase(result.reason);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div data-invite-retained={inviteMaterialIsSecret(material) ? "true" : "false"}>
      <InviteAcceptanceScreen
        phase={phase}
        busy={busy}
        errorMessage={errorMessage}
        onSubmit={submit}
      />
    </div>
  );
}
