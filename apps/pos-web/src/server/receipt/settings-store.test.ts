import { expect, test } from "vitest";
import { DEFAULT_RECEIPT_SETTINGS, resolveReceiptPresentation } from "../../core/receipt/settings";
import { createSupabaseReceiptSettingsStore } from "./settings-store";
import type { PosRestFetch } from "../http/server-fetch";

test("sale settings read the existing presentation and upsert explicit presentation only", async () => {
  const presentation = resolveReceiptPresentation({ templateVersion: 1, businessName: "CETECH Tema" });
  const calls: { url: string; body: Record<string, unknown> | undefined }[] = [];
  const fetchImpl: PosRestFetch = async (url, init) => {
    calls.push({ url, body: init.body === undefined ? undefined : JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => [{
      shorten_product_names: false, product_name_max_characters: 40, show_sku: false, presentation,
    }] };
  };
  const store = createSupabaseReceiptSettingsStore({ url: "https://example.test", serviceRoleKey: "synthetic", fetchImpl });
  expect(await store.get("org_a", "loc_a1")).toEqual({ ...DEFAULT_RECEIPT_SETTINGS, presentation });
  expect(calls[0]?.url).toContain("show_sku,presentation");
  await store.upsert("org_a", "loc_a1", { ...DEFAULT_RECEIPT_SETTINGS, presentation: { templateVersion: 1, businessName: "CETECH Tema" } });
  expect(calls[1]?.body?.presentation).toEqual(presentation);
  await store.upsert("org_a", "loc_a1", DEFAULT_RECEIPT_SETTINGS);
  expect(Object.hasOwn(calls[2]?.body ?? {}, "presentation")).toBe(false);
});

test("legacy null presentation loads three-field settings and invalid persisted presentation cannot print", async () => {
  const create = (presentation: unknown) => createSupabaseReceiptSettingsStore({
    url: "https://example.test", serviceRoleKey: "synthetic",
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => [{
      shorten_product_names: true, product_name_max_characters: 18, show_sku: true, presentation,
    }] }),
  });
  expect(await create(null).get("org_a", "loc_a1")).toEqual({ shortenProductNames: true, productNameMaxCharacters: 18, showSku: true });
  expect(await create({ templateVersion: 1, logoDataUrl: "https://example.test/logo.png" }).get("org_a", "loc_a1")).toEqual(DEFAULT_RECEIPT_SETTINGS);
});

test("sale resolver reads organization defaults and local overrides together without replacing legacy local settings", async () => {
  let override: unknown = { showSku: false, presentation: { address: "Local address", logoDataUrl: null } };
  const store = createSupabaseReceiptSettingsStore({ url: "https://example.test", serviceRoleKey: "synthetic", fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => [
      { location_id: null, shorten_product_names: false, product_name_max_characters: 40, show_sku: true, presentation: { templateVersion: 1, businessName: "Shared", address: "Shared", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" } },
      { location_id: "loc_a1", shorten_product_names: true, product_name_max_characters: 12, show_sku: true, presentation: { templateVersion: 1, businessName: "Old branch" }, settings_override: override },
    ] }) });
  expect(await store.get("org_a", "loc_a1")).toMatchObject({ showSku: false, presentation: { businessName: "Shared", address: "Local address" } });
  expect((await store.get("org_a", "loc_a1")).presentation).not.toHaveProperty("logoDataUrl");
  override = null;
  expect(await store.get("org_a", "loc_a1")).toMatchObject({ shortenProductNames: true, productNameMaxCharacters: 12, presentation: { businessName: "Old branch" } });
});
