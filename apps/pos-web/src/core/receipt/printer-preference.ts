export type ReceiptPaperWidth = 58 | 80;
export const RECEIPT_PAPER_WIDTH_EVENT = "cetech-receipt-paper-width";

const PAPER_WIDTH_KEY = "cetech.pos.receipt-paper-width";
let printInProgress = false;

/** A device preference only: never part of a sale or its immutable receipt. */
export function readReceiptPaperWidth(): ReceiptPaperWidth {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(PAPER_WIDTH_KEY) === "58" ? 58 : 80;
  } catch {
    return 80;
  }
}

export function writeReceiptPaperWidth(width: ReceiptPaperWidth): boolean {
  if (width !== 58 && width !== 80) return false;
  try {
    if (typeof window === "undefined") return false;
    window.localStorage.setItem(PAPER_WIDTH_KEY, String(width));
    window.dispatchEvent?.(new Event(RECEIPT_PAPER_WIDTH_EVENT));
    return true;
  } catch {
    return false;
  }
}

async function boundedReadiness<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 5_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readyImage(image: HTMLImageElement): Promise<void> {
  if (typeof image.decode === "function") {
    await boundedReadiness(image.decode(), "Receipt logo could not be loaded. Try printing again.");
  } else if (!image.complete) {
    let removeListeners: (() => void) | undefined;
    try {
      await boundedReadiness(new Promise<void>((resolve, reject) => {
      const remove = () => {
        image.removeEventListener("load", loaded);
        image.removeEventListener("error", failed);
      };
      removeListeners = remove;
      const loaded = () => { remove(); resolve(); };
      const failed = () => { remove(); reject(new Error("Receipt logo could not be loaded. Try printing again.")); };
      image.addEventListener("load", loaded, { once: true });
      image.addEventListener("error", failed, { once: true });
      }), "Receipt logo could not be loaded. Try printing again.");
    } finally {
      removeListeners?.();
    }
  }
  if (image.naturalWidth === 0) throw new Error("Receipt logo could not be loaded. Try printing again.");
}

/**
 * Prepare the already mounted receipt only. Return cleanup after the print dialog
 * closes. Keep the printer's selected page size: a shorter custom CSS page can
 * be centered inside a longer driver sheet by Chromium. Only receipt width and
 * margins are supplied here; the printer owns page height and pagination.
 */
