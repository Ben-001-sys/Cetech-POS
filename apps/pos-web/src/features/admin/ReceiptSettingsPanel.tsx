"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import type { ReceiptPresentation, ReceiptSettings } from "../../../../../docs/contracts/domain.generated";
import {
  isReceiptPresentation,
  RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MAX,
  RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MIN,
  resolveReceiptPresentation,
} from "../../core/receipt/settings";
import { readReceiptPaperWidth, RECEIPT_PAPER_WIDTH_EVENT, writeReceiptPaperWidth, type ReceiptPaperWidth } from "../../core/receipt/printer-preference";
import { createBrowserPrintPort } from "../../app/checkout-client";
import type { ManagementReceiptSettingsView } from "../../server/admin/handle-management-receipt-settings";
import { ReceiptPaper } from "../sell/components/ReceiptPaper";
import { mapReceiptSnapshot } from "../sell/runtime/cashCheckoutController";
import type { ReceiptViewModel } from "../sell/state/checkoutSession";
import { buildReceiptSettingsSample, printReceiptSettingsSample, readReceiptLogo } from "./receipt-settings-preview";

export type ReceiptLocationOption = {
  readonly id: string;
  readonly name: string;
};

function subscribePaperWidth(onChange: () => void) {
  window.addEventListener(RECEIPT_PAPER_WIDTH_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(RECEIPT_PAPER_WIDTH_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function parseReceiptNameMaxCharacters(value: string): number | "invalid" {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return "invalid";
  const parsed = Number(text);
  if (
    !Number.isInteger(parsed) ||
    parsed < RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MIN ||
    parsed > RECEIPT_PRODUCT_NAME_MAX_CHARACTERS_MAX
  ) {
    return "invalid";
  }
  return parsed;
}

export function ReceiptSettingsPanel({
  locations,
  selectedLocationId,
  onSelectLocation,
  view,
  loading = false,
  saving = false,
  errorMessage,
  saveError,
  saveMessage,
  onSave,
}: {
  readonly locations: readonly ReceiptLocationOption[];
  readonly selectedLocationId?: string;
  readonly onSelectLocation?: (locationId: string) => void;
  readonly view: ManagementReceiptSettingsView | null;
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  readonly saveError?: string;
  readonly saveMessage?: string;
  readonly onSave?: (settings: ReceiptSettings) => void;
}) {
  if (locations.length === 0 && !loading && !errorMessage) {
    return (
      <section className="card card-pad stack">
        <h2>Receipt settings</h2>
        <p role="status">No locations are available for receipt settings.</p>
      </section>
    );
  }
  if (loading || !view) {
    if (errorMessage) {
      return (
        <section className="card card-pad stack" aria-live="assertive">
          <div className="banner danger" role="alert">Receipt settings are temporarily unavailable.</div>
          <p>{errorMessage}</p>
        </section>
      );
    }
    return (
      <section className="card card-pad" aria-live="polite">
        <p>Loading receipt settings…</p>
      </section>
    );
  }

  // Reset only for a different location, authority or saved settings, including branding.
  const editorKey = JSON.stringify([view.locationId, view.settings, view.canManage]);

  return (
    <div className="receipt-settings-panel stack" data-layout="receipt-settings">
      <LocationField
        locations={locations}
        selectedLocationId={selectedLocationId ?? view.locationId}
        onSelectLocation={onSelectLocation}
      />
      <ReceiptSettingsEditor
        key={editorKey}
        view={view}
        saving={saving}
        saveError={saveError}
        saveMessage={saveMessage}
        onSave={onSave}
      />
    </div>
  );
}

function LocationField({
  locations,
  selectedLocationId,
  onSelectLocation,
}: {
  readonly locations: readonly ReceiptLocationOption[];
  readonly selectedLocationId: string;
  readonly onSelectLocation?: (locationId: string) => void;
}) {
  const selected = locations.find((location) => location.id === selectedLocationId);
  if (locations.length <= 1) {
    return (
      <p>
        Location: <strong>{selected?.name ?? selectedLocationId}</strong>
      </p>
    );
  }
  return (
    <label className="field">
      <span>Location</span>
      <select
        className="select"
        value={selectedLocationId}
        onChange={(event) => onSelectLocation?.(event.target.value)}
      >
        {locations.map((location) => (
          <option key={location.id} value={location.id}>{location.name}</option>
        ))}
      </select>
    </label>
  );
}

function ReceiptSettingsEditor({
  view,
  saving = false,
  saveError,
  saveMessage,
  onSave,
}: {
  readonly view: ManagementReceiptSettingsView;
  readonly saving?: boolean;
  readonly saveError?: string;
  readonly saveMessage?: string;
  readonly onSave?: (settings: ReceiptSettings) => void;
}) {
  const [shortenProductNames, setShortenProductNames] = useState(view.settings.shortenProductNames);
  const [maxCharacters, setMaxCharacters] = useState(String(view.settings.productNameMaxCharacters));
  const [showSku, setShowSku] = useState(view.settings.showSku);
  const [presentation, setPresentation] = useState(() => resolveReceiptPresentation(view.settings.presentation));
  const paperWidth = useSyncExternalStore(subscribePaperWidth, readReceiptPaperWidth, () => 80 as ReceiptPaperWidth);
  const [logoLoading, setLogoLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printReceipt, setPrintReceipt] = useState<ReceiptViewModel | null>(null);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const logoUpload = useRef(0);
  const editable = view.canManage && !saving && !printing;

  useEffect(() => {
    return () => { logoUpload.current += 1; };
  }, []);

  function draftSettings(): ReceiptSettings | null {
    const parsed = parseReceiptNameMaxCharacters(maxCharacters);
    if (parsed === "invalid") {
      setLocalError("Enter a whole number from 1 to 256.");
      return null;
    }
    if (!isReceiptPresentation(presentation)) {
      setLocalError("Check the receipt details and logo before continuing.");
      return null;
    }
    setLocalError(null);
    return {
      shortenProductNames,
      productNameMaxCharacters: parsed,
      showSku,
      presentation: { ...presentation },
    };
  }

  function submit() {
    if (!editable || logoLoading) return;
    const draft = draftSettings();
    if (draft) onSave?.(draft);
  }

  function updatePresentation<K extends keyof ReceiptPresentation>(key: K, value: ReceiptPresentation[K]) {
    setPresentation((previous) => ({ ...previous, [key]: value }));
    setPrintMessage(null);
  }

  async function uploadLogo(file: File) {
    const upload = ++logoUpload.current;
    setLogoLoading(true);
    setLocalError(null);
    try {
      const logoDataUrl = await readReceiptLogo(file);
      if (upload === logoUpload.current) updatePresentation("logoDataUrl", logoDataUrl);
    } catch (error) {
      if (upload === logoUpload.current) {
        setLocalError(error instanceof Error ? error.message : "The logo could not be read. Please choose the image again.");
      }
    } finally {
      if (upload === logoUpload.current) setLogoLoading(false);
    }
  }

  function removeLogo() {
    logoUpload.current += 1;
    setLogoLoading(false);
    setPresentation((previous) => {
      const next = { ...previous };
      delete next.logoDataUrl;
      return next;
    });
    setPrintMessage(null);
  }

  async function testPrint() {
    if (printing || logoLoading || saving) return;
    const draft = draftSettings();
    if (!draft) return;
    setPrinting(true);
    setPrintMessage(null);
    try {
      const result = await printReceiptSettingsSample(
        buildReceiptSettingsSample(draft, view.locationName ?? "Store"),
        createBrowserPrintPort(),
        (sample) => flushSync(() => { setPrintReceipt(mapReceiptSnapshot(sample)); }),
      );
      if (result.status === "failed" || result.status === "unsupported") {
        setLocalError(result.message ?? "Sample printing is unavailable. Please check the printer and try again.");
      } else {
        setPrintMessage("Sample print dialog opened. No sale was created.");
      }
    } catch {
      setLocalError("The sample could not be printed. Please check the printer and try again.");
    } finally {
      setPrinting(false);
    }
  }

  const parsedCharacters = parseReceiptNameMaxCharacters(maxCharacters);
  const preview = mapReceiptSnapshot(buildReceiptSettingsSample({
    shortenProductNames,
    productNameMaxCharacters: parsedCharacters === "invalid" ? view.settings.productNameMaxCharacters : parsedCharacters,
    showSku,
    presentation,
  }, view.locationName ?? "Store"));

  return (
    <section className="card card-pad stack receipt-settings-editor">
      <div className="receipt-settings-head">
        <div>
          <h2>Receipt presentation</h2>
          <p className="muted">These choices change future receipts for this location. Reprints keep the original receipt details.</p>
        </div>
        <span className="status-pill">{view.canManage ? "Editable" : "Read only"}</span>
      </div>
      {!view.canManage ? (
        <p role="status">Owner or Admin authority is required to change receipt settings.</p>
      ) : null}
      {saveError ? <div className="banner danger" role="alert">{saveError}</div> : null}
      {saveMessage ? <div className="banner success" role="status">{saveMessage}</div> : null}
      {localError ? <div className="banner danger" role="alert">{localError}</div> : null}
      {printMessage ? <p role="status">{printMessage}</p> : null}

      <div className="receipt-settings-grid">
        <div className="receipt-settings-fields stack">
          <label className="field">
            <span>Business name</span>
            <input className="input" value={presentation.businessName ?? ""} maxLength={80} disabled={!editable}
              onChange={(event) => updatePresentation("businessName", event.target.value)} />
          </label>
          <label className="field">
            <span>Business address</span>
            <textarea className="input" rows={3} value={presentation.address ?? ""} maxLength={300} disabled={!editable}
              onChange={(event) => updatePresentation("address", event.target.value)} />
          </label>
          <label className="field">
            <span>Contact phone</span>
            <input className="input" type="tel" value={presentation.contactPhone ?? ""} maxLength={80} disabled={!editable}
              onChange={(event) => updatePresentation("contactPhone", event.target.value)} />
          </label>
          <label className="field">
            <span>Tax registration number</span>
            <input className="input" value={presentation.taxRegistrationNumber ?? ""} maxLength={80} disabled={!editable}
              onChange={(event) => updatePresentation("taxRegistrationNumber", event.target.value)} />
          </label>
          <label className="field">
            <span>Footer message</span>
            <textarea className="input" rows={2} value={presentation.footerMessage ?? ""} maxLength={200} disabled={!editable}
              onChange={(event) => updatePresentation("footerMessage", event.target.value)} />
          </label>
          <div className="receipt-settings-logo stack">
            <label className="field">
              <span>Receipt logo</span>
              <input className="input" type="file" accept="image/png,image/jpeg" disabled={!editable || logoLoading}
                aria-describedby="receipt-logo-help" onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file && editable) void uploadLogo(file);
                }} />
              <small id="receipt-logo-help">PNG or JPEG, smaller than 96 KB. The image is saved with each new receipt.</small>
            </label>
            {logoLoading ? <p role="status">Reading logo…</p> : null}
            {presentation.logoDataUrl && view.canManage ? (
              <button className="btn secondary" type="button" disabled={!editable} onClick={removeLogo}>Remove logo</button>
            ) : null}
          </div>

      <label className="receipt-settings-toggle">
        <span>
          <strong>Shorten product names on receipts</strong>
          <small>Limits how much of a product name is printed. Catalog names stay unchanged.</small>
        </span>
        <input
          type="checkbox"
          checked={shortenProductNames}
          disabled={!editable}
          onChange={(event) => setShortenProductNames(event.target.checked)}
        />
      </label>

      <label className="field">
        <span>Maximum product-name characters</span>
        <input
          className="input"
          inputMode="numeric"
          value={maxCharacters}
          disabled={!editable}
          aria-describedby="receipt-name-max-help"
          onChange={(event) => setMaxCharacters(event.target.value)}
        />
        <small id="receipt-name-max-help">Use a whole number from 1 to 256.</small>
      </label>

      <label className="receipt-settings-toggle">
        <span>
          <strong>Show SKU on receipts</strong>
          <small>Prints a SKU when the receipt line has one. Lines without a SKU omit it.</small>
        </span>
        <input
          type="checkbox"
          checked={showSku}
          disabled={!editable}
          onChange={(event) => setShowSku(event.target.checked)}
        />
      </label>

      <ReceiptToggle label="Show customer name" checked={presentation.showCustomerName ?? true} disabled={!editable}
        onChange={(checked) => updatePresentation("showCustomerName", checked)} />
      <ReceiptToggle label="Show customer phone" checked={presentation.showCustomerPhone ?? true} disabled={!editable}
        help="Prints only the customer phone already saved with the sale. Empty phone fields are omitted."
        onChange={(checked) => updatePresentation("showCustomerPhone", checked)} />
      <ReceiptToggle label="Show cashier name" checked={presentation.showCashier ?? true} disabled={!editable}
        onChange={(checked) => updatePresentation("showCashier", checked)} />

      {view.canManage ? (
        <button className="btn" type="button" disabled={saving || logoLoading || printing} onClick={submit}>
          {saving ? "Saving…" : "Save receipt settings"}
        </button>
      ) : null}
        </div>

        <section className="receipt-settings-preview stack" aria-labelledby="receipt-preview-title">
          <div>
            <h3 id="receipt-preview-title">Live receipt preview</h3>
            <p className="muted">Shows your unsaved choices using sample items and amounts.</p>
          </div>
          <label className="field">
            <span>Printer paper width on this device</span>
            <select className="select" value={paperWidth} disabled={printing} onChange={(event) => {
              const width: ReceiptPaperWidth = event.target.value === "58" ? 58 : 80;
              if (writeReceiptPaperWidth(width)) {
                setLocalError(null);
              } else {
                setLocalError("Paper width could not be remembered on this device.");
              }
            }}>
              <option value={80}>80 mm</option>
              <option value={58}>58 mm</option>
            </select>
            <small>This printer preference is saved on this device and does not change receipt settings for the location.</small>
          </label>
          <div className="receipt-settings-preview-paper" data-receipt-preview>
            <ReceiptPaper receipt={preview} paperWidth={paperWidth} sample />
          </div>
          <button className="btn secondary" type="button" disabled={printing || logoLoading || saving} onClick={() => { void testPrint(); }}>
            {printing ? "Preparing sample…" : "Test print (sample)"}
          </button>
          <small>Sample — not a sale. Test printing does not save these settings.</small>
        </section>
      </div>
      {printReceipt ? (
        <div className="receipt-print-host" aria-hidden="true" data-receipt-sample-print>
          <ReceiptPaper receipt={printReceipt} paperWidth={paperWidth} sample />
        </div>
      ) : null}
    </section>
  );
}

function ReceiptToggle({ label, help, checked, disabled, onChange }: {
  readonly label: string;
  readonly help?: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="receipt-settings-toggle">
      <span><strong>{label}</strong>{help ? <small>{help}</small> : null}</span>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}
