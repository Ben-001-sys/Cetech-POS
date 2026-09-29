const INTERNAL_PLACE = /^(?:loc|reg)_[A-Za-z0-9_-]+$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Customer receipt labels.
 * New receipts should already store a human location and register name.
 * Older snapshots sometimes stored `loc_...` in the name field. Those rows are
 * not rewritten, and reprint does not look up the live location. Customer
 * output uses the fallback instead of showing the internal reference.
 */
export function isInternalReceiptReference(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return true;
  return INTERNAL_PLACE.test(trimmed) || UUID_LIKE.test(trimmed);
}

export function customerReceiptPlaceLabel(value: string | undefined, fallback: "Store" | "Register"): string {
  const trimmed = value?.trim() ?? "";
  if (isInternalReceiptReference(trimmed)) return fallback;
  return trimmed;
}
