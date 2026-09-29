import type { PrintResult, ReceiptSnapshot } from "../../../../../docs/contracts/domain.generated";
import type { ReceiptPort } from "../../../../../docs/contracts/ports";
import type { ReceiptViewModel } from "../sell/state/checkoutSession";

/**
 * Reprint reads the stored receipt, mounts it, then prints.
 * It does not prepare a sale, take payment, or rebuild the receipt from current catalog state.
 */
export async function reprintImmutableReceipt(input: {
  readonly transactionId: ReceiptSnapshot["transactionId"];
  readonly receipts: Pick<ReceiptPort, "getByTransaction">;
  readonly present: (receipt: ReceiptViewModel) => boolean;
  readonly print: (receiptId: string) => Promise<PrintResult>;
  readonly mapReceipt: (snapshot: ReceiptSnapshot) => ReceiptViewModel;
}): Promise<
  | { readonly ok: true; readonly snapshot: ReceiptSnapshot; readonly printed: PrintResult }
  | { readonly ok: false; readonly message: string }
> {
  const loaded = await input.receipts.getByTransaction(input.transactionId);
  if (!loaded.ok) {
    return { ok: false, message: "Receipt could not be loaded. The sale has not been changed." };
  }
  const snapshot = loaded.data;
  const mounted = input.present(input.mapReceipt(snapshot));
  if (!mounted) {
    return { ok: false, message: "Receipt could not be shown for printing. The sale has not been changed." };
  }
  try {
    const printed = await input.print(snapshot.id);
    return { ok: true, snapshot, printed };
  } catch {
    return { ok: false, message: "Receipt printing failed. The sale has not been changed." };
  }
}

export function receiptPaperIsMounted(root: ParentNode, receiptNumber: string): boolean {
  const paper = root.querySelector(".receipt-print-host [data-receipt-source='receipt-port']");
  if (!paper) return false;
  return (paper.textContent ?? "").includes(receiptNumber);
}
