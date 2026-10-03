import { describe, expect, test } from "vitest";
import type { Quote, QuoteRequest } from "../../../../../docs/contracts/domain.generated";
import fixtures from "../../../../../tests/contracts/fixtures.json";
import domainSchema from "../../../../../docs/contracts/pos-domain.schema.json";
import { isQuote, isQuoteRequest, validateCanonicalDef } from "./canonical-schema";

type Fixture = {
  readonly name: string;
  readonly schema: string;
  readonly valid: boolean;
  readonly value: unknown;
};

describe("canonical v1 JSON Schema evaluator", () => {
  test("receipt presentation bounds count Unicode characters and keep legacy settings valid", () => {
    expect(validateCanonicalDef("ReceiptPresentation", { templateVersion: 1, businessName: "🎨".repeat(80) })).toBe(true);
    expect(validateCanonicalDef("ReceiptPresentation", { templateVersion: 1, businessName: "🎨".repeat(81) })).toBe(false);
    expect(validateCanonicalDef("ReceiptPresentation", { templateVersion: 2 })).toBe(false);
    expect(validateCanonicalDef("ReceiptPresentation", { templateVersion: 1, logoDataUrl: "https://example.test/logo.png" })).toBe(false);
    expect(validateCanonicalDef("ReceiptSettings", { shortenProductNames: false, productNameMaxCharacters: 40, showSku: false })).toBe(true);
  });
  test("reads QuoteRequest/Quote from the frozen schema file, not a duplicate shape", () => {
    const quoteRequest = domainSchema.$defs.QuoteRequest;
    const quote = domainSchema.$defs.Quote;
    expect(quoteRequest.additionalProperties).toBe(false);
    expect(quote.additionalProperties).toBe(false);
    expect(quoteRequest.required).toEqual(["cartId", "cartRevision", "customer", "locationId", "lines"]);
    expect(quote.properties.fingerprint.minLength).toBe(32);
    expect(isQuoteRequest({ cartId: "not-enough" })).toBe(false);
  });

  test.each(fixtures as Fixture[])("control-plane fixture: $name", (fixture) => {
    expect(validateCanonicalDef(fixture.schema, fixture.value)).toBe(fixture.valid);
  });
});

describe("QuoteRequest / Quote predicates", () => {
  test("accepts a valid walk-in QuoteRequest and Quote pair", () => {
    const request: QuoteRequest = {
      cartId: "00000000-0000-4000-8000-000000000001",
      cartRevision: 1,
      customer: { kind: "walkin" },
      locationId: "store-1",
      lines: [
        {
          lineId: "00000000-0000-4000-8000-000000000001",
          productId: "product-1",
          quantity: "1",
        },
      ],
    };
    const quote: Quote = {
      id: "quote-1",
      fingerprint: "0123456789abcdef0123456789abcdef",
      cartId: request.cartId,
      cartRevision: request.cartRevision,
      customer: request.customer,
      locationId: request.locationId,
      currency: "GHS",
      lines: [
        {
          lineId: request.lines[0]!.lineId,
          productId: request.lines[0]!.productId,
          quantity: request.lines[0]!.quantity,
          unitPrice: { minor: 1500, currency: "GHS" },
          subtotal: { minor: 1500, currency: "GHS" },
          discount: { minor: 0, currency: "GHS" },
          tax: { minor: 0, currency: "GHS" },
          total: { minor: 1500, currency: "GHS" },
          stockStatus: "in_stock",
          purchasable: true,
          problems: [],
        },
      ],
      subtotal: { minor: 1500, currency: "GHS" },
      discount: { minor: 0, currency: "GHS" },
      tax: { minor: 0, currency: "GHS" },
      total: { minor: 1500, currency: "GHS" },
      calculatedAt: "2026-09-13T20:00:00.000Z",
      expiresAt: "2026-09-13T21:00:00.000Z",
      purchasable: true,
    };
    expect(isQuoteRequest(request)).toBe(true);
    expect(isQuote(quote)).toBe(true);
  });
});
