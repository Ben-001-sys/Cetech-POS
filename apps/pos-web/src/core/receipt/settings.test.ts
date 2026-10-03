import { describe, expect, test } from "vitest";
import {
  DEFAULT_RECEIPT_SETTINGS,
  DEFAULT_RECEIPT_PRESENTATION,
  isReceiptPresentation,
  resolveReceiptPresentation,
  isReceiptSettings,
  RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_DEFAULT,
} from "./settings";
import { createMemoryReceiptSettingsStore } from "./settings-store";
import { validateCanonicalDef } from "../../server/quotes/canonical-schema";

describe("receipt settings", () => {
  test("defaults keep shortening and SKU off", () => {
    expect(DEFAULT_RECEIPT_SETTINGS).toEqual({
      shortenProductNames: false,
      productNameMaxCharacters: RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_DEFAULT,
      showSku: false,
    });
    expect(validateCanonicalDef("ReceiptSettings", DEFAULT_RECEIPT_SETTINGS)).toBe(true);
  });

  test("rejects out-of-bounds max characters and extra properties", () => {
    expect(isReceiptSettings({ ...DEFAULT_RECEIPT_SETTINGS, productNameMaxCharacters: 0 })).toBe(false);
    expect(isReceiptSettings({ ...DEFAULT_RECEIPT_SETTINGS, productNameMaxCharacters: 257 })).toBe(false);
    expect(isReceiptSettings({ ...DEFAULT_RECEIPT_SETTINGS, extra: true })).toBe(false);
    expect(validateCanonicalDef("ReceiptSettings", { ...DEFAULT_RECEIPT_SETTINGS, productNameMaxCharacters: 0 })).toBe(
      false,
    );
  });

  test("memory store reads defaults then persists an upsert", async () => {
    const store = createMemoryReceiptSettingsStore();
    expect(await store.get("org_a", "loc_a1")).toEqual(DEFAULT_RECEIPT_SETTINGS);
    const saved = await store.upsert("org_a", "loc_a1", {
      shortenProductNames: true,
      productNameMaxCharacters: 18,
      showSku: true,
    });
    expect(saved.showSku).toBe(true);
    expect(await store.get("org_a", "loc_a1")).toEqual(saved);
    expect(await store.get("org_a", "loc_a2")).toEqual(DEFAULT_RECEIPT_SETTINGS);
  });
});


describe("bounded receipt presentation", () => {
  test("resolves an independent copy of reference defaults without changing legacy settings", () => {
    const input = { templateVersion: 1 as const, businessName: "CETECH Tema", showCashier: false };
    const resolved = resolveReceiptPresentation(input);
    expect(resolved).toEqual({ ...DEFAULT_RECEIPT_PRESENTATION, ...input });
    input.businessName = "Changed";
    expect(resolved.businessName).toBe("CETECH Tema");
    expect(resolveReceiptPresentation()).not.toBe(DEFAULT_RECEIPT_PRESENTATION);
    expect(Object.keys(DEFAULT_RECEIPT_SETTINGS)).toHaveLength(3);
    expect(isReceiptSettings({ ...DEFAULT_RECEIPT_SETTINGS, presentation: resolved })).toBe(true);
    expect(validateCanonicalDef("ReceiptSettings", { ...DEFAULT_RECEIPT_SETTINGS, presentation: resolved })).toBe(true);
  });

  test("runtime validation agrees with schema on bounds, flags and safe embedded logos", () => {
    const valid = { templateVersion: 1, businessName: "C".repeat(80), logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" };
    expect(isReceiptPresentation(valid)).toBe(true);
    expect(isReceiptPresentation({ templateVersion: 1, businessName: "😀".repeat(80) })).toBe(true);
    expect(validateCanonicalDef("ReceiptPresentation", valid)).toBe(true);
    const invalid = [
      null, [], { templateVersion: 2 }, { templateVersion: 1, extra: true },
      { templateVersion: 1, businessName: "😀".repeat(81) },
      { templateVersion: 1, address: "a".repeat(301) },
      { templateVersion: 1, footerMessage: "a".repeat(201) },
      { templateVersion: 1, showCustomerName: 1 },
      { templateVersion: 1, logoDataUrl: "https://example.test/logo.png" },
      { templateVersion: 1, logoDataUrl: "data:image/svg+xml;base64,YQ==" },
      { templateVersion: 1, logoDataUrl: "data:image/png;base64," },
      { templateVersion: 1, logoDataUrl: "data:image/png;base64,YQ==" },
      { templateVersion: 1, logoDataUrl: "data:image/jpeg;base64," + "a".repeat(131072) },
    ];
    for (const input of invalid) {
      expect(isReceiptPresentation(input)).toBe(false);
      if (!(input && "logoDataUrl" in input && input.logoDataUrl === "data:image/png;base64,YQ==")) {
        expect(validateCanonicalDef("ReceiptPresentation", input)).toBe(false);
      }
      expect(isReceiptSettings({ ...DEFAULT_RECEIPT_SETTINGS, presentation: input })).toBe(false);
    }
  });
});


test("memory settings isolate nested drafts, returned reads and legacy setting updates", async () => {
  const presentation = { templateVersion: 1 as const, businessName: "Original", footerMessage: "Original footer" };
  const settings = { ...DEFAULT_RECEIPT_SETTINGS, presentation };
  const store = createMemoryReceiptSettingsStore([{ organizationId: "org_a", locationId: "loc_a1", settings }]);
  presentation.businessName = "Mutated input";
  expect((await store.get("org_a", "loc_a1")).presentation?.businessName).toBe("Original");
  const first = await store.get("org_a", "loc_a1");
  Object.assign(first.presentation!, { businessName: "Mutated read" });
  expect((await store.get("org_a", "loc_a1")).presentation?.businessName).toBe("Original");
  const legacyWrite = await store.upsert("org_a", "loc_a1", { ...DEFAULT_RECEIPT_SETTINGS, showSku: true });
  expect(legacyWrite.presentation?.businessName).toBe("Original");
  Object.assign(legacyWrite.presentation!, { businessName: "Mutated result" });
  expect((await store.get("org_a", "loc_a1")).presentation?.businessName).toBe("Original");
});
