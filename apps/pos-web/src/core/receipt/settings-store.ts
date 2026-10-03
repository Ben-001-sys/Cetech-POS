import type { ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import { DEFAULT_RECEIPT_SETTINGS, copyReceiptSettings, isReceiptSettings, resolveReceiptPresentation } from "./settings";
import { copyReceiptSettingsOverride, isReceiptSettingsOverride, resolveReceiptSettingsOverride, type ReceiptSettingsOverride } from "./settings-override";

export interface ReceiptSettingsStore {
  get(organizationId: string, locationId: string): Promise<ReceiptSettings>;
  upsert(organizationId: string, locationId: string, settings: ReceiptSettings): Promise<ReceiptSettings>;
}

export interface MutableReceiptSettingsStore extends ReceiptSettingsStore {
  seed(organizationId: string, locationId: string, settings: ReceiptSettings): void;
  seedDefaults(organizationId: string, settings: ReceiptSettings): void;
  seedOverride(organizationId: string, locationId: string, override: ReceiptSettingsOverride): void;
}

function settingsKey(organizationId: string, locationId: string): string {
  return `${organizationId}\u0000${locationId}`;
}

export function createMemoryReceiptSettingsStore(
  initial: ReadonlyArray<{
    readonly organizationId: string;
    readonly locationId: string;
    readonly settings: ReceiptSettings;
  }> = [],
): MutableReceiptSettingsStore {
  const rows = new Map<string, ReceiptSettings>();
  const defaults = new Map<string, ReceiptSettings>();
  const overrides = new Map<string, ReceiptSettingsOverride>();
  for (const row of initial) {
    if (!isReceiptSettings(row.settings)) throw new Error("receipt settings are invalid");
    rows.set(settingsKey(row.organizationId, row.locationId), copyReceiptSettings(row.settings));
  }
  return {
    seed(organizationId, locationId, settings) {
      if (!isReceiptSettings(settings)) throw new Error("receipt settings are invalid");
      rows.set(settingsKey(organizationId, locationId), copyReceiptSettings(settings));
      overrides.delete(settingsKey(organizationId, locationId));
    },
    seedDefaults(organizationId, settings) {
      if (!isReceiptSettings(settings)) throw new Error("receipt settings are invalid");
      defaults.set(organizationId, copyReceiptSettings(settings));
    },
    seedOverride(organizationId, locationId, override) {
      if (!isReceiptSettingsOverride(override)) throw new Error("receipt settings override is invalid");
      overrides.set(settingsKey(organizationId, locationId), copyReceiptSettingsOverride(override));
    },
    async get(organizationId, locationId) {
      const key = settingsKey(organizationId, locationId);
      const override = overrides.get(key);
      if (override) return resolveReceiptSettingsOverride(defaults.get(organizationId) ?? DEFAULT_RECEIPT_SETTINGS, override);
      return copyReceiptSettings(rows.get(key) ?? defaults.get(organizationId) ?? DEFAULT_RECEIPT_SETTINGS);
    },
    async upsert(organizationId, locationId, settings) {
      if (!isReceiptSettings(settings)) {
        throw new Error("receipt settings are invalid");
      }
      const existing = rows.get(settingsKey(organizationId, locationId));
      const saved = copyReceiptSettings({
        ...settings,
        ...(settings.presentation !== undefined ? { presentation: resolveReceiptPresentation(settings.presentation) } : {}),
        ...(settings.presentation === undefined && existing?.presentation !== undefined
          ? { presentation: existing.presentation } : {}),
      });
      rows.set(settingsKey(organizationId, locationId), saved);
      overrides.delete(settingsKey(organizationId, locationId));
      return copyReceiptSettings(saved);
    },
  };
}
