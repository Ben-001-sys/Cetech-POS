import { describe, expect, test } from "vitest";
import type { ReceiptSettings, Session } from "../../../../../docs/contracts/domain.generated";
import type { PosRestFetch } from "../http/server-fetch";
import { createMemoryAssignmentDirectory } from "../auth/assignments";
import { createEphemeralInMemoryStaffSessionStore } from "../auth/session-store";
import { DEFAULT_RECEIPT_SETTINGS, resolveReceiptPresentation } from "../../core/receipt/settings";
import { createMemoryControlPlaneDirectory } from "./control-plane-directory";
import {
  handleGetManagementReceiptSettings,
  handleSetManagementReceiptSettings,
} from "./handle-management-receipt-settings";
import {
  createMemoryReceiptSettingsAdminStore,
  createSupabaseReceiptSettingsAdminStore,
} from "./receipt-settings-admin-store";

const NOW = new Date("2026-09-22T16:00:00.000Z");
const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORIGIN = "https://pos.example.test";
const SAVED: ReceiptSettings = {
  shortenProductNames: true,
  productNameMaxCharacters: 18,
  showSku: true,
};

function session(actorId: string, locationIds: readonly string[] = ["loc_a1"]): Session {
  return {
    actorId,
    displayName: actorId,
    organizationId: "org_a",
    locationIds: [...locationIds],
    capabilities: [],
    expiresAt: "2026-09-22T17:00:00.000Z",
  };
}

async function cookieFor(actorId: string, locationIds?: readonly string[]) {
  const sessions = createEphemeralInMemoryStaffSessionStore();
  const id = await sessions.create(
    session(actorId, locationIds),
    "csrf",
    new Date("2026-09-22T17:00:00.000Z"),
  );
  return { sessions, cookieHeader: `cetech_pos_sid=${id}` };
}

function store() {
  const receiptSettings = createMemoryReceiptSettingsAdminStore();
  receiptSettings.seedLocation("org_a", "loc_a1", "Accra Main Store");
  receiptSettings.seedLocation("org_a", "loc_a2", "Tema Harbour");
  receiptSettings.seedLocation("org_b", "loc_b1", "Other Organization");
  receiptSettings.seedSettings("org_b", "loc_b1", SAVED);
  return receiptSettings;
}

function protection() {
  return {
    origin: ORIGIN,
    referer: null,
    csrfCookie: "csrf",
    csrfHeader: "csrf",
    allowedOrigins: [ORIGIN],
  };
}

