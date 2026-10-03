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
import { copyReceiptSettingsOverride, legacyReceiptSettingsOverride, resolveReceiptSettingsOverride, type ReceiptSettingsOverride, type ReceiptSettingsScope } from "../../core/receipt/settings-override";
import { ManagementLoading } from "./ManagementLoading";

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
  scope,
  loading = false,
  saving = false,
  errorMessage,
  saveError,
  saveMessage,
  onSave,
  onSelectScope,
  onSaveOverrides,
  onApplyShared,
}: {
  readonly locations: readonly ReceiptLocationOption[];
  readonly selectedLocationId?: string;
  readonly onSelectLocation?: (locationId: string) => void;
  readonly view: ManagementReceiptSettingsView | null;
  readonly scope?: ReceiptSettingsScope;
  readonly loading?: boolean;
  readonly saving?: boolean;
  readonly errorMessage?: string;
  readonly saveError?: string;
  readonly saveMessage?: string;
  readonly onSave?: (settings: ReceiptSettings) => void;
  readonly onSelectScope?: (scope: ReceiptSettingsScope) => void;
  readonly onSaveOverrides?: (overrides: ReceiptSettingsOverride) => void;
  readonly onApplyShared?: () => void;
}) {
  const effectiveScope = scope ?? view?.scope ?? "location";
  // Scope navigation must remain available when a location is empty or its read fails.
  // The parent supplies this callback only for organization administrators.
  const scopeSelector = onSelectScope ? <label className="field"><span>Receipt settings scope</span>
    <select className="select" value={effectiveScope} disabled={saving} onChange={event => onSelectScope(event.target.value === "organization" ? "organization" : "location")}>
      <option value="organization">Shared defaults — all locations</option><option value="location">Location overrides</option>
    </select></label> : null;
  const wrap = (content: React.ReactNode) => <div className="receipt-settings-panel stack" data-layout="receipt-settings">{scopeSelector}{content}</div>;
  if (locations.length === 0 && effectiveScope === "location" && !loading && !errorMessage) {
    return (
      wrap(<section className="card card-pad stack">
        <h2>Receipt settings</h2>
        <p role="status">No locations are available for receipt settings.</p>
      </section>)
    );
  }
  if (loading || !view) {
    if (errorMessage) {
      return (
        wrap(<section className="card card-pad stack" aria-live="assertive">
          <div className="banner danger" role="alert">Receipt settings are temporarily unavailable.</div>
          <p>{errorMessage}</p>
        </section>)
      );
    }
    return (
      wrap(<ManagementLoading variant="receipt" message="Loading receipt settings…" />)
    );
  }

  // Reset only for a different location, authority or saved settings, including branding.
  const editorKey = JSON.stringify([view.scope, view.locationId, view.settings, view.overrides, view.defaults, view.canManage]);

  return (
    <div className="receipt-settings-panel stack" data-layout="receipt-settings">
      {scopeSelector}
      {effectiveScope !== "organization" ? <LocationField
        locations={locations}
        selectedLocationId={selectedLocationId ?? view.locationId}
        onSelectLocation={onSelectLocation}
        disabled={saving}
      /> : null}
      <ReceiptSettingsEditor
        key={editorKey}
        view={view}
        saving={saving}
        saveError={saveError}
        saveMessage={saveMessage}
        onSave={onSave}
        onSaveOverrides={onSaveOverrides}
        onApplyShared={onApplyShared}
      />
    </div>
  );
}

