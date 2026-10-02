import type { CustomerContext, Quote, QuoteRequest, QuoteState } from "../../../../../../docs/contracts/domain.generated";
import type { PricingPort } from "../../../../../../docs/contracts/ports";
import type { SellWorkspaceState } from "../state/sellView";
import { customerContextFromSelection } from "./mapCartDraft";

export type ApplyQuoteResultInput = {
  readonly currentRevision: number;
  readonly resultRevision: number;
  readonly nowIso: string;
  readonly previous: QuoteState;
  readonly next: QuoteState;
};

/** Delayed quote for an older revision never replaces the current revision's state. */
export function applyQuoteStateForRevision(input: ApplyQuoteResultInput): QuoteState {
  if (input.resultRevision !== input.currentRevision) {
    return input.previous;
  }
  return expireQuoteIfNeeded(input.next, input.nowIso);
}

export function expireQuoteIfNeeded(state: QuoteState, nowIso: string): QuoteState {
  if (state.status !== "confirmed" && state.status !== "changed") {
    return state;
  }
  const expiresAt = state.status === "confirmed" ? state.quote.expiresAt : state.current.expiresAt;
  if (expiresAt <= nowIso) {
    return { status: "expired" };
  }
  return state;
}

export function buildQuoteRequest(
  state: SellWorkspaceState,
  locationId: string,
): QuoteRequest | null {
  if (state.lines.length === 0) {
    return null;
  }
  return {
    cartId: state.cartId,
    cartRevision: state.cartRevision,
    customer: customerContextFromSelection(state.selectedCustomer),
    locationId,
    lines: state.lines.map((line) => ({
      lineId: line.lineId,
      productId: line.catalogItemId,
      variationId: line.variationId,
      quantity: line.quantity,
    })),
  };
}

export async function requestWholeCartQuote(
  pricing: PricingPort,
  request: QuoteRequest,
  previous: QuoteState,
): Promise<QuoteState> {
  let result;
  try {
    result = await pricing.quote(request);
  } catch {
    return {
      status: "failed",
      revision: request.cartRevision,
      code: "INTEGRATION_UNAVAILABLE",
      message: "Price could not be checked. Your cart is saved. Check the price again.",
    };
  }
  if (!result.ok) {
    if (result.error.code === "QUOTE_EXPIRED") {
      return { status: "expired" };
    }
    return {
      status: "failed",
      revision: request.cartRevision,
      code: result.error.code,
      message: result.error.message,
    };
  }
  const quote = result.data;
  if (previous.status === "confirmed" && previous.quote.cartRevision === quote.cartRevision && previous.quote.fingerprint !== quote.fingerprint) {
    return { status: "changed", revision: request.cartRevision, previous: previous.quote, current: quote };
  }
  return { status: "confirmed", revision: request.cartRevision, quote };
}

export function quotingState(revision: number): QuoteState {
  return { status: "quoting", revision };
}

export type CustomerContextView = CustomerContext;
export type WholeCartQuote = Quote;