describe("ADMIN-105 receipt settings administration", () => {
  test("owner reads effective defaults when the location has no stored row", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const receiptSettings = store();
    const result = await handleGetManagementReceiptSettings({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      receiptSettings,
      locationId: "loc_a1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected settings");
    expect(result.data.settings).toEqual(DEFAULT_RECEIPT_SETTINGS);
    expect(result.data.persisted).toBe(false);
    expect(result.data.canManage).toBe(true);
    expect(result.data.locationName).toBe("Accra Main Store");
    expect(receiptSettings.audits).toEqual([]);
  });

  test("admin reads and saves settings for an organization location", async () => {
    const { sessions, cookieHeader } = await cookieFor("admin_a", []);
    const receiptSettings = store();
    const common = {
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "admin_a", controlRole: "admin", status: "active" },
      ]),
      receiptSettings,
      locationId: "loc_a2",
    };
    const saved = await handleSetManagementReceiptSettings({
      ...common,
      protection: protection(),
      settings: SAVED,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) throw new Error("expected save");
    expect(saved.data.settings).toEqual(SAVED);
    expect(saved.data.persisted).toBe(true);
    expect(receiptSettings.audits).toEqual([
      expect.objectContaining({
        action: "receipt_settings.set",
        targetType: "receipt_settings",
        targetId: "loc_a2",
        locationId: "loc_a2",
        organizationId: "org_a",
        actorId: "admin_a",
        before: null,
        after: SAVED,
        correlationId: CORRELATION,
      }),
    ]);
    const read = await handleGetManagementReceiptSettings(common);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("expected read");
    expect(read.data.settings).toEqual(SAVED);
    expect(receiptSettings.audits).toHaveLength(1);
  });

  test("manager can read only a managed location and cannot save", async () => {
    const { sessions, cookieHeader } = await cookieFor("manager_a", ["loc_a1", "loc_a2"]);
    const receiptSettings = store();
    const common = {
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([
        {
          actorId: "manager_a",
          organizationId: "org_a",
          locationRoles: [
            { locationId: "loc_a1", role: "manager" },
            { locationId: "loc_a2", role: "cashier" },
          ],
          registerIds: ["reg_a"],
        },
      ]),
      controlPlane: createMemoryControlPlaneDirectory([]),
      receiptSettings,
    };
    const read = await handleGetManagementReceiptSettings({ ...common, locationId: "loc_a1" });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("expected read");
    expect(read.data.canManage).toBe(false);
    expect(read.data.settings).toEqual(DEFAULT_RECEIPT_SETTINGS);

    const outside = await handleGetManagementReceiptSettings({ ...common, locationId: "loc_a2" });
    expect(outside.ok).toBe(false);
    if (outside.ok) throw new Error("expected forbidden");
    expect(outside.error.code).toBe("FORBIDDEN");

    const saved = await handleSetManagementReceiptSettings({
      ...common,
      locationId: "loc_a1",
      protection: protection(),
      settings: SAVED,
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) throw new Error("expected forbidden");
    expect(saved.error.code).toBe("FORBIDDEN");
    expect(receiptSettings.audits).toEqual([]);
    const unchanged = await handleGetManagementReceiptSettings({ ...common, locationId: "loc_a1" });
    expect(unchanged.ok && unchanged.data.settings).toEqual(DEFAULT_RECEIPT_SETTINGS);
  });

  test("support and cashier are forbidden", async () => {
    const support = await cookieFor("support_a", []);
    const supportResult = await handleGetManagementReceiptSettings({
      correlationId: CORRELATION,
      cookieHeader: support.cookieHeader,
      now: NOW,
      sessions: support.sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "support_a", controlRole: "support", status: "active" },
      ]),
      receiptSettings: store(),
      locationId: "loc_a1",
    });
    expect(supportResult.ok).toBe(false);
    if (supportResult.ok) throw new Error("expected forbidden");
    expect(supportResult.error.code).toBe("FORBIDDEN");

    const cashier = await cookieFor("cashier_a");
    const cashierResult = await handleSetManagementReceiptSettings({
      correlationId: CORRELATION,
      cookieHeader: cashier.cookieHeader,
      now: NOW,
      sessions: cashier.sessions,
      assignments: createMemoryAssignmentDirectory([
        {
          actorId: "cashier_a",
          organizationId: "org_a",
          locationRoles: [{ locationId: "loc_a1", role: "cashier" }],
          registerIds: ["reg_a"],
        },
      ]),
      controlPlane: createMemoryControlPlaneDirectory([]),
      receiptSettings: store(),
      locationId: "loc_a1",
      protection: protection(),
      settings: SAVED,
    });
    expect(cashierResult.ok).toBe(false);
    if (cashierResult.ok) throw new Error("expected forbidden");
    expect(cashierResult.error.code).toBe("FORBIDDEN");
  });

  test("another organization location fails closed", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const receiptSettings = store();
    const common = {
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      receiptSettings,
    };
    const read = await handleGetManagementReceiptSettings({ ...common, locationId: "loc_b1" });
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error("expected invalid location");
    expect(read.error.code).toBe("VALIDATION_ERROR");
    const saved = await handleSetManagementReceiptSettings({
      ...common,
      locationId: "loc_b1",
      protection: protection(),
      settings: SAVED,
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) throw new Error("expected invalid location");
    expect(saved.error.code).toBe("VALIDATION_ERROR");
    expect(receiptSettings.audits).toEqual([]);
  });

  test("invalid location ids and settings are rejected", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const receiptSettings = store();
    const common = {
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      receiptSettings,
      protection: protection(),
    };
    const cases: unknown[] = [
      { ...SAVED, productNameMaxCharacters: 1.5 },
      { ...SAVED, productNameMaxCharacters: 0 },
      { ...SAVED, productNameMaxCharacters: 257 },
      { ...SAVED, productNameMaxCharacters: "18" },
      { ...SAVED, extra: true },
      null,
      ["shortenProductNames"],
    ];
    for (const settings of cases) {
      const result = await handleSetManagementReceiptSettings({
        ...common,
        locationId: "loc_a1",
        settings,
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected validation error");
      expect(result.error.code).toBe("VALIDATION_ERROR");
    }
    const missing = await handleGetManagementReceiptSettings({ ...common, locationId: " " });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("expected validation error");
    expect(missing.error.code).toBe("VALIDATION_ERROR");
    const weird = await handleGetManagementReceiptSettings({ ...common, locationId: "../loc_b1" });
    expect(weird.ok).toBe(false);
    expect(receiptSettings.audits).toEqual([]);
  });

  test("a failed audit does not leave a changed settings row", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const receiptSettings = createMemoryReceiptSettingsAdminStore({ auditFails: true });
    receiptSettings.seedLocation("org_a", "loc_a1", "Accra Main Store");
    receiptSettings.seedSettings("org_a", "loc_a1", DEFAULT_RECEIPT_SETTINGS);
    const saved = await handleSetManagementReceiptSettings({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      receiptSettings,
      locationId: "loc_a1",
      protection: protection(),
      settings: SAVED,
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) throw new Error("expected unavailable");
    expect(saved.error.code).toBe("INTEGRATION_UNAVAILABLE");
    expect(receiptSettings.audits).toEqual([]);
    const read = await handleGetManagementReceiptSettings({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      receiptSettings,
      locationId: "loc_a1",
    });
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("expected unchanged settings");
    expect(read.data.settings).toEqual(DEFAULT_RECEIPT_SETTINGS);
  });

  test("infrastructure failure is not reported as default settings", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const result = await handleGetManagementReceiptSettings({
      correlationId: CORRELATION,
      cookieHeader,
      now: NOW,
      sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      receiptSettings: { async read() { return "unavailable"; }, async set() { return "unavailable"; } },
      locationId: "loc_a1",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected unavailable");
    expect(result.error.code).toBe("INTEGRATION_UNAVAILABLE");
  });
});

