import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ManagementReceiptSettingsView } from "../../server/admin/handle-management-receipt-settings";
import { DEFAULT_RECEIPT_SETTINGS } from "../../core/receipt/settings";
import { ManagementScreen } from "./ManagementScreen";
import { parseReceiptNameMaxCharacters, ReceiptSettingsPanel } from "./ReceiptSettingsPanel";

const LOCATIONS = [
  { id: "loc_a1", name: "Accra Main Store and Service Counter — North Ridge Industrial" },
  { id: "loc_a2", name: "Tema Harbour" },
];

function view(overrides: Partial<ManagementReceiptSettingsView> = {}): ManagementReceiptSettingsView {
  return {
    locationId: "loc_a1",
    locationName: LOCATIONS[0]!.name,
    settings: DEFAULT_RECEIPT_SETTINGS,
    persisted: false,
    canManage: true,
    ...overrides,
  };
}

describe("ReceiptSettingsPanel", () => {
  test("owner can edit the supported receipt choices", () => {
    const html = renderToStaticMarkup(
      <ReceiptSettingsPanel
        locations={LOCATIONS}
        selectedLocationId="loc_a1"
        view={view()}
        onSave={() => undefined}
      />,
    );
    expect(html).toContain("Shorten product names on receipts");
    expect(html).toContain("Maximum product-name characters");
    expect(html).toContain("Show SKU on receipts");
    expect(html).toContain("Business name");
    expect(html).toContain("Business address");
    expect(html).toContain("Contact phone");
    expect(html).toContain("Tax registration number");
    expect(html).toContain("Footer message");
    expect(html).toContain('accept="image/png,image/jpeg"');
    expect(html).toContain("Show customer name");
    expect(html).toContain("Show customer phone");
    expect(html).toContain("Show cashier name");
    expect(html).toContain("Live receipt preview");
    expect(html).toContain("Sample — not a sale");
    expect(html).toContain("Test print (sample)");
    expect(html).toContain("Save receipt settings");
    expect(html).toContain("Editable");
    expect(html).toContain('data-layout="receipt-settings"');
    expect(html).toContain("<select");
    expect(html).toContain("Accra Main Store and Service Counter — North Ridge Industrial");
    expect(html).not.toContain("service_role");
    expect(html).not.toContain("truncate displayName");
    expect(html).toContain('aria-label="Purchased items"');
  });

  test("manager sees a read-only explanation and no save action", () => {
    const html = renderToStaticMarkup(
      <ReceiptSettingsPanel
        locations={[LOCATIONS[0]!]}
        selectedLocationId="loc_a1"
        view={view({ canManage: false })}
      />,
    );
    expect(html).toContain("Read only");
    expect(html).toContain("Owner or Admin authority is required to change receipt settings.");
    expect(html).toContain("disabled");
    expect(html).not.toContain("Save receipt settings");
    expect(html).toContain("Location:");
    expect(html).toContain("Printer paper width on this device");
    expect(html).toContain("Test print (sample)");
  });

  test("max character input accepts only whole numbers from 1 to 256", () => {
    expect(parseReceiptNameMaxCharacters("40")).toBe(40);
    expect(parseReceiptNameMaxCharacters("1")).toBe(1);
    expect(parseReceiptNameMaxCharacters("256")).toBe(256);
    expect(parseReceiptNameMaxCharacters(" 12")).toBe(12);
    for (const value of ["", "0", "257", "1.5", "40abc"]) {
      expect(parseReceiptNameMaxCharacters(value)).toBe("invalid");
    }
  });

  test("shows the settings it was given, including a saved refresh", () => {
    const before = renderToStaticMarkup(
      <ReceiptSettingsPanel locations={[LOCATIONS[0]!]} view={view()} />,
    );
    const after = renderToStaticMarkup(
      <ReceiptSettingsPanel
        locations={[LOCATIONS[0]!]}
        view={view({
          persisted: true,
          settings: { shortenProductNames: true, productNameMaxCharacters: 18, showSku: true },
        })}
      />,
    );
    expect(before).toContain("value=\"40\"");
    expect(before).not.toContain("CABLE-001");
    expect(after).toContain("value=\"18\"");
    expect(after).toContain("checked");
    expect(after).toContain("CABLE-001");
  });

  test("renders saved presentation in the inputs and the maintained preview", () => {
    const html = renderToStaticMarkup(
      <ReceiptSettingsPanel locations={[LOCATIONS[0]!]} view={view({
        settings: { ...DEFAULT_RECEIPT_SETTINGS, presentation: {
          templateVersion: 1, businessName: "Tema sample business", address: "Harbour Road",
          contactPhone: "030 000 0000", taxRegistrationNumber: "SAMPLE-TAX",
          footerMessage: "Sample footer", showCustomerName: false, showCustomerPhone: false, showCashier: false,
        } },
      })} />,
    );
    expect(html).toContain('value="Tema sample business"');
    expect(html).toContain("Harbour Road");
    expect(html).toContain("Sample footer");
    expect(html).toContain('data-receipt-source="receipt-port"');
    expect(html).not.toContain("Sample Customer");
    expect(html).not.toContain("024 *** 0123");
    expect(html).not.toContain("Sample cashier");
  });

  test("keeps loading, failure, and saving distinct", () => {
    const loading = renderToStaticMarkup(
      <ReceiptSettingsPanel locations={LOCATIONS} view={null} loading />,
    );
    const failed = renderToStaticMarkup(
      <ReceiptSettingsPanel locations={LOCATIONS} view={null} errorMessage="receipt settings are unavailable" />,
    );
    const saving = renderToStaticMarkup(
      <ReceiptSettingsPanel
        locations={LOCATIONS}
        view={view()}
        saving
        saveError="Receipt settings were not saved."
      />,
    );
    expect(loading).toContain("Loading receipt settings…");
    expect(loading).not.toContain("temporarily unavailable");
    expect(failed).toContain("Receipt settings are temporarily unavailable.");
    expect(failed).not.toContain("value=\"40\"");
    expect(saving).toContain("Saving…");
    expect(saving).toContain("Receipt settings were not saved.");
    expect(saving).toContain("disabled");
  });

  test("an empty location list is not an error", () => {
    const html = renderToStaticMarkup(
      <ReceiptSettingsPanel locations={[]} view={null} />,
    );
    expect(html).toContain("No locations are available for receipt settings.");
    expect(html).not.toContain("temporarily unavailable");
  });

  test("management screen uses the receipt settings panel", () => {
    const html = renderToStaticMarkup(
      <ManagementScreen
        context={{
          actorId: "owner_a",
          displayName: "Ama Mensah",
          organizationId: "org_a",
          controlRole: "owner",
          managerLocationIds: [],
          locationRoles: [],
          sections: ["overview", "receipt_settings"],
        }}
        activeSection="receipt_settings"
        onBackToPos={() => undefined}
        receiptLocations={LOCATIONS}
        receiptLocationId="loc_a1"
        receiptSettingsView={view()}
      />,
    );
    expect(html).toContain("Receipt settings");
    expect(html).toContain("Shorten product names on receipts");
    expect(html).toContain("Back to POS");
    expect(html).not.toContain("Foundation screen only");
  });
});
