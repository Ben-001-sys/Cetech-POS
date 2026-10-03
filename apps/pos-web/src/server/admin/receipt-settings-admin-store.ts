import type { ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import { DEFAULT_RECEIPT_SETTINGS, copyReceiptSettings, isReceiptSettings, resolveReceiptPresentation } from "../../core/receipt/settings";
import { copyReceiptSettingsOverride, isReceiptSettingsOverride, resolveReceiptSettingsOverride, type ReceiptSettingsOverride, type ReceiptSettingsScope } from "../../core/receipt/settings-override";
import type { PosRestFetch } from "../http/server-fetch";

export type ReceiptSettingsAuditEvent = {
  readonly organizationId: string;
  readonly actorId: string;
  readonly action: "receipt_settings.set" | "receipt_settings.shared.set" | "receipt_settings.inherit_layout";
  readonly targetType: "receipt_settings";
  readonly targetId: string;
  readonly locationId?: string;
  readonly before: ReceiptSettings | null;
  readonly after: ReceiptSettings;
  readonly correlationId: string;
};

export type ReceiptSettingsRead = {
  readonly locationId: string;
  readonly locationName?: string;
  readonly settings: ReceiptSettings;
  readonly persisted: boolean;
  readonly scope?: ReceiptSettingsScope;
  readonly defaults?: ReceiptSettings;
  readonly overrides?: ReceiptSettingsOverride;
  readonly legacyOverride?: boolean;
  readonly affectedLocationCount?: number;
};

type ReadInput = { readonly organizationId: string; readonly locationId?: string; readonly scope?: ReceiptSettingsScope };
type SetInput = ReadInput & {
  readonly actorId: string;
  readonly correlationId: string;
  readonly settings?: ReceiptSettings;
  readonly overrides?: ReceiptSettingsOverride;
};
export interface ReceiptSettingsAdminStore {
  read(input: ReadInput): Promise<ReceiptSettingsRead | "missing_location" | "unavailable">;
  set(input: SetInput): Promise<ReceiptSettingsRead | "missing_location" | "invalid" | "unavailable">;
  applyShared?(input: { readonly organizationId: string; readonly actorId: string; readonly correlationId: string }): Promise<ReceiptSettingsRead | "unavailable">;
}

type LocationRow = { readonly organizationId: string; readonly locationId: string; readonly name: string };
export function localDetailsOverride(settings: ReceiptSettings): ReceiptSettingsOverride {
  const presentation = settings.presentation;
  if (!presentation) return {};
  const retained = Object.fromEntries(["address", "contactPhone", "taxRegistrationNumber"]
    .filter(key => Object.hasOwn(presentation, key)).map(key => [key, presentation[key as keyof typeof presentation]]));
  return Object.keys(retained).length ? { presentation: retained } : {};
}

export function createMemoryReceiptSettingsAdminStore(input?: { readonly auditFails?: boolean }): ReceiptSettingsAdminStore & {
  readonly audits: ReceiptSettingsAuditEvent[];
  seedLocation(organizationId: string, locationId: string, name: string): void;
  seedSettings(organizationId: string, locationId: string, settings: ReceiptSettings): void;
} {
  const locations = new Map<string, LocationRow>();
  const settings = new Map<string, ReceiptSettings>();
  const defaults = new Map<string, ReceiptSettings>();
  const overrides = new Map<string, ReceiptSettingsOverride>();
  const audits: ReceiptSettingsAuditEvent[] = [];
  const key = (organizationId: string, locationId: string) => `${organizationId}\u0000${locationId}`;
  function read(value: ReadInput): ReceiptSettingsRead | "missing_location" {
    const shared = copyReceiptSettings(defaults.get(value.organizationId) ?? DEFAULT_RECEIPT_SETTINGS);
    if (value.scope === "organization") return { locationId: "", settings: shared, scope: "organization", persisted: defaults.has(value.organizationId) };
    const locationId = value.locationId ?? "";
    const location = locations.get(key(value.organizationId, locationId));
    if (!location) return "missing_location";
    const stored = settings.get(key(value.organizationId, locationId));
    const override = overrides.get(key(value.organizationId, locationId));
    return {
      locationId, locationName: location.name, scope: "location", defaults: shared,
      settings: override ? resolveReceiptSettingsOverride(shared, override) : copyReceiptSettings(stored ?? shared),
      persisted: stored !== undefined || override !== undefined,
      ...(override ? { overrides: copyReceiptSettingsOverride(override), legacyOverride: false } : { legacyOverride: stored !== undefined }),
    };
  }
  return {
    audits,
    seedLocation(organizationId, locationId, name) { locations.set(key(organizationId, locationId), { organizationId, locationId, name }); },
    seedSettings(organizationId, locationId, value) {
      if (!locations.has(key(organizationId, locationId)) || !isReceiptSettings(value)) return;
      settings.set(key(organizationId, locationId), copyReceiptSettings(value));
      overrides.delete(key(organizationId, locationId));
    },
    async read(value) { return read(value); },
    async set(value) {
      const isShared = value.scope === "organization";
      if (value.overrides !== undefined && (!isReceiptSettingsOverride(value.overrides) || isShared)) return "invalid";
      if (value.settings !== undefined && !isReceiptSettings(value.settings)) return "invalid";
      if ((value.settings === undefined) === (value.overrides === undefined)) return "invalid";
      const before = read(value);
      if (before === "missing_location") return before;
      if (input?.auditFails) return "unavailable";
      if (isShared) defaults.set(value.organizationId, copyReceiptSettings(value.settings!));
      else if (value.overrides !== undefined) overrides.set(key(value.organizationId, value.locationId!), copyReceiptSettingsOverride(value.overrides));
      else {
        const previous = settings.get(key(value.organizationId, value.locationId!));
        const previousOverride = overrides.get(key(value.organizationId, value.locationId!));
        settings.set(key(value.organizationId, value.locationId!), copyReceiptSettings({
          ...value.settings!,
          ...(value.settings!.presentation !== undefined ? { presentation: resolveReceiptPresentation(value.settings!.presentation) } : {}),
          ...(value.settings!.presentation === undefined && previous?.presentation !== undefined ? { presentation: previous.presentation } : {}),
        }));
        if (value.settings!.presentation === undefined && (previousOverride !== undefined || (previous === undefined && defaults.has(value.organizationId)))) {
          overrides.set(key(value.organizationId, value.locationId!), { ...previousOverride,
            shortenProductNames: value.settings!.shortenProductNames, productNameMaxCharacters: value.settings!.productNameMaxCharacters, showSku: value.settings!.showSku });
        } else overrides.delete(key(value.organizationId, value.locationId!));
      }
      const after = read(value) as ReceiptSettingsRead;
      audits.push({ organizationId: value.organizationId, actorId: value.actorId,
        action: isShared ? "receipt_settings.shared.set" : "receipt_settings.set", targetType: "receipt_settings",
        targetId: isShared ? value.organizationId : value.locationId!, ...(isShared ? {} : { locationId: value.locationId }),
        before: before.persisted ? copyReceiptSettings(before.settings) : null, after: copyReceiptSettings(after.settings), correlationId: value.correlationId });
      return after;
    },
    async applyShared(value) {
      if (input?.auditFails) return "unavailable";
      let count = 0;
      for (const location of locations.values()) {
        if (location.organizationId !== value.organizationId) continue;
        const rowKey = key(value.organizationId, location.locationId);
        const before = read({ organizationId: value.organizationId, locationId: location.locationId }) as ReceiptSettingsRead;
        const currentOverride = overrides.get(rowKey);
        overrides.set(rowKey, localDetailsOverride(currentOverride
          ? { ...DEFAULT_RECEIPT_SETTINGS, presentation: { templateVersion: 1, ...currentOverride.presentation, logoDataUrl: undefined } } as ReceiptSettings
          : settings.get(rowKey) ?? DEFAULT_RECEIPT_SETTINGS));
        const after = read({ organizationId: value.organizationId, locationId: location.locationId }) as ReceiptSettingsRead;
        audits.push({ organizationId: value.organizationId, actorId: value.actorId, action: "receipt_settings.inherit_layout", targetType: "receipt_settings", targetId: location.locationId,
          locationId: location.locationId, before: before.persisted ? before.settings : null, after: after.settings, correlationId: value.correlationId });
        count += 1;
      }
      return { ...(read({ organizationId: value.organizationId, scope: "organization" }) as ReceiptSettingsRead), affectedLocationCount: count };
    },
  };
}

export function createSupabaseReceiptSettingsAdminStore(input: {
  readonly url: string; readonly serviceRoleKey: string; readonly fetchImpl: PosRestFetch; readonly timeoutMs?: number;
}): ReceiptSettingsAdminStore {
  const root = `${input.url.replace(/\/+$/, "")}/rest/v1`;
  const headers = { apikey: input.serviceRoleKey, Authorization: `Bearer ${input.serviceRoleKey}`, Accept: "application/json", "Content-Type": "application/json" };
  async function request(path: string, body?: unknown): Promise<{ body: unknown } | "unavailable"> {
    try {
      const response = await input.fetchImpl(`${root}/${path}`, { method: body === undefined ? "GET" : "POST", headers,
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(input.timeoutMs ?? 8_000) });
      if (!response.ok) return "unavailable";
      return { body: await response.json() };
    } catch { return "unavailable"; }
  }
  async function read(value: ReadInput): Promise<ReceiptSettingsRead | "missing_location" | "unavailable"> {
    const organization = value.scope === "organization";
    let locationName: string | undefined;
    if (!organization) {
      const location = await request(`pos_locations?organization_id=eq.${encodeURIComponent(value.organizationId)}&id=eq.${encodeURIComponent(value.locationId ?? "")}&select=id,name`);
      if (location === "unavailable" || !Array.isArray(location.body)) return "unavailable";
      const row = location.body[0];
      if (!row || typeof row !== "object") return "missing_location";
      locationName = typeof row.name === "string" ? row.name : value.locationId;
    }
    const filter = organization ? "location_id=is.null" : `or=(location_id.eq.${encodeURIComponent(value.locationId ?? "")},location_id.is.null)`;
    const result = await request(`pos_receipt_settings?organization_id=eq.${encodeURIComponent(value.organizationId)}&${filter}&select=location_id,shorten_product_names,product_name_max_characters,show_sku,presentation,settings_override`);
    if (result === "unavailable" || !Array.isArray(result.body)) return "unavailable";
    const rows = result.body as Record<string, unknown>[];
    const sharedRow = rows.find(row => row.location_id === null);
    const shared = sharedRow ? settingsFromRow(sharedRow) : copyReceiptSettings(DEFAULT_RECEIPT_SETTINGS);
    if (!shared) return "unavailable";
    if (organization) return { locationId: "", scope: "organization", settings: shared, persisted: sharedRow !== undefined };
    const row = rows.find(row => row.location_id === value.locationId || row.location_id === undefined);
    const override = row?.settings_override;
    if (override != null && !isReceiptSettingsOverride(override)) return "unavailable";
    const stored = row ? settingsFromRow(row) : undefined;
    if (row && !stored && override == null) return "unavailable";
    return { locationId: value.locationId!, locationName, scope: "location", defaults: shared,
      settings: override != null ? resolveReceiptSettingsOverride(shared, override as ReceiptSettingsOverride) : copyReceiptSettings(stored ?? shared),
      persisted: row !== undefined, legacyOverride: row !== undefined && override == null,
      ...(override == null ? {} : { overrides: copyReceiptSettingsOverride(override as ReceiptSettingsOverride) }) };
  }
  return {
    read,
    async set(value) {
      if (value.overrides !== undefined && (!isReceiptSettingsOverride(value.overrides) || value.scope === "organization")) return "invalid";
      if (value.settings !== undefined && !isReceiptSettings(value.settings)) return "invalid";
      if ((value.settings === undefined) === (value.overrides === undefined)) return "invalid";
      const before = await read(value);
      if (before === "unavailable" || before === "missing_location") return before;
      const scoped = value.scope === "organization" || value.overrides !== undefined;
      const result = await request(scoped ? "rpc/pos_admin_set_receipt_settings_scope" : "rpc/pos_admin_set_receipt_settings", scoped ? {
        p_organization_id: value.organizationId, p_location_id: value.scope === "organization" ? null : value.locationId,
        p_actor_id: value.actorId, p_correlation_id: value.correlationId,
        p_settings: value.settings ?? null, p_override: value.overrides ?? null,
      } : {
        p_organization_id: value.organizationId, p_location_id: value.locationId,
        p_actor_id: value.actorId, p_correlation_id: value.correlationId,
        p_shorten_product_names: value.settings!.shortenProductNames, p_product_name_max_characters: value.settings!.productNameMaxCharacters,
        p_show_sku: value.settings!.showSku, p_presentation: value.settings!.presentation === undefined ? null : resolveReceiptPresentation(value.settings!.presentation),
      });
      if (result === "unavailable") return result;
      // The legacy RPC response contains raw columns. Re-read effective settings and
      // sparse-mode metadata, including a newly inheriting row with no branding.
      return read(value);
    },
    async applyShared(value) {
      const result = await request("rpc/pos_admin_apply_shared_receipt_settings", {
        p_organization_id: value.organizationId, p_actor_id: value.actorId, p_correlation_id: value.correlationId,
      });
      if (result === "unavailable" || !result.body || typeof result.body !== "object") return "unavailable";
      const count = (result.body as Record<string, unknown>).affectedLocationCount;
      if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) return "unavailable";
      const shared = await read({ organizationId: value.organizationId, scope: "organization" });
      return typeof shared === "string" ? "unavailable" : { ...shared, affectedLocationCount: count };
    },
  };
}

function settingsFromRow(value: unknown): ReceiptSettings | undefined {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object") return undefined;
  const record = row as Record<string, unknown>;
  const candidate = {
    shortenProductNames: record.shortenProductNames ?? record.shorten_product_names,
    productNameMaxCharacters: record.productNameMaxCharacters ?? record.product_name_max_characters,
    showSku: record.showSku ?? record.show_sku,
    ...(record.presentation == null ? {} : { presentation: record.presentation }),
  };
  return isReceiptSettings(candidate) ? copyReceiptSettings(candidate) : undefined;
}