describe("ADMIN-105 receipt settings supabase boundary", () => {
  test("reads with GET only and saves through the audited RPC", async () => {
    const calls: string[] = [];
    let savedRow: Record<string, unknown> | undefined;
    const fetchImpl: PosRestFetch = async (url, init) => {
      calls.push(`${init.method ?? "GET"} ${url}`);
      if (url.includes("/rpc/pos_admin_set_receipt_settings")) {
        const body = JSON.parse(String(init.body)) as { p_location_id: string };
        expect(body.p_location_id).toBe("loc_a1");
        expect(init.method).toBe("POST");
        savedRow = { location_id: "loc_a1", shorten_product_names: true, product_name_max_characters: 18, show_sku: false };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            locationId: "loc_a1",
            shortenProductNames: true,
            productNameMaxCharacters: 18,
            showSku: false,
          }),
        };
      }
      if (url.includes("pos_locations")) {
        return { ok: true, status: 200, json: async () => [{ id: "loc_a1", name: "Accra Main Store" }] };
      }
      return { ok: true, status: 200, json: async () => savedRow ? [savedRow] : [] };
    };
    const directory = createSupabaseReceiptSettingsAdminStore({
      url: "https://example.test",
      serviceRoleKey: "service-role",
      fetchImpl,
    });
    const read = await directory.read({ organizationId: "org_a", locationId: "loc_a1" });
    expect(read).toMatchObject({ persisted: false, settings: DEFAULT_RECEIPT_SETTINGS });
    expect(calls.every((call) => call.startsWith("GET "))).toBe(true);
    const saved = await directory.set({
      organizationId: "org_a",
      locationId: "loc_a1",
      actorId: "owner_a",
      correlationId: CORRELATION,
      settings: { shortenProductNames: true, productNameMaxCharacters: 18, showSku: false },
    });
    expect(saved).toMatchObject({
      persisted: true,
      settings: { shortenProductNames: true, productNameMaxCharacters: 18, showSku: false },
    });
    expect(calls.some((call) => call.includes("/rpc/pos_admin_set_receipt_settings"))).toBe(true);
    expect(calls.some((call) => call.includes("pos_receipt_settings") && call.startsWith("POST"))).toBe(false);
  });
});


