import { expect, test, type Page } from "@playwright/test";
import type { ReceiptSettings } from "../../../docs/contracts/domain.generated";
import { DEFAULT_RECEIPT_SETTINGS, resolveReceiptPresentation } from "../src/core/receipt/settings";
import { legacyReceiptSettingsOverride, resolveReceiptSettingsOverride, type ReceiptSettingsOverride } from "../src/core/receipt/settings-override";
import { localDetailsOverride } from "../src/server/admin/receipt-settings-admin-store";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6fWQAAAAASUVORK5CYII=";
async function installSharedSettings(page: Page, options: { emptyLocations?: boolean } = {}) {
  let defaults: ReceiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, presentation: resolveReceiptPresentation() };
  const legacy = new Map<string, ReceiptSettings>([["loc_a1", { ...DEFAULT_RECEIPT_SETTINGS,
    presentation: { templateVersion: 1, businessName: "Accra old branding", address: "Accra address", contactPhone: "Accra phone", taxRegistrationNumber: "Accra tax" } }]]);
  const overrides = new Map<string, ReceiptSettingsOverride>();
  const writes: Record<string, unknown>[] = [];
  const commerce: string[] = [];
  let reads = 0;
  let writeGate: Promise<void> | null = null;
  let releaseWrite: (() => void) | undefined;
  const locations = options.emptyLocations ? [] : [{ id: "loc_a1", name: "Accra Shop", registers: [], devices: [] }, { id: "loc_a2", name: "Tema Shop", registers: [], devices: [] }];
  const data = (value: unknown) => JSON.stringify({ ok: true, data: value, correlationId: CORRELATION });
  page.on("request", request => { if (/\/api\/pos\/v1\/(sales|payments|returns)(\/|$)/.test(request.url())) commerce.push(request.url()); });
  await page.route("**/api/pos/v1/attention", route => route.fulfill({ contentType: "application/json", body: data({ items: [] }) }));
  await page.route("**/api/pos/v1/session", route => route.fulfill({ contentType: "application/json", body: data({
    session: { actorId: "receipt_owner", displayName: "Receipt Owner", organizationId: "org_a", locationIds: [], capabilities: [], expiresAt: "2099-01-01T00:00:00.000Z" }, assignedLocationIds: [], assignedRegisterIds: [],
  }) }));
  await page.route("**/api/pos/v1/admin/context", route => route.fulfill({ contentType: "application/json", body: data({ actorId: "receipt_owner", displayName: "Receipt Owner", organizationId: "org_a", controlRole: "owner", managerLocationIds: [], locationRoles: [], sections: ["overview", "receipt_settings"] }) }));
  await page.route("**/api/pos/v1/admin/topology", route => route.fulfill({ contentType: "application/json", body: data(locations) }));
  await page.route("**/api/pos/v1/admin/receipt-settings**", async route => {
    const params = new URL(route.request().url()).searchParams;
    let scope = params.get("scope") ?? "location";
    let locationId = params.get("locationId") ?? "";
    let affectedLocationCount: number | undefined;
    if (route.request().method() === "GET") reads += 1;
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push(body);
      if (writeGate) { await writeGate; writeGate = null; }
      scope = String(body.scope ?? "location"); locationId = String(body.locationId ?? "");
      if (body.action === "apply_shared") {
        for (const location of locations) {
          const existing = overrides.get(location.id);
          const presentation = existing?.presentation;
          const local = presentation ? { ...DEFAULT_RECEIPT_SETTINGS, presentation: { templateVersion: 1 as const, ...presentation } } as ReceiptSettings : legacy.get(location.id) ?? DEFAULT_RECEIPT_SETTINGS;
          overrides.set(location.id, localDetailsOverride(local));
        }
        affectedLocationCount = locations.length;
      } else if (scope === "organization") defaults = body.settings as ReceiptSettings;
      else if (body.overrides !== undefined) overrides.set(locationId, body.overrides as ReceiptSettingsOverride);
      else legacy.set(locationId, body.settings as ReceiptSettings);
    }
    const override = overrides.get(locationId);
    await route.fulfill({ contentType: "application/json", body: data(scope === "organization" ? {
      locationId: "", scope, settings: defaults, persisted: true, canManage: true, ...(affectedLocationCount === undefined ? {} : { affectedLocationCount }),
    } : { locationId, locationName: locations.find(row => row.id === locationId)?.name, scope,
      settings: override ? resolveReceiptSettingsOverride(defaults, override) : legacy.get(locationId) ?? defaults,
      defaults, ...(override ? { overrides: override } : {}), legacyOverride: !override && legacy.has(locationId), persisted: override !== undefined || legacy.has(locationId), canManage: true }) });
  });
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Receipt settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live receipt preview" })).toBeVisible();
  return { writes, legacy, overrides, commerce, getDefaults: () => defaults, reads: () => reads,
    blockNextWrite: () => { writeGate = new Promise<void>(resolve => { releaseWrite = resolve; }); },
    releaseWrite: () => releaseWrite?.() };
}