export async function prepareReceiptPrint(
  document: Document,
  width: ReceiptPaperWidth = readReceiptPaperWidth(),
): Promise<() => void> {
  const paper = document.querySelector<HTMLElement>(".receipt-print-host .receipt-paper");
  if (!paper) throw new Error("Receipt is not ready to print. Open it and try again.");
  if (width !== 58 && width !== 80) throw new Error("Choose an available receipt paper width.");

  const style = document.createElement("style");
  style.dataset.receiptPrintSizing = "true";
  const contentWidth = width - 4;
  const dimensions = `.receipt-print-host, .receipt-print-host .receipt-paper { width: ${contentWidth}mm !important; max-width: ${contentWidth}mm !important; }`;
  const measurement = `@media screen { .receipt-print-host { display: block !important; position: fixed !important; left: -10000px !important; top: 0 !important; } .receipt-print-host .receipt-paper { padding: 0 !important; border: 0 !important; font-size: 12px !important; line-height: 1.35 !important; } }`;
  const previousWidth = paper.dataset.paperWidth;
  const cleanup = () => {
    style.remove();
    if (previousWidth === undefined) delete paper.dataset.paperWidth;
    else paper.dataset.paperWidth = previousWidth;
  };
  paper.dataset.paperWidth = String(width);
  document.head.append(style);
  try {
    style.textContent = `${dimensions}\n${measurement}`;
    await Promise.all([
      document.fonts ? boundedReadiness(document.fonts.ready, "Receipt text is still loading. Try printing again.") : Promise.resolve(),
      ...[...paper.querySelectorAll<HTMLImageElement>("img")].map(readyImage),
    ]);
    const contentHeight = Math.max(paper.scrollHeight, paper.getBoundingClientRect().height);
    if (!Number.isFinite(contentHeight) || contentHeight <= 0) throw new Error("Receipt is not ready to print. Open it and try again.");
    style.textContent = `${dimensions}\n${measurement}\n@media print { @page { size: auto; margin: 2mm; } html, body { width: ${contentWidth}mm !important; } }`;
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Some browsers return from print() while their dialog still uses the DOM.
 * Retain the receipt and its sizing until a dialog lifecycle event completes.
 * No timeout discards a possibly active dialog. PrintPort remains pending if a
 * browser supplies none of afterprint, print-media exit, or blur/focus recovery.
 */
export async function printMountedReceipt(document: Document, width?: ReceiptPaperWidth, receiptId?: string): Promise<void> {
  if (printInProgress) throw new Error("A receipt print dialog is already open.");
  const view = document.defaultView;
  if (!view || typeof view.print !== "function") throw new Error("Printing is not available in this session.");
  const paper = document.querySelector<HTMLElement>(".receipt-print-host .receipt-paper");
  const expectedId = receiptId ?? paper?.dataset.receiptId;
  if (!paper?.isConnected || !expectedId || paper.dataset.receiptId !== expectedId) {
    throw new Error("Receipt is not ready to print. Open it and try again.");
  }
  printInProgress = true;
  let cleanup: (() => void) | undefined;
  try {
    cleanup = await prepareReceiptPrint(document, width);
    if (!paper.isConnected || document.querySelector(".receipt-print-host .receipt-paper") !== paper || paper.dataset.receiptId !== expectedId) {
      throw new Error("Receipt changed before printing. Open it and try again.");
    }
    await new Promise<void>((resolve, reject) => {
      const media = typeof view.matchMedia === "function" ? view.matchMedia("print") : undefined;
      const userAgent = view.navigator?.userAgent ?? "";
      // Safari can emit afterprint before its nonblocking native dialog closes.
      // iOS browser brands share WebKit, including CriOS/FxiOS/EdgiOS.
      const earlyWebKitEvents = /AppleWebKit/.test(userAgent) &&
        (/(?:iPad|iPhone|iPod)/.test(userAgent) || /Version\/[\d.]+.*Safari\//.test(userAgent));
      let callingPrint = false;
      let sawPrintMedia = media?.matches ?? false;
      let sawBlur = false;
      let finished = false;
      const remove = () => {
        view.removeEventListener("afterprint", afterPrinted);
        view.removeEventListener("blur", blurred);
        view.removeEventListener("focus", focused);
        if (media?.removeEventListener) media.removeEventListener("change", mediaChanged);
        else media?.removeListener?.(mediaChanged);
      };
      const finish = () => {
        if (finished) return;
        finished = true;
        remove();
        resolve();
      };
      const afterPrinted = () => {
        if (earlyWebKitEvents && callingPrint) return;
        finish();
      };
      const blurred = () => { sawBlur = true; };
      const focused = () => { if (sawBlur && !media?.matches && !(earlyWebKitEvents && callingPrint)) finish(); };
      const mediaChanged = (event: MediaQueryListEvent) => {
        if (event.matches) sawPrintMedia = true;
        else if (sawPrintMedia && !(earlyWebKitEvents && callingPrint)) finish();
      };
      view.addEventListener("afterprint", afterPrinted);
      view.addEventListener("blur", blurred);
      view.addEventListener("focus", focused);
      if (media?.addEventListener) media.addEventListener("change", mediaChanged);
      else media?.addListener?.(mediaChanged);
      try {
        callingPrint = true;
        view.print();
      } catch (error) {
        remove();
        reject(error);
      } finally {
        callingPrint = false;
      }
    });
  } finally {
    cleanup?.();
    printInProgress = false;
  }
}