describe("reference receipt presentation administration", () => {
  test("owner settings preserve branding and audit copies across older writes and caller mutation", async () => {
    const { sessions, cookieHeader } = await cookieFor("owner_a", []);
    const receiptSettings = store();
    const common = {
      correlationId: CORRELATION, cookieHeader, now: NOW, sessions,
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([
        { organizationId: "org_a", actorId: "owner_a", controlRole: "owner", status: "active" },
      ]),
      receiptSettings, locationId: "loc_a1", protection: protection(),
    };
    const presentation = { templateVersion: 1 as const, businessName: "CETECH Tema", showCustomerPhone: false };
    const first = await handleSetManagementReceiptSettings({ ...common, settings: { ...SAVED, presentation } });
    expect(first.ok).toBe(true);
    presentation.businessName = "Mutated draft";
    if (!first.ok) throw new Error("expected save");
    Object.assign(first.data.settings.presentation!, { businessName: "Mutated response" });
    const read = await handleGetManagementReceiptSettings(common);
    expect(read.ok && read.data.settings.presentation?.businessName).toBe("CETECH Tema");
    expect(receiptSettings.audits[0]?.after.presentation?.businessName).toBe("CETECH Tema");
    const legacy = await handleSetManagementReceiptSettings({ ...common, settings: DEFAULT_RECEIPT_SETTINGS });
    expect(legacy.ok && legacy.data.settings.presentation?.businessName).toBe("CETECH Tema");
    expect(receiptSettings.audits[1]?.before?.presentation?.businessName).toBe("CETECH Tema");
    const invalid = await handleSetManagementReceiptSettings({
      ...common, settings: { ...SAVED, presentation: { templateVersion: 1, logoDataUrl: "https://example.test/logo.png" } },
    });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("VALIDATION_ERROR");
    expect(receiptSettings.audits).toHaveLength(2);
  });

  test("Supabase read and audited RPC carry normalized bounded presentation", async () => {
    const presentation = resolveReceiptPresentation({ templateVersion: 1, businessName: "CETECH Tema", showCashier: false });
    const calls: { url: string; body: Record<string, unknown> | undefined }[] = [];
    const fetchImpl: PosRestFetch = async (url, init) => {
      const body = init.body === undefined ? undefined : JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ url, body });
      if (url.includes("pos_locations")) return { ok: true, status: 200, json: async () => [{ name: "Tema" }] };
      if (url.includes("/rpc/")) return { ok: true, status: 200, json: async () => ({ ...SAVED, presentation }) };
      return { ok: true, status: 200, json: async () => [{
        shorten_product_names: SAVED.shortenProductNames,
        product_name_max_characters: SAVED.productNameMaxCharacters,
        show_sku: SAVED.showSku, presentation,
      }] };
    };
    const directory = createSupabaseReceiptSettingsAdminStore({ url: "https://example.test", serviceRoleKey: "synthetic", fetchImpl });
    const read = await directory.read({ organizationId: "org_a", locationId: "loc_a1" });
    expect(read).toMatchObject({ settings: { ...SAVED, presentation }, persisted: true });
    const saved = await directory.set({ organizationId: "org_a", locationId: "loc_a1", actorId: "owner_a", correlationId: CORRELATION,
      settings: { ...SAVED, presentation: { templateVersion: 1, businessName: "CETECH Tema", showCashier: false } },
    });
    expect(saved).toMatchObject({ settings: { ...SAVED, presentation } });
    expect(calls.find(call => call.url.includes("pos_receipt_settings"))?.url).toContain("show_sku,presentation");
    expect(calls.find(call => call.url.includes("/rpc/"))?.body?.p_presentation).toEqual(presentation);
  });
});

