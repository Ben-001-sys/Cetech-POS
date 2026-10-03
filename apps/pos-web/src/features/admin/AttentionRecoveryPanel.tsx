"use client";

import { useEffect, useRef, useState } from "react";
import type { ApiResult } from "../../../../../docs/contracts/ports";
import type { PreparedSale } from "../../../../../docs/contracts/domain.generated";
import type { ManagementSaleRecoveryView } from "../../server/admin/management-sale-recovery";
import { formatMoneyLabel } from "../../ui/cashier-language";

type RecoveryDisplay = {
  readonly contextKey: string;
  readonly transactionId: string;
  readonly message: string;
  readonly view?: ManagementSaleRecoveryView;
};

/** Manager capabilities come from current server evidence, never local ownership. */
export function AttentionRecoveryPanel({
  transactionIds, contextKey, loadRecovery, repairSale, onChanged,
}: {
  readonly transactionIds: readonly string[];
  readonly contextKey: string;
  readonly loadRecovery: (transactionId: string) => Promise<ApiResult<ManagementSaleRecoveryView>>;
  readonly repairSale: (transactionId: string) => Promise<ApiResult<PreparedSale>>;
  readonly onChanged?: () => void;
}) {
  const [display, setDisplay] = useState<RecoveryDisplay | null>(null);
  const [pending, setPending] = useState<{ contextKey: string; transactionId: string; kind: "check" | "repair" } | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  useEffect(() => {
    generation.current += 1;
    inFlight.current = false;
    return () => { generation.current += 1; };
  }, [contextKey]);
  const current = display?.contextKey === contextKey ? display : null;
  const currentPending = pending?.contextKey === contextKey ? pending : null;

  async function check(transactionId: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    const token = generation.current;
    setPending({ contextKey, transactionId, kind: "check" });
    setDisplay({ contextKey, transactionId, message: "Checking the original sale…" });
    try {
      const result = await loadRecovery(transactionId);
      if (generation.current !== token) return;
      if (result.ok && result.data.transactionId === transactionId) {
        setDisplay({ contextKey, transactionId, message: result.data.message, view: result.data });
      } else {
        setDisplay({ contextKey, transactionId, message: result.ok ? "The sale check returned a different transaction. Keep the original sale for review." : result.error.message });
      }
    } catch {
      if (generation.current === token) setDisplay({ contextKey, transactionId, message: "The sale could not be checked. Keep it and try the same check again." });
    } finally {
      if (generation.current === token) { inFlight.current = false; setPending(null); }
    }
  }

  async function repair(transactionId: string) {
    if (inFlight.current || current?.transactionId !== transactionId || current.view?.status !== "eligible") return;
    inFlight.current = true;
    const token = generation.current;
    setPending({ contextKey, transactionId, kind: "repair" });
    setDisplay({ contextKey, transactionId, message: "Repairing the existing order… Payment stays closed during this check." });
    try {
      const result = await repairSale(transactionId);
      if (generation.current !== token) return;
      const message = result.ok && result.data.transactionId === transactionId
        ? "Original sale recovered. Manager recovery was recorded. Return to its register and continue that same sale after checking its current status. No payment was taken."
        : result.ok ? "The repair returned a different sale. Keep the original sale for review before taking payment."
          : `${result.error.message} Keep this same sale; do not start it again or take payment.`;
      setDisplay({ contextKey, transactionId, message });
      onChanged?.();
    } catch {
      if (generation.current === token) setDisplay({ contextKey, transactionId, message: "The repair response is unknown. Check this same sale again before taking payment; do not start it again." });
    } finally {
      if (generation.current === token) { inFlight.current = false; setPending(null); }
    }
  }

  const ids = [...new Set(transactionIds)].slice(0, 40);
  if (ids.length === 0) return null;
  return (
    <section className="card card-pad stack" aria-labelledby="manager-sale-recovery-title" data-manager-sale-recovery="true">
      <h2 id="manager-sale-recovery-title">Manager sale recovery</h2>
      <p>Check an existing sale in your location scope. Repair uses its original order and sale request. Choose payment separately after recovery.</p>
      {ids.map((transactionId) => (
        <article className="stack" key={transactionId}>
          <details><summary>Sale reference</summary><p className="muted">{transactionId}</p></details>
          <button className="btn" type="button" disabled={Boolean(currentPending)} onClick={() => void check(transactionId)}>
            {currentPending?.transactionId === transactionId ? currentPending.kind === "repair" ? "Repairing…" : "Checking…" : "Check original sale"}
          </button>
          {current?.transactionId === transactionId ? (
            <div className="stack" role="status" aria-live="polite">
              <p>{current.message}</p>
              {current.view?.orderReference ? <p>Order {current.view.orderReference}</p> : null}
              {current.view?.total ? <p>{formatMoneyLabel(current.view.total)}</p> : null}
              {current.view?.status === "eligible" ? (
                <button className="btn primary" type="button" disabled={Boolean(currentPending)} onClick={() => void repair(transactionId)}>Repair this sale</button>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </section>
  );
}
