import { afterEach, describe, expect, test, vi } from "vitest";
import { prepareReceiptPrint, printMountedReceipt, readReceiptPaperWidth, writeReceiptPaperWidth } from "./printer-preference";
import { createBrowserPrintPort } from "../../app/checkout-client";

afterEach(() => vi.unstubAllGlobals());

function fakePrintDocument(height: number, images: readonly unknown[] = []) {
  const style = { dataset: {}, textContent: "", remove: vi.fn() };
  const paper = { dataset: { receiptId: "test-receipt" }, isConnected: true, scrollHeight: height, getBoundingClientRect: () => ({ height }), querySelectorAll: () => images };
  const document = {
    querySelector: () => paper,
    createElement: () => style,
    head: { append: vi.fn() },
    fonts: { ready: Promise.resolve() },
  } as unknown as Document;
  return { document, style };
}

function fakeDialog() {
  const media = Object.assign(new EventTarget(), { matches: false });
  const view = Object.assign(new EventTarget(), { print: vi.fn(), matchMedia: () => media });
  const printing = fakePrintDocument(150);
  Object.assign(printing.document, { defaultView: view });
  return { ...printing, view, media };
}

function printMediaEvent(matches: boolean): Event {
  return Object.assign(new Event("change"), { matches });
}

describe("local receipt printer preference", () => {
  test("defaults to 80mm without storage, accepts 58mm, and tolerates unavailable storage", () => {
    expect(readReceiptPaperWidth()).toBe(80);
    expect(writeReceiptPaperWidth(58)).toBe(false);
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => values.get(key), setItem: (key: string, value: string) => values.set(key, value) } });
    expect(writeReceiptPaperWidth(58)).toBe(true);
    expect(readReceiptPaperWidth()).toBe(58);
    expect(writeReceiptPaperWidth(80)).toBe(true);
    expect(readReceiptPaperWidth()).toBe(80);
    expect(writeReceiptPaperWidth(70 as 58)).toBe(false);
    vi.stubGlobal("window", { get localStorage() { throw new Error("denied"); } });
    expect(readReceiptPaperWidth()).toBe(80);
    expect(writeReceiptPaperWidth(58)).toBe(false);
  });

  test("preserves selected printer paper for a short receipt and releases temporary print CSS", async () => {
    const { document, style } = fakePrintDocument(150);
    const cleanup = await prepareReceiptPrint(document, 58);
    expect(style.textContent).toContain("@page { size: auto; margin: 2mm; }");
    expect(style.textContent).not.toMatch(/size:\s*\d+mm/);
    expect(style.textContent).toContain("width: 54mm !important");
    expect(style.remove).not.toHaveBeenCalled();
    cleanup();
    expect(style.remove).toHaveBeenCalledOnce();
  });

  test("leaves long receipt pagination and page height to the selected printer paper", async () => {
    const { document, style } = fakePrintDocument(2600);
    const cleanup = await prepareReceiptPrint(document, 80);
    expect(style.textContent).toContain("@page { size: auto; margin: 2mm; }");
    expect(style.textContent).not.toMatch(/size:\s*\d+mm/);
    expect(style.textContent).toContain("width: 76mm !important");
    cleanup();
  });

  test("waits for logo decode and fails without opening a partial print", async () => {
    const decode = vi.fn().mockRejectedValue(new Error("broken logo"));
    const { document, style } = fakePrintDocument(150, [{ decode, naturalWidth: 0 }]);
    await expect(prepareReceiptPrint(document, 80)).rejects.toThrow("broken logo");
    expect(decode).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
  });

  test("refuses an absent or invisible receipt instead of producing a blank page", async () => {
    const hidden = fakePrintDocument(0);
    await expect(prepareReceiptPrint(hidden.document, 80)).rejects.toThrow("Receipt is not ready");
    expect(hidden.style.remove).toHaveBeenCalledOnce();
    const missing = { querySelector: () => null } as unknown as Document;
    await expect(prepareReceiptPrint(missing, 80)).rejects.toThrow("Receipt is not ready");
  });

  test("nonblocking browser printing keeps PrintPort pending and CSS mounted until afterprint", async () => {
    const { document, style, view } = fakeDialog();
    vi.stubGlobal("window", view);
    vi.stubGlobal("document", document);
    const port = createBrowserPrintPort();
    let settled = false;
    const completion = port.print({ receiptId: "test-receipt", reason: "reprint" }).then((value) => { settled = true; return value; });
    await vi.waitFor(() => expect(view.print).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(style.remove).not.toHaveBeenCalled();
    const simultaneous = await createBrowserPrintPort().print({ receiptId: "test-receipt", reason: "reprint" });
    expect(simultaneous.status).toBe("failed");
    expect(view.print).toHaveBeenCalledOnce();
    view.dispatchEvent(new Event("afterprint"));
    expect((await completion).status).toBe("dialog_opened");
    expect(style.remove).toHaveBeenCalledOnce();
    view.dispatchEvent(new Event("afterprint"));
    expect(style.remove).toHaveBeenCalledOnce();
  });

  test("print media exit completes the dialog without discarding an active print on focus", async () => {
    const { document, style, view, media } = fakeDialog();
    const completion = printMountedReceipt(document, 58);
    await vi.waitFor(() => expect(view.print).toHaveBeenCalledOnce());
    media.matches = true;
    media.dispatchEvent(printMediaEvent(true));
    view.dispatchEvent(new Event("blur"));
    view.dispatchEvent(new Event("focus"));
    expect(style.remove).not.toHaveBeenCalled();
    media.matches = false;
    media.dispatchEvent(printMediaEvent(false));
    await completion;
    expect(style.remove).toHaveBeenCalledOnce();
  });

  test("focus after observed dialog blur recovers a browser without afterprint", async () => {
    const { document, style, view } = fakeDialog();
    const completion = printMountedReceipt(document, 80);
    await vi.waitFor(() => expect(view.print).toHaveBeenCalledOnce());
    view.dispatchEvent(new Event("focus"));
    expect(style.remove).not.toHaveBeenCalled();
    view.dispatchEvent(new Event("blur"));
    view.dispatchEvent(new Event("focus"));
    await completion;
    expect(style.remove).toHaveBeenCalledOnce();
  });

  test("rechecks the same mounted receipt after asynchronous readiness and refuses a disconnected host", async () => {
    const { document, style, view } = fakeDialog();
    const paper = document.querySelector(".receipt-paper");
    vi.spyOn(document, "querySelector").mockReturnValueOnce(paper).mockReturnValueOnce(paper).mockReturnValueOnce(null);
    await expect(printMountedReceipt(document, 80, "test-receipt")).rejects.toThrow("Receipt changed before printing");
    expect(view.print).not.toHaveBeenCalled();
    expect(style.remove).toHaveBeenCalledOnce();
  });

  test.each([
    "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit/605.1.15 CriOS/130.0 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 18_0) AppleWebKit/605.1.15 FxiOS/130.0 Mobile/15E148 Safari/605.1.15",
  ])("retains WebKit print content when afterprint fires prematurely inside print(): %s", async (userAgent) => {
    const { document, style, view, media } = fakeDialog();
    Object.assign(view, { navigator: { userAgent } });
    view.print.mockImplementation(() => {
      media.matches = true;
      media.dispatchEvent(printMediaEvent(true));
      view.dispatchEvent(new Event("afterprint"));
      media.matches = false;
      media.dispatchEvent(printMediaEvent(false));
    });
    let settled = false;
    const completion = printMountedReceipt(document, 80).then(() => { settled = true; });
    await vi.waitFor(() => expect(view.print).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    expect(style.remove).not.toHaveBeenCalled();
    view.dispatchEvent(new Event("blur"));
    view.dispatchEvent(new Event("focus"));
    await completion;
    expect(style.remove).toHaveBeenCalledOnce();
  });

  test("normal blocking Chromium synchronous afterprint completes without deadlock", async () => {
    const { document, style, view } = fakeDialog();
    Object.assign(view, { navigator: { userAgent: "Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36" } });
    view.print.mockImplementation(() => view.dispatchEvent(new Event("afterprint")));
    await printMountedReceipt(document, 80);
    expect(view.print).toHaveBeenCalledOnce();
    expect(style.remove).toHaveBeenCalledOnce();
  });
});
