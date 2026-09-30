import type { PrepareEffectCertainty } from "./types";

const CERTAINTIES = new Set<PrepareEffectCertainty>([
  "none",
  "unknown",
  "not_found",
  "prepared",
  "payment_pending",
  "finalizing",
  "completed",
  "cancelled",
]);

export function effectCertaintyOf(outcome: unknown): PrepareEffectCertainty | undefined {
  if (outcome === null || typeof outcome !== "object" || !("effectCertainty" in outcome)) {
    return undefined;
  }
  const value = (outcome as { effectCertainty?: unknown }).effectCertainty;
  if (typeof value === "string" && CERTAINTIES.has(value as PrepareEffectCertainty)) {
    return value as PrepareEffectCertainty;
  }
  return undefined;
}

/**
 * A pending prepare that already has an intent, and was not explicitly marked
 * effectCertainty "none", may already have reached Woo. Resolve it. Do not acquire it again.
 */
export function claimKindForExistingPrepare(input: {
  readonly status: string;
  readonly outcome: unknown;
  readonly intentPresent: boolean;
}): "acquired" | "in_progress" | "replay" | "repair" {
  if (input.status === "sent") {
    return "in_progress";
  }
  if (input.status === "acknowledged") {
    return "replay";
  }
  if (input.status === "requires_attention") {
    return "repair";
  }
  if (input.status === "pending" && input.intentPresent && effectCertaintyOf(input.outcome) !== "none") {
    return "repair";
  }
  return "acquired";
}