describe("shared receipt defaults and explicit overrides", () => {
  async function ownerCommon(receiptSettings = store()) {
    return { correlationId: CORRELATION, now: NOW, ...(await cookieFor("owner_a", [])),
      assignments: createMemoryAssignmentDirectory([]),
      controlPlane: createMemoryControlPlaneDirectory([{ organizationId: "org_a", actorId: "owner_a", controlRole: "owner" as const, status: "active" as const }]),
      receiptSettings, protection: protection() };
  }
  test("owner saves shared defaults without changing existing local rows then explicitly applies shared layout in one action", async () => {
    const receiptSettings = store();
    receiptSettings.seedSettings("org_a", "loc_a1", { ...SAVED, presentation: { templateVersion: 1, businessName: "Old local name", address: "Accra address", contactPhone: "Local phone", taxRegistrationNumber: "Local tax", footerMessage: "Old footer" } });
    const common = await ownerCommon(receiptSettings);
    const shared = { ...DEFAULT_RECEIPT_SETTINGS, presentation: { templateVersion: 1 as const, businessName: "Shared CETECH", footerMessage: "Shared footer", address: "Shared address" } };
    const saved = await handleSetManagementReceiptSettings({ ...common, scope: "organization", settings: shared });
    expect(saved.ok).toBe(true);
    const before = await receiptSettings.read({ organizationId: "org_a", locationId: "loc_a1" });
    expect(before).toMatchObject({ legacyOverride: true, settings: { presentation: { businessName: "Old local name" } } });
    const applied = await handleSetManagementReceiptSettings({ ...common, scope: "organization", action: "apply_shared", settings: undefined });
    expect(applied).toMatchObject({ ok: true, data: { affectedLocationCount: 2 } });
    const local = await receiptSettings.read({ organizationId: "org_a", locationId: "loc_a1" });
    expect(local).toMatchObject({ legacyOverride: false, settings: { showSku: false, presentation: { businessName: "Shared CETECH", footerMessage: "Shared footer", address: "Accra address", contactPhone: "Local phone", taxRegistrationNumber: "Local tax" } } });
    expect(await receiptSettings.read({ organizationId: "org_b", locationId: "loc_b1" })).toMatchObject({ settings: SAVED });
    expect(receiptSettings.audits.filter(audit => audit.action === "receipt_settings.inherit_layout")).toHaveLength(2);
    receiptSettings.seedLocation("org_a", "loc_a3", "New branch");
    expect(await receiptSettings.read({ organizationId: "org_a", locationId: "loc_a3" })).toMatchObject({ settings: shared });
  });
  test("sparse false/blank/null overrides survive save and resetting inherits all shared settings", async () => {
    const common = await ownerCommon();
    await handleSetManagementReceiptSettings({ ...common, scope: "organization", settings: { ...SAVED, presentation: { templateVersion: 1, logoDataUrl: "data:image/png;base64,iVBORw0KGgo=", address: "Shared", showCashier: true } } });
    const saved = await handleSetManagementReceiptSettings({ ...common, scope: "location", locationId: "loc_a1", settings: undefined,
      overrides: { showSku: false, presentation: { logoDataUrl: null, address: "", showCashier: false } } });
    expect(saved).toMatchObject({ ok: true, data: { settings: { showSku: false, presentation: { address: "", showCashier: false } } } });
    if (!saved.ok) throw new Error("expected saved overrides");
    expect(saved.data.settings.presentation).not.toHaveProperty("logoDataUrl");
    const reset = await handleSetManagementReceiptSettings({ ...common, locationId: "loc_a1", settings: undefined, overrides: {} });
    expect(reset).toMatchObject({ ok: true, data: { settings: { showSku: true, presentation: { address: "Shared", showCashier: true } } } });
    const wrong = await handleSetManagementReceiptSettings({ ...common, locationId: "loc_b1", settings: undefined, overrides: {} });
    expect(wrong).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
  });
  test("manager cannot read organization defaults, change sparse overrides or apply shared settings", async () => {
    const common = { correlationId: CORRELATION, now: NOW, ...(await cookieFor("manager_a")), receiptSettings: store(), protection: protection(),
      controlPlane: createMemoryControlPlaneDirectory([]), assignments: createMemoryAssignmentDirectory([{ actorId: "manager_a", organizationId: "org_a", locationRoles: [{ locationId: "loc_a1", role: "manager" }], registerIds: ["reg_a"] }]) };
    expect(await handleGetManagementReceiptSettings({ ...common, scope: "organization" })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await handleSetManagementReceiptSettings({ ...common, locationId: "loc_a1", settings: undefined, overrides: {} })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(await handleSetManagementReceiptSettings({ ...common, scope: "organization", action: "apply_shared", settings: undefined })).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(common.receiptSettings.audits).toHaveLength(0);
  });
  test("bulk audit failure leaves all settings unchanged", async () => {
    const receiptSettings = createMemoryReceiptSettingsAdminStore({ auditFails: true });
    receiptSettings.seedLocation("org_a", "loc_a1", "Accra");
    receiptSettings.seedSettings("org_a", "loc_a1", SAVED);
    const common = await ownerCommon(receiptSettings);
    expect(await handleSetManagementReceiptSettings({ ...common, scope: "organization", action: "apply_shared", settings: undefined })).toMatchObject({ ok: false, error: { code: "INTEGRATION_UNAVAILABLE" } });
    expect(await receiptSettings.read({ organizationId: "org_a", locationId: "loc_a1" })).toMatchObject({ settings: SAVED, legacyOverride: true });
    expect(receiptSettings.audits).toHaveLength(0);
  });
});

test("legacy SKU-only client preserves sparse presentation and Supabase adapter returns effective settings after the save", async () => {
  const shared = { location_id: null, shorten_product_names: false, product_name_max_characters: 40, show_sku: true, presentation: { templateVersion: 1, businessName: "Shared", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" } };
  const local = { location_id: "loc_a1", shorten_product_names: true, product_name_max_characters: 18, show_sku: true,
    presentation: { templateVersion: 1, businessName: "Old stale branding" }, settings_override: { presentation: { address: "New local address" } } as Record<string, unknown> };
  const directory = createSupabaseReceiptSettingsAdminStore({ url: "https://example.test", serviceRoleKey: "synthetic", fetchImpl: async (url, init) => {
    if (url.includes("/rpc/pos_admin_set_receipt_settings")) {
      local.settings_override = { ...local.settings_override, shortenProductNames: false, productNameMaxCharacters: 24, showSku: false };
      return { ok: true, status: 200, json: async () => ({ locationId: "loc_a1", shortenProductNames: false, productNameMaxCharacters: 24, showSku: false, presentation: local.presentation }) };
    }
    if (url.includes("pos_locations")) return { ok: true, status: 200, json: async () => [{ id: "loc_a1", name: "Accra" }] };
    expect(init.method).toBe("GET");
    return { ok: true, status: 200, json: async () => [shared, local] };
  } });
  const saved = await directory.set({ organizationId: "org_a", locationId: "loc_a1", actorId: "owner_a", correlationId: CORRELATION,
    settings: { shortenProductNames: false, productNameMaxCharacters: 24, showSku: false } });
  expect(saved).toMatchObject({ legacyOverride: false, settings: { showSku: false, presentation: { businessName: "Shared", address: "New local address", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" } } });
  const memory = store();
  await memory.set({ organizationId: "org_a", scope: "organization", actorId: "owner_a", correlationId: CORRELATION, settings: { ...DEFAULT_RECEIPT_SETTINGS, presentation: shared.presentation as ReceiptSettings["presentation"] } });
  await memory.set({ organizationId: "org_a", locationId: "loc_a1", actorId: "owner_a", correlationId: CORRELATION, overrides: { presentation: { address: "New local address" } } });
  expect(await memory.set({ organizationId: "org_a", locationId: "loc_a1", actorId: "owner_a", correlationId: CORRELATION, settings: SAVED })).toMatchObject({ legacyOverride: false, settings: { presentation: { businessName: "Shared", address: "New local address", logoDataUrl: "data:image/png;base64,iVBORw0KGgo=" } } });
});

test("legacy SKU-only save of a new shared location reports sparse inheritance even without presentation", async () => {
  let local: Record<string, unknown> | undefined;
  const shared = { location_id: null, shorten_product_names: false, product_name_max_characters: 40, show_sku: true, presentation: null };
  const directory = createSupabaseReceiptSettingsAdminStore({ url: "https://example.test", serviceRoleKey: "synthetic", fetchImpl: async url => {
    if (url.includes("/rpc/")) {
      local = { location_id: "loc_a1", shorten_product_names: false, product_name_max_characters: 24, show_sku: false, presentation: null,
        settings_override: { shortenProductNames: false, productNameMaxCharacters: 24, showSku: false } };
      return { ok: true, status: 200, json: async () => ({ locationId: "loc_a1", shortenProductNames: false, productNameMaxCharacters: 24, showSku: false }) };
    }
    if (url.includes("pos_locations")) return { ok: true, status: 200, json: async () => [{ id: "loc_a1", name: "Accra" }] };
    return { ok: true, status: 200, json: async () => local ? [shared, local] : [shared] };
  } });
  expect(await directory.set({ organizationId: "org_a", locationId: "loc_a1", actorId: "owner_a", correlationId: CORRELATION,
    settings: { shortenProductNames: false, productNameMaxCharacters: 24, showSku: false } })).toMatchObject({ legacyOverride: false, overrides: { shortenProductNames: false, productNameMaxCharacters: 24, showSku: false } });
});
