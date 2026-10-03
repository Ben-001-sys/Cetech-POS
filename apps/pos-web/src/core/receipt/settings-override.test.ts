import { expect, test } from "vitest";
import { DEFAULT_RECEIPT_SETTINGS } from "./settings";
import { createMemoryReceiptSettingsStore } from "./settings-store";
import { isReceiptSettingsOverride, resolveReceiptSettingsOverride } from "./settings-override";
import { buildReceiptSettingsSample } from "../../features/admin/receipt-settings-preview";

const SHARED = { ...DEFAULT_RECEIPT_SETTINGS, showSku: true, presentation: {
  templateVersion: 1 as const, businessName: "CETECH", address: "Shared address", footerMessage: "Shared footer",
  logoDataUrl: "data:image/png;base64,iVBORw0KGgo=", showCashier: true,
} };

test("sparse location fields preserve false, blank text, and explicit logo removal", () => {
  const override = { showSku: false, presentation: { address: "", showCashier: false, logoDataUrl: null } };
  expect(isReceiptSettingsOverride(override)).toBe(true);
  expect(resolveReceiptSettingsOverride(SHARED, override)).toMatchObject({ showSku: false, presentation: { businessName: "CETECH", address: "", showCashier: false } });
  expect(resolveReceiptSettingsOverride(SHARED, override).presentation).not.toHaveProperty("logoDataUrl");
  for (const value of [{ presentation: { templateVersion: 1 } }, { presentation: { logoDataUrl: "https://example.test/logo" } }, { showSku: null }, { productNameMaxCharacters: 0 }, { presentation: null }]) expect(isReceiptSettingsOverride(value)).toBe(false);
});

test("shared defaults reach existing inheriting and newly created locations while legacy local settings remain frozen", async () => {
  const store = createMemoryReceiptSettingsStore();
  store.seed("org_a", "legacy", { ...DEFAULT_RECEIPT_SETTINGS, presentation: { templateVersion: 1, businessName: "Old branch name" } });
  store.seedOverride("org_a", "accra", { presentation: { address: "Accra local address" } });
  store.seedDefaults("org_a", SHARED);
  expect((await store.get("org_a", "accra")).presentation).toMatchObject({ businessName: "CETECH", address: "Accra local address" });
  expect(await store.get("org_a", "new-location")).toEqual(SHARED);
  expect((await store.get("org_a", "legacy")).presentation).toEqual({ templateVersion: 1, businessName: "Old branch name" });
  expect(await store.get("org_b", "accra")).toEqual(DEFAULT_RECEIPT_SETTINGS);
  store.seedOverride("org_a", "legacy", {});
  expect(await store.get("org_a", "legacy")).toMatchObject(SHARED);
});

test("resolved presentation is copied into receipt and later shared edits cannot alter reprints or actual location name", async () => {
  const store = createMemoryReceiptSettingsStore();
  store.seedDefaults("org_a", SHARED);
  const original = buildReceiptSettingsSample(await store.get("org_a", "loc_a"), "Accra Counter");
  store.seedDefaults("org_a", { ...SHARED, presentation: { templateVersion: 1, businessName: "Changed business" } });
  expect(original.presentation?.businessName).toBe("CETECH");
  expect(original.locationName).toBe("Accra Counter");
  expect(original.presentation?.footerMessage).toBe("Shared footer");
});
