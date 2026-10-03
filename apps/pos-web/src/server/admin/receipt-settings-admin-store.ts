import type { ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import { DEFAULT_RECEIPT_SETTINGS, copyReceiptSettings, isReceiptSettings, resolveReceiptPresentation } from "../../core/receipt/settings";
import type { PosRestFetch } from "../http/server-fetch";

export type ReceiptSettingsAuditEvent = {
  readonly organizationId: string;
  readonly actorId: string;
  readonly action: "receipt_settings.set";
  readonly targetType: "receipt_settings";
  readonly targetId: string;
  readonly locationId: string;
  readonly before: ReceiptSettings | null;
  readonly after: ReceiptSettings;
  readonly correlationId: string;
};

export type ReceiptSettingsRead = {
  readonly locationId: string;
  readonly locationName?: string;
  readonly settings: ReceiptSettings;
  readonly persisted: boolean;
};

export interface ReceiptSettingsAdminStore {
  read(input: {
    readonly organizationId: string;
    readonly locationId: string;
  }): Promise<ReceiptSettingsRead | "missing_location" | "unavailable">;
  set(input: {
    readonly organizationId: string;
    readonly locationId: string;
    readonly actorId: string;
    readonly correlationId: string;
    readonly settings: ReceiptSettings;
  }): Promise<ReceiptSettingsRead | "missing_location" | "invalid" | "unavailable">;
}

type LocationRow = {
  readonly organizationId: string;
  readonly locationId: string;
  readonly name: string;
};

export function createMemoryReceiptSettingsAdminStore(input?: {
  readonly auditFails?: boolean;
}): ReceiptSettingsAdminStore & {
  readonly audits: ReceiptSettingsAuditEvent[];
  seedLocation(organizationId: string, locationId: string, name: string): void;
  seedSettings(organizationId: string, locationId: string, settings: ReceiptSettings): void;
} {
  const locations = new Map<string, LocationRow>();
  const settings = new Map<string, ReceiptSettings>();
  const audits: ReceiptSettingsAuditEvent[] = [];

  function key(organizationId: string, locationId: string): string {
    return `${organizationId}\u0000${locationId}`;
  }

  function readLocation(organizationId: string, locationId: string): LocationRow | undefined {
    const row = locations.get(key(organizationId, locationId));
    return row?.organizationId === organizationId ? row : undefined;
  }

  return {
    audits,
    seedLocation(organizationId, locationId, name) {
      locations.set(key(organizationId, locationId), { organizationId, locationId, name });
    },
    seedSettings(organizationId, locationId, value) {
      if (!readLocation(organizationId, locationId) || !isReceiptSettings(value)) return;
      settings.set(key(organizationId, locationId), copyReceiptSettings(value));
    },
    async read({ organizationId, locationId }) {
      const location = readLocation(organizationId, locationId);
      if (!location) return "missing_location";
      const stored = settings.get(key(organizationId, locationId));
      return {
        locationId,
        locationName: location.name,
        settings: copyReceiptSettings(stored ?? DEFAULT_RECEIPT_SETTINGS),
        persisted: stored !== undefined,
      };
    },
    async set(value) {
      if (!isReceiptSettings(value.settings)) return "invalid";
      const location = readLocation(value.organizationId, value.locationId);
      if (!location) return "missing_location";
      if (input?.auditFails) return "unavailable";
      const stored = settings.get(key(value.organizationId, value.locationId));
      const saved = copyReceiptSettings({
        ...value.settings,
        ...(value.settings.presentation !== undefined ? { presentation: resolveReceiptPresentation(value.settings.presentation) } : {}),
        ...(value.settings.presentation === undefined && stored?.presentation !== undefined
          ? { presentation: stored.presentation } : {}),
      });
      settings.set(key(value.organizationId, value.locationId), saved);
      audits.push({
        organizationId: value.organizationId,
        actorId: value.actorId,
        action: "receipt_settings.set",
        targetType: "receipt_settings",
        targetId: value.locationId,
        locationId: value.locationId,
        before: stored === undefined ? null : copyReceiptSettings(stored),
        after: copyReceiptSettings(saved),
        correlationId: value.correlationId,
      });
      return {
        locationId: value.locationId,
        locationName: location.name,
        settings: copyReceiptSettings(saved),
        persisted: true,
      };
    },
  };
}

export function createSupabaseReceiptSettingsAdminStore(input: {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
  readonly timeoutMs?: number;
}): ReceiptSettingsAdminStore {
  const root = `${input.url.replace(/\/+$/, "")}/rest/v1`;
  const timeoutMs = input.timeoutMs ?? 8_000;
  const headers = {
    apikey: input.serviceRoleKey,
    Authorization: `Bearer ${input.serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function request(path: string, init: { method: string; body?: unknown }): Promise<
    { readonly ok: true; readonly body: unknown } | "unavailable"
  > {
    try {
      const response = await input.fetchImpl(`${root}/${path}`, {
        method: init.method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok) return "unavailable";
      return { ok: true, body };
    } catch {
      return "unavailable";
    }
  }

  async function readLocation(
    organizationId: string,
    locationId: string,
  ): Promise<{ readonly name: string } | "missing_location" | "unavailable"> {
    const result = await request(
      `pos_locations?organization_id=eq.${encodeURIComponent(organizationId)}&id=eq.${encodeURIComponent(locationId)}&select=id,name`,
      { method: "GET" },
    );
    if (result === "unavailable" || !Array.isArray(result.body)) return "unavailable";
    const row = result.body[0];
    if (!row || typeof row !== "object") return "missing_location";
    const name = (row as { name?: unknown }).name;
    return { name: typeof name === "string" && name.trim() ? name : locationId };
  }

  return {
    async read({ organizationId, locationId }) {
      const location = await readLocation(organizationId, locationId);
      if (location === "missing_location" || location === "unavailable") return location;
      const result = await request(
        `pos_receipt_settings?organization_id=eq.${encodeURIComponent(organizationId)}&location_id=eq.${encodeURIComponent(locationId)}&select=shorten_product_names,product_name_max_characters,show_sku,presentation`,
        { method: "GET" },
      );
      if (result === "unavailable" || !Array.isArray(result.body)) return "unavailable";
      const row = result.body[0];
      if (!row) {
        return {
          locationId,
          locationName: location.name,
          settings: copyReceiptSettings(DEFAULT_RECEIPT_SETTINGS),
          persisted: false,
        };
      }
      const settings = settingsFromRow(row);
      if (!settings) return "unavailable";
      return { locationId, locationName: location.name, settings, persisted: true };
    },
    async set(value) {
      if (!isReceiptSettings(value.settings)) return "invalid";
      const location = await readLocation(value.organizationId, value.locationId);
      if (location === "missing_location" || location === "unavailable") return location;
      const result = await request("rpc/pos_admin_set_receipt_settings", {
        method: "POST",
        body: {
          p_organization_id: value.organizationId,
          p_location_id: value.locationId,
          p_actor_id: value.actorId,
          p_correlation_id: value.correlationId,
          p_shorten_product_names: value.settings.shortenProductNames,
          p_product_name_max_characters: value.settings.productNameMaxCharacters,
          p_show_sku: value.settings.showSku,
          p_presentation: value.settings.presentation === undefined ? null : resolveReceiptPresentation(value.settings.presentation),
        },
      });
      if (result === "unavailable") return "unavailable";
      const settings = settingsFromRow(result.body);
      if (!settings) return "unavailable";
      return {
        locationId: value.locationId,
        locationName: location.name,
        settings,
        persisted: true,
      };
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
