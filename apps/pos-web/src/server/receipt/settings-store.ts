import type { ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import { DEFAULT_RECEIPT_SETTINGS, copyReceiptSettings, isReceiptSettings, resolveReceiptPresentation } from "../../core/receipt/settings";
import type { ReceiptSettingsStore } from "../../core/receipt/settings-store";
import { isReceiptSettingsOverride, resolveReceiptSettingsOverride } from "../../core/receipt/settings-override";
import { validateCanonicalDef } from "../quotes/canonical-schema";
import type { PosRestFetch } from "../http/server-fetch";

export type SupabaseReceiptSettingsStoreOptions = {
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly fetchImpl: PosRestFetch;
  readonly timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 8_000;

function parseSettings(row: Record<string, unknown> | undefined): ReceiptSettings {
  if (!row) {
    return copyReceiptSettings(DEFAULT_RECEIPT_SETTINGS);
  }
  const candidate = {
    shortenProductNames: row.shorten_product_names,
    productNameMaxCharacters: row.product_name_max_characters,
    showSku: row.show_sku,
    ...(row.presentation == null ? {} : { presentation: row.presentation }),
  };
  if (!validateCanonicalDef("ReceiptSettings", candidate) || !isReceiptSettings(candidate)) {
    return copyReceiptSettings(DEFAULT_RECEIPT_SETTINGS);
  }
  return copyReceiptSettings(candidate);
}

export function createSupabaseReceiptSettingsStore(
  options: SupabaseReceiptSettingsStoreOptions,
): ReceiptSettingsStore {
  const root = `${options.url.replace(/\/+$/, "")}/rest/v1`;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers = {
    apikey: options.serviceRoleKey,
    Authorization: `Bearer ${options.serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function request(input: {
    readonly path: string;
    readonly method: string;
    readonly body?: unknown;
    readonly prefer?: string;
  }): Promise<{ readonly status: number; readonly body: unknown }> {
    const response = await options.fetchImpl(`${root}/${input.path}`, {
      method: input.method,
      headers: input.prefer ? { ...headers, Prefer: input.prefer } : headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error("receipt settings store denied infrastructure access");
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  return {
    async get(organizationId, locationId) {
      const path =
        `pos_receipt_settings?organization_id=eq.${encodeURIComponent(organizationId)}` +
        `&or=(location_id.eq.${encodeURIComponent(locationId)},location_id.is.null)` +
        `&select=location_id,shorten_product_names,product_name_max_characters,show_sku,presentation,settings_override`;
      const result = await request({ path, method: "GET" });
      if (!result.status || result.status >= 400) {
        throw new Error("receipt settings store is unavailable");
      }
      const rows = Array.isArray(result.body) ? result.body as Record<string, unknown>[] : [];
      const shared = rows.find(row => row.location_id === null);
      // Legacy synthetic adapters omit location_id; real scoped rows always carry it.
      const row = rows.find(row => row.location_id === locationId || row.location_id === undefined);
      if (!row || typeof row !== "object") {
        return parseSettings(shared);
      }
      if (row.settings_override != null) {
        if (!isReceiptSettingsOverride(row.settings_override)) throw new Error("receipt settings override is invalid");
        return resolveReceiptSettingsOverride(parseSettings(shared), row.settings_override);
      }
      return parseSettings(row as Record<string, unknown>);
    },
    async upsert(organizationId, locationId, settings) {
      if (!isReceiptSettings(settings) || !validateCanonicalDef("ReceiptSettings", settings)) {
        throw new Error("receipt settings are invalid");
      }
      const result = await request({
        path: "pos_receipt_settings?on_conflict=organization_id,location_id",
        method: "POST",
        prefer: "resolution=merge-duplicates,return=representation",
        body: {
          organization_id: organizationId,
          location_id: locationId,
          shorten_product_names: settings.shortenProductNames,
          product_name_max_characters: settings.productNameMaxCharacters,
          show_sku: settings.showSku,
          settings_override: null,
          ...(settings.presentation === undefined ? {} : { presentation: resolveReceiptPresentation(settings.presentation) }),
          updated_at: new Date().toISOString(),
        },
      });
      if (!result.status || result.status >= 400) {
        throw new Error("receipt settings store rejected upsert");
      }
      const row = Array.isArray(result.body) ? result.body[0] : result.body;
      if (!row || typeof row !== "object") {
        return copyReceiptSettings(settings);
      }
      return parseSettings(row as Record<string, unknown>);
    },
  };
}
