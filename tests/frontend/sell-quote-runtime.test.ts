import { describe, expect, test } from "vitest";
import type { Quote } from "../../docs/contracts/domain.generated";
import type { PricingPort } from "../../docs/contracts/ports";
import { checkoutEligibilityFromQuote } from "../../apps/pos-web/src/features/sell/runtime/checkoutEligibility";
import {
  applyQuoteStateForRevision,
  expireQuoteIfNeeded,
  requestWholeCartQuote,
  quotingState,
} from "../../apps/pos-web/src/features/sell/runtime/quoteRequest";
import { previousConfirmedQuoteForRequest, remoteQuoteForCartRevision, shouldIgnoreStaleQuoteResponse } from "../../apps/pos-web/src/features/sell/runtime/useCartQuote";
import { quoteStateToDisplay } from "../../apps/pos-web/src/features/sell/runtime/mapQuoteDisplay";

const CART = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CART_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const LINE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function quoteFixture(
  revision: number,
  totalMinor: number,
  fingerprint: string,
  expiresAt = "2026-09-13T21:00:00.000Z",
  cartId = CART,
): Quote {
  return {
    id: `quote-${fingerprint}`,
    fingerprint,
    cartId,
    cartRevision: revision,
    customer: { kind: "walkin" },
    locationId: "loc-front-1",
    currency: "GHS",
    lines: [
      {
        lineId: LINE,
        productId: "p-hardener",
        quantity: "1",
        unitPrice: { minor: totalMinor, currency: "GHS" },
        subtotal: { minor: totalMinor, currency: "GHS" },
        discount: { minor: 0, currency: "GHS" },
        tax: { minor: 0, currency: "GHS" },
        total: { minor: totalMinor, currency: "GHS" },
        stockStatus: "in_stock",
        purchasable: true,
        problems: [],
      },
    ],
    subtotal: { minor: totalMinor, currency: "GHS" },
    discount: { minor: 0, currency: "GHS" },
    tax: { minor: 0, currency: "GHS" },
    total: { minor: totalMinor, currency: "GHS" },
    calculatedAt: "2026-09-13T20:00:00.000Z",
    expiresAt,
    purchasable: true,
  };
}