function LocationField({
  locations,
  selectedLocationId,
  onSelectLocation,
  disabled = false,
}: {
  readonly locations: readonly ReceiptLocationOption[];
  readonly selectedLocationId: string;
  readonly onSelectLocation?: (locationId: string) => void;
  readonly disabled?: boolean;
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
        disabled={disabled}
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
  onSaveOverrides,
  onApplyShared,
}: {
  readonly view: ManagementReceiptSettingsView;
  readonly saving?: boolean;
  readonly saveError?: string;
  readonly saveMessage?: string;
  readonly onSave?: (settings: ReceiptSettings) => void;
  readonly onSaveOverrides?: (overrides: ReceiptSettingsOverride) => void;
  readonly onApplyShared?: () => void;
}) {
  const [shortenProductNames, setShortenProductNames] = useState(view.settings.shortenProductNames);
  const [maxCharacters, setMaxCharacters] = useState(String(view.settings.productNameMaxCharacters));
  const [showSku, setShowSku] = useState(view.settings.showSku);
  const [presentation, setPresentation] = useState(() => resolveReceiptPresentation(view.settings.presentation));
  const [overrides, setOverrides] = useState<ReceiptSettingsOverride>(() => copyReceiptSettingsOverride(view.overrides ?? (view.legacyOverride ? legacyReceiptSettingsOverride(view.settings) : {})));
  const [reviewShared, setReviewShared] = useState(false);
  const [reviewLocal, setReviewLocal] = useState(false);
  const paperWidth = useSyncExternalStore(subscribePaperWidth, readReceiptPaperWidth, () => 80 as ReceiptPaperWidth);
  const [logoLoading, setLogoLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [printReceipt, setPrintReceipt] = useState<ReceiptViewModel | null>(null);
  const [printMessage, setPrintMessage] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const logoUpload = useRef(0);
  const editable = view.canManage && !saving && !printing;
  const isOverrideEditor = view.scope === "location" && view.defaults !== undefined;
  const effectiveSettings = isOverrideEditor ? resolveReceiptSettingsOverride(view.defaults!, overrides) : null;
  const displayedPresentation = effectiveSettings ? resolveReceiptPresentation(effectiveSettings.presentation) : presentation;
  const sharedDirty = view.scope === "organization" && (
    shortenProductNames !== view.settings.shortenProductNames || showSku !== view.settings.showSku ||
    maxCharacters !== String(view.settings.productNameMaxCharacters) ||
    JSON.stringify(presentation) !== JSON.stringify(resolveReceiptPresentation(view.settings.presentation))
  );

  function customControl(key: keyof ReceiptSettingsOverride | keyof Omit<ReceiptPresentation, "templateVersion">, label: string, nested = false) {
    if (!isOverrideEditor) return null;
    const own = nested ? Object.hasOwn(overrides.presentation ?? {}, key) : Object.hasOwn(overrides, key);
    return <label className="receipt-settings-toggle"><span><small>{own ? `Location override: ${label}` : `Using shared ${label.toLowerCase()}`}</small></span>
      <input type="checkbox" aria-label={`Customize ${label.toLowerCase()} for this location`} checked={own} disabled={!editable} onChange={event => {
        if (key === "productNameMaxCharacters" && event.target.checked) setMaxCharacters(String(effectiveSettings!.productNameMaxCharacters));
        setOverrides(previous => {
          const next = copyReceiptSettingsOverride(previous) as Record<string, unknown>;
          if (nested) {
            const fields = { ...previous.presentation } as Record<string, unknown>;
            if (event.target.checked) fields[key] = displayedPresentation[key as keyof ReceiptPresentation] ?? (key === "logoDataUrl" ? null : "");
            else delete fields[key];
            if (Object.keys(fields).length) next.presentation = fields;
            else delete next.presentation;
          } else if (event.target.checked) next[key] = effectiveSettings?.[key as keyof ReceiptSettings];
          else delete next[key];
          return next as ReceiptSettingsOverride;
        });
      }} /></label>;
  }
  function fieldEditable(key: string, nested = false) {
    return editable && (!isOverrideEditor || Object.hasOwn(nested ? overrides.presentation ?? {} : overrides, key));
  }
  function updateSetting<K extends "shortenProductNames" | "showSku">(key: K, checked: boolean) {
    if (isOverrideEditor) setOverrides(previous => ({ ...previous, [key]: checked }));
    else if (key === "showSku") setShowSku(checked);
    else setShortenProductNames(checked);
  }

  useEffect(() => {
    return () => { logoUpload.current += 1; };
  }, []);

  function draftSettings(): ReceiptSettings | null {
    if (isOverrideEditor) {
      if (Object.hasOwn(overrides, "productNameMaxCharacters") && parseReceiptNameMaxCharacters(maxCharacters) === "invalid") {
        setLocalError("Enter a whole number from 1 to 256."); return null;
      }
      setLocalError(null); return effectiveSettings;
    }
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
    if (isOverrideEditor) {
      if (!draftSettings()) return;
      onSaveOverrides?.(copyReceiptSettingsOverride(overrides));
      return;
    }
    const draft = draftSettings();
    if (draft) onSave?.(draft);
  }

  function updatePresentation<K extends keyof ReceiptPresentation>(key: K, value: ReceiptPresentation[K]) {
    if (isOverrideEditor && key !== "templateVersion") setOverrides(previous => ({ ...previous, presentation: { ...previous.presentation, [key]: value } }));
    else setPresentation((previous) => ({ ...previous, [key]: value }));
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
    if (isOverrideEditor) setOverrides(previous => ({ ...previous, presentation: { ...previous.presentation, logoDataUrl: null } }));
    else setPresentation((previous) => {
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
  const preview = mapReceiptSnapshot(buildReceiptSettingsSample(effectiveSettings ?? {
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
          <p className="muted">{view.scope === "organization" ? "Shared defaults apply to future receipts at locations that inherit each setting. Saved location overrides stay in place." : "These choices change future receipts for this location."} Reprints keep the original receipt details.</p>
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
      {isOverrideEditor ? <div className="banner info"><p>{view.legacyOverride ? "Existing location settings are preserved. Choose which fields should use shared defaults." : "Unchecked fields inherit shared defaults. Customize only what differs at this location."}</p>
        <p>The actual location name is kept on each receipt. Printer width remains a setting on this device.</p>
        {view.canManage ? <button className="btn secondary" type="button" disabled={!editable} onClick={() => setReviewLocal(true)}>Use shared settings for this location</button> : null}
        {reviewLocal ? <div className="stack"><p>This clears all receipt overrides for this location, including address and contact details. Future receipts will use shared settings. The actual location name is kept.</p>
          <div className="row"><button className="btn" type="button" disabled={!editable} onClick={() => { setReviewLocal(false); setOverrides({}); onSaveOverrides?.({}); }}>Confirm: use shared settings</button>
          <button className="btn secondary" type="button" disabled={!editable} onClick={() => setReviewLocal(false)}>Cancel</button></div></div> : null}
      </div> : null}
      {view.scope === "organization" && view.canManage && onApplyShared ? <section className="stack" aria-label="Apply shared receipt layout">
        <button className="btn secondary" type="button" disabled={!editable || sharedDirty} onClick={() => setReviewShared(true)}>Apply shared layout to all locations</button>
        {sharedDirty ? <p role="status">Save shared defaults before applying the layout to all locations.</p> : null}
        {reviewShared ? <div className="banner warning stack" role="alert"><p>This replaces local layout overrides with the saved shared defaults at every location. It keeps each location’s address, contact phone, tax registration number and actual location name. Historical receipts and device paper width stay unchanged.</p>
          <p>Save your shared defaults before applying them.</p><div className="row"><button className="btn" type="button" disabled={!editable || sharedDirty} onClick={() => { setReviewShared(false); onApplyShared(); }}>Confirm: apply shared layout</button>
          <button className="btn secondary" type="button" disabled={!editable} onClick={() => setReviewShared(false)}>Cancel</button></div></div> : null}
      </section> : null}

      <div className="receipt-settings-grid">
        <div className="receipt-settings-fields stack">
          {customControl("businessName", "Business name", true)}
          <label className="field">
            <span>Business name</span>
            <input className="input" value={displayedPresentation.businessName ?? ""} maxLength={80} disabled={!fieldEditable("businessName", true)}
              onChange={(event) => updatePresentation("businessName", event.target.value)} />
          </label>
          {customControl("address", "Business address", true)}
          <label className="field">
            <span>Business address</span>
            <textarea className="input" rows={3} value={displayedPresentation.address ?? ""} maxLength={300} disabled={!fieldEditable("address", true)}
              onChange={(event) => updatePresentation("address", event.target.value)} />
          </label>
          {customControl("contactPhone", "Contact phone", true)}
          <label className="field">
            <span>Contact phone</span>
            <input className="input" type="tel" value={displayedPresentation.contactPhone ?? ""} maxLength={80} disabled={!fieldEditable("contactPhone", true)}
              onChange={(event) => updatePresentation("contactPhone", event.target.value)} />
          </label>
          {customControl("taxRegistrationNumber", "Tax registration number", true)}
          <label className="field">
            <span>Tax registration number</span>
            <input className="input" value={displayedPresentation.taxRegistrationNumber ?? ""} maxLength={80} disabled={!fieldEditable("taxRegistrationNumber", true)}
              onChange={(event) => updatePresentation("taxRegistrationNumber", event.target.value)} />
          </label>
          {customControl("footerMessage", "Footer message", true)}
          <label className="field">
            <span>Footer message</span>
            <textarea className="input" rows={2} value={displayedPresentation.footerMessage ?? ""} maxLength={200} disabled={!fieldEditable("footerMessage", true)}
              onChange={(event) => updatePresentation("footerMessage", event.target.value)} />
          </label>
          {customControl("logoDataUrl", "Receipt logo", true)}
          <div className="receipt-settings-logo stack">
            <label className="field">
              <span>Receipt logo</span>
              <input className="input" type="file" accept="image/png,image/jpeg" disabled={!fieldEditable("logoDataUrl", true) || logoLoading}
                aria-describedby="receipt-logo-help" onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file && editable) void uploadLogo(file);
                }} />
              <small id="receipt-logo-help">PNG or JPEG, smaller than 96 KB. The image is saved with each new receipt.</small>
            </label>
            {logoLoading ? <p role="status">Reading logo…</p> : null}
            {displayedPresentation.logoDataUrl && view.canManage ? (
              <button className="btn secondary" type="button" disabled={!editable} onClick={removeLogo}>Remove logo</button>
            ) : null}
          </div>

      {customControl("shortenProductNames", "Shorten product names")}
      <label className="receipt-settings-toggle">
        <span>
          <strong>Shorten product names on receipts</strong>
          <small>Limits how much of a product name is printed. Catalog names stay unchanged.</small>
        </span>
        <input
          type="checkbox"
          checked={effectiveSettings?.shortenProductNames ?? shortenProductNames}
          disabled={!fieldEditable("shortenProductNames")}
          onChange={(event) => updateSetting("shortenProductNames", event.target.checked)}
        />
      </label>

      {customControl("productNameMaxCharacters", "Maximum product-name characters")}
      <label className="field">
        <span>Maximum product-name characters</span>
        <input
          className="input"
          inputMode="numeric"
          value={isOverrideEditor && !Object.hasOwn(overrides, "productNameMaxCharacters") ? String(effectiveSettings!.productNameMaxCharacters) : maxCharacters}
          disabled={!fieldEditable("productNameMaxCharacters")}
          aria-describedby="receipt-name-max-help"
          onChange={(event) => {
            setMaxCharacters(event.target.value);
            const parsed = parseReceiptNameMaxCharacters(event.target.value);
            if (isOverrideEditor && parsed !== "invalid") setOverrides(previous => ({ ...previous, productNameMaxCharacters: parsed }));
          }}
        />
        <small id="receipt-name-max-help">Use a whole number from 1 to 256.</small>
      </label>

      {customControl("showSku", "Show SKU")}
      <label className="receipt-settings-toggle">
        <span>
          <strong>Show SKU on receipts</strong>
          <small>Prints a SKU when the receipt line has one. Lines without a SKU omit it.</small>
        </span>
        <input
          type="checkbox"
          checked={effectiveSettings?.showSku ?? showSku}
          disabled={!fieldEditable("showSku")}
          onChange={(event) => updateSetting("showSku", event.target.checked)}
        />
      </label>

      {customControl("showCustomerName", "Show customer name", true)}
      <ReceiptToggle label="Show customer name" checked={displayedPresentation.showCustomerName ?? true} disabled={!fieldEditable("showCustomerName", true)}
        onChange={(checked) => updatePresentation("showCustomerName", checked)} />
      {customControl("showCustomerPhone", "Show customer phone", true)}
      <ReceiptToggle label="Show customer phone" checked={displayedPresentation.showCustomerPhone ?? true} disabled={!fieldEditable("showCustomerPhone", true)}
        help="Prints only the customer phone already saved with the sale. Empty phone fields are omitted."
        onChange={(checked) => updatePresentation("showCustomerPhone", checked)} />
      {customControl("showCashier", "Show cashier name", true)}
      <ReceiptToggle label="Show cashier name" checked={displayedPresentation.showCashier ?? true} disabled={!fieldEditable("showCashier", true)}
        onChange={(checked) => updatePresentation("showCashier", checked)} />

      {view.canManage ? (
        <button className="btn" type="button" disabled={saving || logoLoading || printing} onClick={submit}>
          {saving ? "Saving…" : isOverrideEditor ? "Save location overrides" : view.scope === "organization" ? "Save shared defaults" : "Save receipt settings"}
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
