import { useEffect, useRef, useState } from "react";
import type { Quote, QuoteRequest, QuoteState } from "../../../../../../docs/contracts/domain.generated";
import type { PricingPort } from "../../../../../../docs/contracts/ports";
import type { CheckoutEligibilityView, QuoteDisplayState } from "../state/quotePresentation";
import type { CartLineView, CustomerSearchResultView, SellWorkspaceState } from "../state/sellView";
import { customerContextFromSelection } from "./mapCartDraft";
import { checkoutEligibilityFromQuote } from "./checkoutEligibility";
import { quoteStateToDisplay } from "./mapQuoteDisplay";
import { expireQuoteIfNeeded, requestWholeCartQuote, quotingState } from "./quoteRequest";

export type UseCartQuoteInput = {
  readonly pricing?: PricingPort;
  readonly workspace: SellWorkspaceState | undefined;
  readonly locationId: string;
  readonly online: boolean;
  readonly shiftOpen: boolean;
  readonly now: () => Date;
};

export type UseCartQuoteResult = {
  readonly quote?: QuoteDisplayState;
  readonly eligibility?: CheckoutEligibilityView;
  readonly confirmedQuote?: Quote;
  readonly retry: () => void;
};

export type StoredRemoteQuote = {
  readonly cartId: string;
  readonly revision: number;
  readonly state: QuoteState;
};

function localQuoteState(input: UseCartQuoteInput): QuoteState | undefined {
  const workspace = input.workspace;
  if (!workspace || workspace.lines.length === 0) {
    return { status: "missing" };
  }
  if (!input.online) {
    return { status: "offline" };
  }
  if (!input.pricing) {
    return {
      status: "failed",
      revision: workspace.cartRevision,
      code: "INTEGRATION_UNAVAILABLE",
      message: "Authoritative whole-cart quote is unavailable.",
    };
  }
  return undefined;
}

function quoteRequestFromCart(
  cartId: string,
  cartRevision: number,
  lines: readonly CartLineView[],
  selectedCustomer: CustomerSearchResultView | null | undefined,
  locationId: string,
): QuoteRequest | null {
  if (lines.length === 0) {
    return null;
  }
  return {
    cartId,
    cartRevision,
    customer: customerContextFromSelection(selectedCustomer ?? null),
    locationId,
    lines: lines.map((line) => ({
      lineId: line.lineId,
      productId: line.catalogItemId,
      variationId: line.variationId,
      quantity: line.quantity,
    })),
  };
}

/** Same cart identity + revision only. A confirmed quote never compares across a different cart or revision. */
export function previousConfirmedQuoteForRequest(
  stored: StoredRemoteQuote | null,
  cartId: string,
  revision: number,
): QuoteState {
  if (stored?.cartId === cartId && stored.revision === revision && stored.state.status === "confirmed") {
    return stored.state;
  }
  return { status: "missing" };
}

/** A stored remote quote is applicable only for this cart identity and revision. */
export function remoteQuoteForCartRevision(
  stored: StoredRemoteQuote | null,
  cartId: string | undefined,
  revision: number,
): StoredRemoteQuote | null {
  if (stored && cartId && stored.cartId === cartId && stored.revision === revision) {
    return stored;
  }
  return null;
}

/** Revision ordering is meaningful only within the same cart identity. */
export function shouldIgnoreStaleQuoteResponse(
  latest: StoredRemoteQuote | null,
  cartId: string,
  requestRevision: number,
): boolean {
  return Boolean(latest && latest.cartId === cartId && latest.revision > requestRevision);
}

export function useCartQuote(input: UseCartQuoteInput): UseCartQuoteResult {
  const [remote, setRemote] = useState<StoredRemoteQuote | null>(null);
  const remoteRef = useRef<StoredRemoteQuote | null>(null);
  const [appliedEpoch, setAppliedEpoch] = useState(0);
  const [onlineEpoch, setOnlineEpoch] = useState(0);
  const [seenOnline, setSeenOnline] = useState(input.online);
  const [retryEpoch, setRetryEpoch] = useState(0);
  const [appliedRetryEpoch, setAppliedRetryEpoch] = useState(0);
  if (input.online !== seenOnline) {
    setSeenOnline(input.online);
    if (input.online) {
      setOnlineEpoch((epoch) => epoch + 1);
    }
  }

  const local = localQuoteState(input);
  const cartId = input.workspace?.cartId;
  const cartRevision = input.workspace?.cartRevision;
  const revision = cartRevision ?? 0;
  const nowIso = input.now().toISOString();
  const awaitingRevalidation = onlineEpoch !== appliedEpoch || retryEpoch !== appliedRetryEpoch;
  const applicableRemote = remoteQuoteForCartRevision(remote, cartId, revision);
  const quote: QuoteState = local
    ?? (awaitingRevalidation
      ? quotingState(revision)
      : applicableRemote
        ? expireQuoteIfNeeded(applicableRemote.state, nowIso)
        : quotingState(revision));

  const lines = input.workspace?.lines;
  const selectedCustomer = input.workspace?.selectedCustomer;
  const pricing = input.pricing;
  const locationId = input.locationId;
  const online = input.online;
  // Restoration and catalog refresh can supply equivalent new objects. Only
  // a changed commercial request should cancel/restart the current quote.
  const requestKey = cartId && cartRevision !== undefined && lines
    ? JSON.stringify(quoteRequestFromCart(cartId, cartRevision, lines, selectedCustomer, locationId))
    : "null";

  useEffect(() => {
    if (requestKey === "null" || !pricing || !online) {
      return;
    }
    const request = JSON.parse(requestKey) as QuoteRequest;
    const requestCartId = request.cartId;
    const requestRevision = request.cartRevision;
    const previous = previousConfirmedQuoteForRequest(remoteRef.current, requestCartId, requestRevision);
    const requestEpoch = onlineEpoch;
    const requestRetryEpoch = retryEpoch;
    let cancelled = false;
    void requestWholeCartQuote(pricing, request, previous).then((next) => {
      if (cancelled) {
        return;
      }
      const latest = remoteRef.current;
      if (shouldIgnoreStaleQuoteResponse(latest, requestCartId, requestRevision)) {
        return;
      }
      const committed: StoredRemoteQuote = {
        cartId: requestCartId,
        revision: requestRevision,
        state: next,
      };
      remoteRef.current = committed;
      setAppliedEpoch(requestEpoch);
      setAppliedRetryEpoch(requestRetryEpoch);
      setRemote(committed);
    });
    return () => {
      cancelled = true;
    };
  }, [requestKey, online, onlineEpoch, pricing, retryEpoch]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const timer = window.setInterval(() => {
      const current = remoteRef.current;
      if (!current) {
        return;
      }
      const nextState = expireQuoteIfNeeded(current.state, new Date().toISOString());
      if (nextState === current.state) {
        return;
      }
      const next = { ...current, state: nextState };
      remoteRef.current = next;
      setRemote(next);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const eligibility = checkoutEligibilityFromQuote({
    cartEmpty: (input.workspace?.lines.length ?? 0) === 0,
    shiftOpen: input.shiftOpen,
    online: input.online,
    quote,
    cartLines: input.workspace?.lines.map((line) => ({ lineId: line.lineId, name: line.name })),
  });

  return {
    quote: quoteStateToDisplay(quote),
    eligibility,
    confirmedQuote: quote.status === "confirmed" ? quote.quote : undefined,
    retry: () => setRetryEpoch((epoch) => epoch + 1),
  };
}