describe("FE-04 whole-cart quote revision safety", () => {
  test("a rejected pricing adapter leaves loading and fails checkout closed", async () => {
    const state = await requestWholeCartQuote({ quote: async () => { throw new Error("transport unavailable"); } }, {
      cartId: CART, cartRevision: 2, customer: { kind: "walkin" }, locationId: "loc-front-1",
      lines: [{ lineId: LINE, productId: "p-hardener", quantity: "1" }],
    }, { status: "missing" });
    expect(state).toMatchObject({ status: "failed", revision: 2, code: "INTEGRATION_UNAVAILABLE" });
    expect(checkoutEligibilityFromQuote({ cartEmpty: false, shiftOpen: true, online: true, quote: state }).allowed).toBe(false);
  });
  test("a delayed revision-1 quote cannot overwrite revision 2", () => {
    const quoting = quotingState(2);
    const late = {
      status: "confirmed" as const,
      revision: 1,
      quote: quoteFixture(1, 1500, "old"),
    };
    const kept = applyQuoteStateForRevision({
      currentRevision: 2,
      resultRevision: 1,
      nowIso: "2026-09-13T20:30:00.000Z",
      previous: quoting,
      next: late,
    });
    expect(kept).toEqual(quoting);
  });

  test("expired confirmed quote blocks payment", () => {
    const confirmed = {
      status: "confirmed" as const,
      revision: 3,
      quote: quoteFixture(3, 1500, "now", "2026-09-13T20:00:00.000Z"),
    };
    const expired = expireQuoteIfNeeded(confirmed, "2026-09-13T20:00:01.000Z");
    expect(expired.status).toBe("expired");
    expect(
      checkoutEligibilityFromQuote({
        cartEmpty: false,
        shiftOpen: true,
        online: true,
        quote: expired,
      }),
    ).toMatchObject({ allowed: false, reason: "QUOTE_EXPIRED" });
  });

  test("offline quote blocks payment even with a prior confirmed total", () => {
    expect(
      checkoutEligibilityFromQuote({
        cartEmpty: false,
        shiftOpen: true,
        online: false,
        quote: { status: "offline" },
      }),
    ).toMatchObject({ allowed: false, reason: "CONNECTION_REQUIRED" });
  });

  test("customer or cart revision requotes and displays the authoritative total only", async () => {
    const quotes: Quote[] = [quoteFixture(1, 1500, "a"), quoteFixture(2, 1800, "b")];
    const pricing: PricingPort = {
      async quote(input) {
        const data = quotes.find((item) => item.cartRevision === input.cartRevision) ?? quotes[0]!;
        return { ok: true, data, correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
      },
    };
    const first = await requestWholeCartQuote(pricing, {
      cartId: CART,
      cartRevision: 1,
      customer: { kind: "walkin" },
      locationId: "loc-front-1",
      lines: [{ lineId: LINE, productId: "p-hardener", quantity: "1" }],
    }, { status: "missing" });
    const second = await requestWholeCartQuote(pricing, {
      cartId: CART,
      cartRevision: 2,
      customer: { kind: "b2b", customerId: "cust-buildworks" },
      locationId: "loc-front-1",
      lines: [{ lineId: LINE, productId: "p-hardener", quantity: "1" }],
    }, first);
    expect(first.status).toBe("confirmed");
    expect(second.status).toBe("confirmed");
    if (first.status === "confirmed" && second.status === "confirmed") {
      expect(first.quote.total.minor).toBe(1500);
      expect(second.quote.total.minor).toBe(1800);
      expect(quoteStateToDisplay(second)).toMatchObject({
        status: "confirmed",
        quote: { total: { minor: 1800, currency: "GHS" } },
      });
    }
  });

  test("fingerprint change on the same revision is an explicit review state", async () => {
    const pricing: PricingPort = {
      async quote() {
        return {
          ok: true,
          data: quoteFixture(4, 1900, "after"),
          correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
      },
    };
    const previous = {
      status: "confirmed" as const,
      revision: 4,
      quote: quoteFixture(4, 1500, "before"),
    };
    const next = await requestWholeCartQuote(
      pricing,
      {
        cartId: CART,
        cartRevision: 4,
        customer: { kind: "walkin" },
        locationId: "loc-front-1",
        lines: [{ lineId: LINE, productId: "p-hardener", quantity: "1" }],
      },
      previous,
    );
    expect(next.status).toBe("changed");
    if (next.status === "changed") {
      expect(next.previous.total.minor).toBe(1500);
      expect(next.current.total.minor).toBe(1900);
    }
    expect(
      checkoutEligibilityFromQuote({
        cartEmpty: false,
        shiftOpen: true,
        online: true,
        quote: next,
      }).allowed,
    ).toBe(false);
  });

  test("Pay stays disallowed from a failed quote, distinct from stale or offline", async () => {
    const pricing: PricingPort = {
      async quote() {
        return {
          ok: false,
          error: {
            code: "INTEGRATION_UNAVAILABLE",
            message: "Bridge quote is unavailable.",
            retryable: true,
            nextAction: "retry_same_key",
          },
          correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
      },
    };
    const failed = await requestWholeCartQuote(
      pricing,
      {
        cartId: CART,
        cartRevision: 1,
        customer: { kind: "walkin" },
        locationId: "loc-front-1",
        lines: [{ lineId: LINE, productId: "p-hardener", quantity: "1" }],
      },
      { status: "missing" },
    );
    expect(failed.status).toBe("failed");
    const eligibility = checkoutEligibilityFromQuote({
      cartEmpty: false,
      shiftOpen: true,
      online: true,
      quote: failed,
    });
    expect(eligibility).toMatchObject({ allowed: false, reason: "QUOTE_REQUIRED" });
    expect(
      checkoutEligibilityFromQuote({
        cartEmpty: false,
        shiftOpen: true,
        online: true,
        quote: { status: "stale" },
      }).reason,
    ).toBe("QUOTE_STALE");
  });
});

describe("same-revision previous confirmed quote selection", () => {
  test("reuses confirmed state only for the same cart identity and revision", () => {
    const confirmed = {
      status: "confirmed" as const,
      revision: 4,
      quote: quoteFixture(4, 1500, "before"),
    };
    const stored = { cartId: CART, revision: 4, state: confirmed };
    expect(previousConfirmedQuoteForRequest(stored, CART, 4)).toEqual(confirmed);
    expect(previousConfirmedQuoteForRequest(stored, CART, 5)).toEqual({ status: "missing" });
    expect(previousConfirmedQuoteForRequest(stored, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", 4)).toEqual({
      status: "missing",
    });
    expect(
      previousConfirmedQuoteForRequest(
        { cartId: CART, revision: 4, state: quotingState(4) },
        CART,
        4,
      ),
    ).toEqual({ status: "missing" });
  });

  test("quoting eligibility is blocked while a same-revision fingerprint change is compared", async () => {
    expect(
      checkoutEligibilityFromQuote({
        cartEmpty: false,
        shiftOpen: true,
        online: true,
        quote: quotingState(4),
      }),
    ).toMatchObject({ allowed: false, reason: "QUOTE_REQUIRED" });

    const stored = {
      cartId: CART,
      revision: 4,
      state: {
        status: "confirmed" as const,
        revision: 4,
        quote: quoteFixture(4, 1500, "before"),
      },
    };
    const pricing: PricingPort = {
      async quote() {
        return {
          ok: true,
          data: quoteFixture(4, 1800, "after"),
          correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
      },
    };
    const previous = previousConfirmedQuoteForRequest(stored, CART, 4);
    const next = await requestWholeCartQuote(
      pricing,
      {
        cartId: CART,
        cartRevision: 4,
        customer: { kind: "walkin" },
        locationId: "loc-front-1",
        lines: [{ lineId: LINE, productId: "p-hardener", quantity: "1" }],
      },
      previous,
    );
    expect(next.status).toBe("changed");
    if (next.status === "changed") {
      expect(next.previous.fingerprint).toBe("before");
      expect(next.current.fingerprint).toBe("after");
    }
    expect(
      checkoutEligibilityFromQuote({
        cartEmpty: false,
        shiftOpen: true,
        online: true,
        quote: next,
      }),
    ).toMatchObject({ allowed: false, reason: "QUOTE_REQUIRED" });
  });
});

describe("quote authority is scoped by cart identity and revision", () => {
  test("render selection requires both cartId and revision", () => {
    const confirmed = {
      status: "confirmed" as const,
      revision: 1,
      quote: quoteFixture(1, 4000, "cart-a"),
    };
    const stored = { cartId: CART, revision: 1, state: confirmed };
    expect(remoteQuoteForCartRevision(stored, CART, 1)?.state).toEqual(confirmed);
    expect(remoteQuoteForCartRevision(stored, CART_B, 1)).toBeNull();
    expect(remoteQuoteForCartRevision(stored, CART, 4)).toBeNull();
    expect(remoteQuoteForCartRevision(stored, undefined, 1)).toBeNull();
  });

  test("a higher Cart A revision cannot suppress a lower Cart B response", () => {
    const cartA = {
      cartId: CART,
      revision: 4,
      state: { status: "confirmed" as const, revision: 4, quote: quoteFixture(4, 4000, "cart-a") },
    };
    expect(shouldIgnoreStaleQuoteResponse(cartA, CART_B, 1)).toBe(false);
    expect(shouldIgnoreStaleQuoteResponse(cartA, CART, 1)).toBe(true);
  });

  test("same-cart late lower revision is still ignored", () => {
    const cartBRev2 = {
      cartId: CART_B,
      revision: 2,
      state: { status: "confirmed" as const, revision: 2, quote: quoteFixture(2, 1800, "cart-b-2", undefined, CART_B) },
    };
    expect(shouldIgnoreStaleQuoteResponse(cartBRev2, CART_B, 1)).toBe(true);
    expect(shouldIgnoreStaleQuoteResponse(cartBRev2, CART_B, 2)).toBe(false);
    expect(shouldIgnoreStaleQuoteResponse(null, CART_B, 1)).toBe(false);
  });

  test("confirmed Cart A never yields changed for Cart B at any revision", async () => {
    const stored = {
      cartId: CART,
      revision: 1,
      state: { status: "confirmed" as const, revision: 1, quote: quoteFixture(1, 4000, "cart-a") },
    };
    const pricing: PricingPort = {
      async quote(input) {
        return {
          ok: true,
          data: quoteFixture(input.cartRevision, 1500, "cart-b", undefined, input.cartId),
          correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        };
      },
    };
    for (const revision of [1, 0, 4] as const) {
      const previous = previousConfirmedQuoteForRequest(stored, CART_B, revision);
      expect(previous).toEqual({ status: "missing" });
      const next = await requestWholeCartQuote(
        pricing,
        {
          cartId: CART_B,
          cartRevision: revision,
          customer: { kind: "walkin" },
          locationId: "loc-front-1",
          lines: [{ lineId: LINE, productId: "p-hardener", quantity: "1" }],
        },
        previous,
      );
      expect(next.status).toBe("confirmed");
      if (next.status === "confirmed") {
        expect(next.quote.fingerprint).toBe("cart-b");
        expect(next.quote.cartId).toBe(CART_B);
        expect(next.quote.total.minor).toBe(1500);
      }
    }
  });
});
