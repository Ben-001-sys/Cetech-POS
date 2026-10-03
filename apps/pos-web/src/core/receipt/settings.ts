import type { ReceiptPresentation, ReceiptSettings } from "../../../../../docs/contracts/domain.generated";

export const RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MIN = 1;
export const RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MAX = 256;
export const RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_DEFAULT = 40;

/** Resolved version-1 output defaults. Missing legacy settings still use these for new sales. */
export const DEFAULT_RECEIPT_PRESENTATION: ReceiptPresentation = Object.freeze({
  templateVersion: 1,
  businessName: "CETECH",
  footerMessage: "Thank You For Purchasing",
  showCustomerName: true,
  showCustomerPhone: true,
  showCashier: true,
});

const PRESENTATION_TEXT_LIMITS = {
  businessName: 80,
  address: 300,
  contactPhone: 80,
  taxRegistrationNumber: 80,
  footerMessage: 200,
} as const;
const PRESENTATION_BOOLEAN_KEYS = ["showCustomerName", "showCustomerPhone", "showCashier"] as const;
const LOGO_DATA_URL_PATTERN = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
const LOGO_SIGNATURE_PATTERN = /^data:image\/(?:png;base64,iVBORw0KGgo|jpeg;base64,\/9j\/)/;

/** Mirrors the canonical wire schema, including Unicode code-point length limits. */
export function isReceiptPresentation(value: unknown): value is ReceiptPresentation {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.templateVersion !== 1) return false;
  for (const [key, limit] of Object.entries(PRESENTATION_TEXT_LIMITS)) {
    if (Object.hasOwn(record, key) &&
        (typeof record[key] !== "string" || Array.from(record[key] as string).length > limit)) return false;
  }
  for (const key of PRESENTATION_BOOLEAN_KEYS) {
    if (Object.hasOwn(record, key) && typeof record[key] !== "boolean") return false;
  }
  if (Object.hasOwn(record, "logoDataUrl") &&
      (typeof record.logoDataUrl !== "string" || record.logoDataUrl.length > 131072 ||
       !LOGO_DATA_URL_PATTERN.test(record.logoDataUrl) || !LOGO_SIGNATURE_PATTERN.test(record.logoDataUrl) ||
       record.logoDataUrl.slice(record.logoDataUrl.indexOf(",") + 1).length % 4 !== 0)) return false;
  return Object.keys(record).every((key) => key === "templateVersion" || key === "logoDataUrl" ||
    Object.hasOwn(PRESENTATION_TEXT_LIMITS, key) || PRESENTATION_BOOLEAN_KEYS.some((booleanKey) => key === booleanKey));
}

/** Returns an independent normalized copy to freeze into a new receipt, never a historical reprint. */
export function resolveReceiptPresentation(presentation?: ReceiptPresentation): ReceiptPresentation {
  if (presentation !== undefined && !isReceiptPresentation(presentation)) {
    throw new Error("receipt presentation is invalid");
  }
  return { ...DEFAULT_RECEIPT_PRESENTATION, ...presentation };
}

/** Backward-compatible operational defaults. Shortening and SKU printing are off. */
export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  shortenProductNames: false,
  productNameMaxCharacters: RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_DEFAULT,
  showSku: false,
};

export function isReceiptSettings(value: unknown): value is ReceiptSettings {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.shortenProductNames !== "boolean" || typeof record.showSku !== "boolean") {
    return false;
  }
  if (typeof record.productNameMaxCharacters !== "number" || !Number.isInteger(record.productNameMaxCharacters)) {
    return false;
  }
  if (
    record.productNameMaxCharacters < RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MIN ||
    record.productNameMaxCharacters > RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MAX
  ) {
    return false;
  }
  if (Object.hasOwn(record, "presentation") && !isReceiptPresentation(record.presentation)) return false;
  return Object.keys(record).every(
    (key) => key === "shortenProductNames" || key === "productNameMaxCharacters" || key === "showSku" || key === "presentation",
  );
}

export function receiptSettingsFromUnknown(value: unknown): ReceiptSettings | undefined {
  return isReceiptSettings(value) ? copyReceiptSettings(value) : undefined;
}

/** Copy nested output settings so editing a caller's draft cannot mutate stored snapshots or audit history. */
export function copyReceiptSettings(settings: ReceiptSettings): ReceiptSettings {
  return {
    shortenProductNames: settings.shortenProductNames,
    productNameMaxCharacters: settings.productNameMaxCharacters,
    showSku: settings.showSku,
    ...(settings.presentation === undefined ? {} : { presentation: { ...settings.presentation } }),
  };
}
