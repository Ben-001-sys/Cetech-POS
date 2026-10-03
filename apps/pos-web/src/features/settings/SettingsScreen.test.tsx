import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { SettingsScreen, type PosSettingsView } from "./SettingsScreen";

const settings: PosSettingsView = {
  deviceName: "Counter tablet 1",
  registerName: "Main Counter",
  scannerLabel: "Keyboard scanner input",
  printerLabel: "Browser print",
  appearance: "system",
};

describe("SettingsScreen", () => {
  test("offers printer paper sizing as a local device preference with 80mm default", () => {
    const html = renderToStaticMarkup(<SettingsScreen settings={settings} onPaperWidthChange={() => undefined} />);
    expect(html).toContain("Receipt paper width");
    expect(html).toContain('<option value="80" selected="">80 mm</option>');
    expect(html).toContain("Saved on this device");
    const narrow = renderToStaticMarkup(<SettingsScreen settings={settings} paperWidth={58} onPaperWidthChange={() => undefined} />);
    expect(narrow).toContain('<option value="58" selected="">58 mm</option>');
  });
  test("renders operational settings without engineering diagnostics", () => {
    const html = renderToStaticMarkup(<SettingsScreen settings={settings} onOpenStoreHealth={() => undefined} />);
    expect(html).toContain("Device &amp; register");
    expect(html).toContain("Counter tablet 1");
    expect(html).toContain("Main Counter");
    expect(html).toContain("Keyboard-wedge scanner");
    expect(html).toContain("Browser print (80mm/A4)");
    expect(html).toContain("Open System status");
    expect(html).not.toContain("Diagnostics");
    expect(html).not.toContain("Technical details");
    expect(html).not.toContain("API contract");
    expect(html).not.toContain("Local schema");
    expect(html).not.toContain("Build ID");
  });

  test.each([
    ["offline", "Device and register information remains readable."],
    ["degraded", "Some system information is temporarily unavailable."],
    ["error", "Settings could not be fully loaded."],
    ["loading", "Loading settings…"],
    ["empty", "Settings are not available."],
  ] as const)("renders %s state", (state, copy) => {
    const html = renderToStaticMarkup(<SettingsScreen settings={settings} state={state} />);
    expect(html).toContain(copy);
  });
});
