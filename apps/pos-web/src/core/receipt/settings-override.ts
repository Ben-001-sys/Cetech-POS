import type { ReceiptPresentation, ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import { copyReceiptSettings, DEFAULT_RECEIPT_SETTINGS, isReceiptPresentation, isReceiptSettings, resolveReceiptPresentation } from "./settings";

export type ReceiptSettingsScope = "organization" | "location";
/** Missing fields inherit. A null logo explicitly hides the shared logo. */
export type ReceiptSettingsOverride = {
  readonly shortenProductNames?: boolean;
  readonly productNameMaxCharacters?: number;
  readonly showSku?: boolean;
  readonly presentation?: Partial<Omit<ReceiptPresentation, "templateVersion" | "logoDataUrl">> & {
    readonly logoDataUrl?: string | null;
  };
};

export function isReceiptSettingsOverride(value: unknown): value is ReceiptSettingsOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !["shortenProductNames", "productNameMaxCharacters", "showSku", "presentation"].includes(key))) return false;
  const settings = { ...DEFAULT_RECEIPT_SETTINGS, ...record };
  delete settings.presentation;
  if (!isReceiptSettings(settings)) return false;
  if (!Object.hasOwn(record, "presentation")) return true;
  const presentation = record.presentation;
  if (!presentation || typeof presentation !== "object" || Array.isArray(presentation)) return false;
  if (Object.hasOwn(presentation, "templateVersion")) return false;
  const checked = { ...presentation } as Record<string, unknown>;
  if (checked.logoDataUrl === null) delete checked.logoDataUrl;
  return isReceiptPresentation({ ...checked, templateVersion: 1 });
}

export function copyReceiptSettingsOverride(override: ReceiptSettingsOverride): ReceiptSettingsOverride {
  return { ...override, ...(override.presentation === undefined ? {} : { presentation: { ...override.presentation } }) };
}

export function resolveReceiptSettingsOverride(defaults: ReceiptSettings, override: ReceiptSettingsOverride): ReceiptSettings {
  if (!isReceiptSettings(defaults) || !isReceiptSettingsOverride(override)) throw new Error("receipt settings are invalid");
  const presentation = { ...resolveReceiptPresentation(defaults.presentation), ...override.presentation };
  if (presentation.logoDataUrl === null) delete presentation.logoDataUrl;
  return copyReceiptSettings({
    shortenProductNames: override.shortenProductNames ?? defaults.shortenProductNames,
    productNameMaxCharacters: override.productNameMaxCharacters ?? defaults.productNameMaxCharacters,
    showSku: override.showSku ?? defaults.showSku,
    ...(defaults.presentation === undefined && override.presentation === undefined ? {} : {
      presentation: presentation as ReceiptPresentation,
    }),
  });
}

export function hasReceiptSettingsOverrides(override: ReceiptSettingsOverride): boolean {
  return Object.keys(override).some(key => key !== "presentation") || Object.keys(override.presentation ?? {}).length > 0;
}

/** Convert legacy full local settings only after an explicit local edit. */
export function legacyReceiptSettingsOverride(settings: ReceiptSettings): ReceiptSettingsOverride {
  const presentation = { address: "", contactPhone: "", taxRegistrationNumber: "", logoDataUrl: null,
    ...Object.fromEntries(Object.entries(resolveReceiptPresentation(settings.presentation)).filter(([key]) => key !== "templateVersion")) };
  return { shortenProductNames: settings.shortenProductNames, productNameMaxCharacters: settings.productNameMaxCharacters,
    showSku: settings.showSku, presentation };
}
