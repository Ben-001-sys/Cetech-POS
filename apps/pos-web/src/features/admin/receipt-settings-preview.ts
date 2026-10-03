import type { ReceiptSnapshot, ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import type { PrintPort } from "../../../../../docs/contracts/ports";
import { freezeReceiptLines } from "../../core/receipt/build-receipt-line";
import { isReceiptPresentation, resolveReceiptPresentation } from "../../core/receipt/settings";

// Leave room for the data URL prefix beneath the contract's 131072-character cap.
export const RECEIPT_LOGO_UPLOAD_MAX_BYTES = 98_280;

/** Synthetic output only. Never calls sale, tender, customer, catalog or stock APIs. */
export function buildReceiptSettingsSample(settings: ReceiptSettings, locationName: string): ReceiptSnapshot {
  const money = (minor: number) => ({ minor, currency: "GHS" });
  return {
    id: "receipt-settings-sample",
    transactionId: "00000000-0000-4000-8000-000000000001",
    receiptNumber: "SAMPLE",
    orderReference: "SAMPLE",
    issuedAt: "2026-10-03T10:30:00.000Z",
    locationName,
    registerName: "Sample register",
    cashierName: "Sample cashier",
    customerLabel: "Sample Customer",
    customerPhone: "024 *** 0123",
    presentation: resolveReceiptPresentation(settings.presentation),
    lines: freezeReceiptLines([
      {
        name: "USB-C braided charging cable",
        variationLabel: "Colour: Black · Length: 2 m",
        sku: "CABLE-001",
        quantity: "2",
        unitPrice: money(2500),
        subtotal: money(5000),
        discount: money(0),
        tax: money(0),
        total: money(5000),
      },
      {
        name: "Wireless mouse",
        sku: "MOUSE-002",
        quantity: "1",
        unitPrice: money(7500),
        subtotal: money(7500),
        discount: money(0),
        tax: money(0),
        total: money(7500),
      },
    ], settings),
    subtotal: money(12500),
    discount: money(0),
    tax: money(0),
    total: money(12500),
    tender: "cash",
    cashReceived: money(15000),
    changeDue: money(2500),
    documentKind: "operational_pos_receipt",
  };
}

/** The caller synchronously commits its dedicated print host before invoking PrintPort. */
export async function printReceiptSettingsSample(
  sample: ReceiptSnapshot,
  printer: PrintPort,
  mount: (sample: ReceiptSnapshot) => void,
) {
  mount(sample);
  return printer.print({ receiptId: sample.id, reason: "initial" });
}

function readDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The logo could not be read. Please choose the image again."));
    };
    reader.onerror = () => reject(new Error("The logo could not be read. Please choose the image again."));
    reader.onabort = () => reject(new Error("The logo upload was cancelled."));
    reader.readAsDataURL(file);
  });
}

function decodeEmbeddedLogo(dataUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
      if (error) {
        image.src = "";
        reject(error);
      } else {
        resolve();
      }
    };
    const timeout = setTimeout(() => finish(new Error("The logo could not be opened. Please choose another image.")), 5000);
    image.onload = () => {
      if (image.naturalWidth > 0 && image.naturalHeight > 0) finish();
      else finish(new Error("The logo image is empty. Please choose another image."));
    };
    image.onerror = () => finish(new Error("The logo could not be opened. Please choose another image."));
    image.src = dataUrl;
  });
}

/** MIME, byte signature and contract bounds all apply before a logo enters the draft. */
export async function readReceiptLogo(
  file: Blob,
  dataUrlReader: (file: Blob) => Promise<string> = readDataUrl,
  decodeLogo: (dataUrl: string) => Promise<void> = decodeEmbeddedLogo,
): Promise<string> {
  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    throw new Error("Choose a PNG or JPEG logo.");
  }
  if (file.size === 0 || file.size > RECEIPT_LOGO_UPLOAD_MAX_BYTES) {
    throw new Error("Choose a logo smaller than 96 KB.");
  }
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  const validSignature = file.type === "image/png"
    ? pngSignature.every((byte, index) => bytes[index] === byte)
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!validSignature) throw new Error("The file is not a valid PNG or JPEG logo.");
  const dataUrl = await dataUrlReader(file);
  if (!isReceiptPresentation({ templateVersion: 1, logoDataUrl: dataUrl }) ||
      !dataUrl.startsWith(`data:${file.type};base64,`)) {
    throw new Error("The logo could not be read as a bounded PNG or JPEG image.");
  }
  await decodeLogo(dataUrl);
  return dataUrl;
}
