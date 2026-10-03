import { describe, expect, test, vi } from "vitest";
import type { PrintPort } from "../../../../../docs/contracts/ports";
import type { ReceiptSnapshot } from "../../../../../docs/contracts/domain.generated";
import { DEFAULT_RECEIPT_SETTINGS } from "../../core/receipt/settings";
import { buildReceiptSettingsSample, printReceiptSettingsSample, readReceiptLogo, RECEIPT_LOGO_UPLOAD_MAX_BYTES } from "./receipt-settings-preview";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2ioAAAAASUVORK5CYII=";
const pngFile = () => new Blob([Buffer.from(PNG.split(",")[1]!, "base64")], { type: "image/png" });

describe("receipt settings sample", () => {
  test("new receipt defaults and all amounts remain internally consistent", () => {
    const sample = buildReceiptSettingsSample(DEFAULT_RECEIPT_SETTINGS, "Accra Main Store");
    expect(sample.presentation).toMatchObject({
      templateVersion: 1,
      businessName: "CETECH",
      footerMessage: "Thank You For Purchasing",
      showCustomerName: true,
      showCustomerPhone: true,
      showCashier: true,
    });
    expect(sample.locationName).toBe("Accra Main Store");
    expect(sample.customerLabel).toBe("Sample Customer");
    expect(sample.customerPhone).toBe("024 *** 0123");
    expect(sample.receiptNumber).toBe("SAMPLE");
    expect(sample.lines.reduce((sum, line) => sum + line.subtotal.minor, 0)).toBe(sample.subtotal.minor);
    for (const line of sample.lines) {
      expect(Number(line.quantity) * line.unitPrice.minor).toBe(line.subtotal.minor);
      expect(line.subtotal.minor - line.discount.minor + line.tax.minor).toBe(line.total.minor);
    }
    expect(sample.lines.reduce((sum, line) => sum + line.total.minor, 0)).toBe(sample.total.minor);
    expect(sample.subtotal.minor - sample.discount.minor + sample.tax.minor).toBe(sample.total.minor);
    expect(sample.cashReceived!.minor - sample.total.minor).toBe(sample.changeDue!.minor);
  });

  test("unsaved presentation and existing name/SKU settings freeze into the synthetic sample", () => {
    const settings = {
      ...DEFAULT_RECEIPT_SETTINGS,
      shortenProductNames: true,
      productNameMaxCharacters: 8,
      showSku: true,
      presentation: { templateVersion: 1 as const, businessName: "Unsaved shop", footerMessage: "", showCustomerPhone: false },
    };
    const sample = buildReceiptSettingsSample(settings, "Tema Harbour");
    expect(sample.presentation?.businessName).toBe("Unsaved shop");
    expect(sample.presentation?.footerMessage).toBe("");
    expect(sample.presentation?.showCustomerPhone).toBe(false);
    expect(sample.lines[0]?.displayName).toBe("USB-C b…");
    expect(sample.lines[0]?.sku).toBe("CABLE-001");
    expect(sample.lines[0]?.variationLabel).toBe("Colour: Black · Length: 2 m");
    expect(sample.lines[0]?.name).toBe("USB-C braided charging cable");
    expect(sample.presentation).not.toBe(settings.presentation);
    expect(buildReceiptSettingsSample(DEFAULT_RECEIPT_SETTINGS, "Store").lines[0]?.sku).toBeUndefined();
  });

  test("mounts the supplied frozen sample before sending the print request", async () => {
    const sample = buildReceiptSettingsSample(DEFAULT_RECEIPT_SETTINGS, "Store");
    let mounted: ReceiptSnapshot | undefined;
    const print = vi.fn<PrintPort["print"]>(async (request) => {
      expect(mounted).toBe(sample);
      expect(request).toEqual({ receiptId: "receipt-settings-sample", reason: "initial" });
      return { status: "dialog_opened", message: "Print dialog opened." };
    });
    const result = await printReceiptSettingsSample(sample, { print }, (receipt) => { mounted = receipt; });
    expect(print).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("dialog_opened");
  });

  test("preserves unsupported and failed print outcomes for the editor", async () => {
    const sample = buildReceiptSettingsSample(DEFAULT_RECEIPT_SETTINGS, "Store");
    const result = await printReceiptSettingsSample(sample, {
      print: async () => ({ status: "unsupported", message: "No printer" }),
    }, () => undefined);
    expect(result).toEqual({ status: "unsupported", message: "No printer" });
    await expect(printReceiptSettingsSample(sample, {
      print: async () => { throw new Error("logo failed"); },
    }, () => undefined)).rejects.toThrow("logo failed");
  });
});

describe("bounded embedded receipt logos", () => {
  test("PNG bytes and the embedded data URL are checked before decoding", async () => {
    const decode = vi.fn(async () => undefined);
    const reader = vi.fn(async () => PNG);
    expect(await readReceiptLogo(pngFile(), reader, decode)).toBe(PNG);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(decode).toHaveBeenCalledExactlyOnceWith(PNG);
  });

  test("JPEG is supported when MIME, bytes and URI agree", async () => {
    const jpeg = new Blob([new Uint8Array([255, 216, 255, 224])], { type: "image/jpeg" });
    const uri = "data:image/jpeg;base64,/9j/4A==";
    expect(await readReceiptLogo(jpeg, async () => uri, async () => undefined)).toBe(uri);
  });

  test("oversized, SVG and disguised non-raster uploads never invoke FileReader", async () => {
    const reader = vi.fn(async () => PNG);
    const decode = vi.fn(async () => undefined);
    await expect(readReceiptLogo(new Blob([new Uint8Array(RECEIPT_LOGO_UPLOAD_MAX_BYTES + 1)], { type: "image/png" }), reader, decode))
      .rejects.toThrow("smaller than 96 KB");
    await expect(readReceiptLogo(new Blob(["<svg/>"], { type: "image/svg+xml" }), reader, decode)).rejects.toThrow("PNG or JPEG");
    await expect(readReceiptLogo(new Blob(["not an image"], { type: "image/png" }), reader, decode)).rejects.toThrow("not a valid");
    expect(reader).not.toHaveBeenCalled();
    expect(decode).not.toHaveBeenCalled();
  });

  test("external URLs, wrong embedded types, oversized data and decode errors are rejected", async () => {
    const decode = vi.fn(async () => undefined);
    for (const invalid of ["https://example.test/logo.png", "data:image/svg+xml;base64,PHN2Zy8+", "data:image/jpeg;base64,/9j/4A==", `data:image/png;base64,${"A".repeat(131072)}`]) {
      await expect(readReceiptLogo(pngFile(), async () => invalid, decode)).rejects.toThrow("bounded PNG or JPEG");
    }
    expect(decode).not.toHaveBeenCalled();
    await expect(readReceiptLogo(pngFile(), async () => PNG, async () => { throw new Error("The logo could not be opened."); }))
      .rejects.toThrow("could not be opened");
  });
});