test("shared save preserves legacy details; sparse local edits and reviewed bulk apply retain location-specific information", async ({ page }) => {
  const harness = await installSharedSettings(page);
  const scope = page.getByRole("combobox", { name: "Receipt settings scope", exact: true });
  await scope.selectOption("organization");
  await page.getByLabel("Business name", { exact: true }).fill("Shared CETECH");
  await expect(page.getByRole("button", { name: "Apply shared layout to all locations", exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: /^Show SKU on receipts/ }).check();
  await page.getByLabel(/^Receipt logo/).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await page.getByRole("button", { name: "Save shared defaults", exact: true }).click();
  await expect.poll(() => harness.writes.length).toBe(1);
  expect(harness.legacy.get("loc_a1")?.presentation?.businessName).toBe("Accra old branding");
  await scope.selectOption("location");
  await page.getByRole("combobox", { name: "Location", exact: true }).selectOption("loc_a2");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("Shared CETECH");
  await expect(page.getByLabel("Business name", { exact: true })).toBeDisabled();
  await page.getByRole("checkbox", { name: "Customize show sku for this location", exact: true }).check();
  await page.getByRole("checkbox", { name: /^Show SKU on receipts/ }).uncheck();
  await page.getByRole("checkbox", { name: "Customize business address for this location", exact: true }).check();
  await page.getByRole("textbox", { name: "Business address", exact: true }).fill("");
  await page.getByRole("button", { name: "Remove logo", exact: true }).click();
  await page.getByRole("button", { name: "Save location overrides", exact: true }).click();
  await expect.poll(() => harness.writes.length).toBe(2);
  expect(harness.overrides.get("loc_a2")).toEqual({ showSku: false, presentation: { address: "", logoDataUrl: null } });
  await expect(page.locator("[data-receipt-preview] img")).toHaveCount(0);
  await scope.selectOption("organization");
  await page.getByRole("button", { name: "Apply shared layout to all locations", exact: true }).click();
  await expect(page.getByText(/It keeps each location’s address/)).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(harness.writes).toHaveLength(2);
  await page.getByRole("button", { name: "Apply shared layout to all locations", exact: true }).click();
  await page.getByRole("button", { name: "Confirm: apply shared layout", exact: true }).click();
  await expect.poll(() => harness.writes.length).toBe(3);
  expect(harness.overrides.get("loc_a1")).toEqual({ presentation: { address: "Accra address", contactPhone: "Accra phone", taxRegistrationNumber: "Accra tax" } });
  expect(harness.overrides.get("loc_a2")).toEqual({ presentation: { address: "" } });
  await scope.selectOption("location");
  await page.getByRole("combobox", { name: "Location", exact: true }).selectOption("loc_a1");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("Shared CETECH");
  await expect(page.getByRole("textbox", { name: "Business address", exact: true })).toHaveValue("Accra address");
  await expect(page.locator("[data-receipt-preview]").getByText("Accra Shop", { exact: true })).toBeVisible();
  expect(harness.commerce).toEqual([]);
});

test("local legacy settings expose explicit overrides until a reviewed reset; cancel preserves the draft and stored settings", async ({ page }) => {
  const harness = await installSharedSettings(page);
  await page.getByRole("combobox", { name: "Receipt settings scope", exact: true }).selectOption("location");
  await page.getByRole("combobox", { name: "Location", exact: true }).selectOption("loc_a1");
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("Accra old branding");
  await expect(page.getByRole("checkbox", { name: "Customize business name for this location", exact: true })).toBeChecked();
  expect(legacyReceiptSettingsOverride(harness.legacy.get("loc_a1")!).presentation?.logoDataUrl).toBe(null);
  await page.getByRole("button", { name: "Use shared settings for this location", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(harness.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Use shared settings for this location", exact: true }).click();
  await page.getByRole("button", { name: "Confirm: use shared settings", exact: true }).click();
  await expect.poll(() => harness.writes.length).toBe(1);
  expect(harness.overrides.get("loc_a1")).toEqual({});
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("CETECH");
  await expect(page.getByLabel("Business name", { exact: true })).toBeDisabled();
  expect(harness.commerce).toEqual([]);
});


test("an organization with no locations can switch to the empty location view and back to shared defaults", async ({ page }) => {
  const harness = await installSharedSettings(page, { emptyLocations: true });
  const scope = page.getByRole("combobox", { name: "Receipt settings scope", exact: true });
  await scope.selectOption("location");
  await expect(page.getByText("No locations are available for receipt settings.", { exact: true })).toBeVisible();
  await expect(page.getByText("Loading receipt settings…", { exact: true })).toHaveCount(0);
  await scope.selectOption("organization");
  await expect(page.getByRole("heading", { name: "Live receipt preview", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save shared defaults", exact: true })).toBeVisible();
  expect(harness.writes).toHaveLength(0);
});

test("a pending receipt save survives leaving and returning without an older GET winning", async ({ page }) => {
  const harness = await installSharedSettings(page);
  const scope = page.getByRole("combobox", { name: "Receipt settings scope", exact: true });
  await scope.selectOption("organization");
  await page.getByLabel("Business name", { exact: true }).fill("Saved during navigation");
  harness.blockNextWrite();
  const readsBefore = harness.reads();
  await page.getByRole("button", { name: "Save shared defaults", exact: true }).click();
  await expect.poll(() => harness.writes.length).toBe(1);
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("button", { name: "Receipt settings", exact: true }).click();
  await expect(scope).toBeDisabled();
  expect(harness.reads()).toBe(readsBefore);
  harness.releaseWrite();
  await expect(page.getByLabel("Business name", { exact: true })).toHaveValue("Saved during navigation");
  await expect(scope).toBeEnabled();
  await expect.poll(() => harness.reads()).toBeGreaterThan(readsBefore);
  expect(harness.getDefaults().presentation?.businessName).toBe("Saved during navigation");
  expect(harness.commerce).toEqual([]);
});

test("mismatched receipt location and organization responses cannot expose editable settings", async ({ page }) => {
  await installSharedSettings(page);
  await page.route("**/api/pos/v1/admin/receipt-settings**", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: CORRELATION,
    data: { scope: "location", locationId: "loc_b1", locationName: "Wrong location", settings: DEFAULT_RECEIPT_SETTINGS, persisted: true, canManage: true } }) }));
  await page.getByRole("combobox", { name: "Receipt settings scope", exact: true }).selectOption("location");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save location overrides", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Receipt settings scope", exact: true }).selectOption("organization");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save shared defaults", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Business name", { exact: true })).toHaveCount(0);
});
