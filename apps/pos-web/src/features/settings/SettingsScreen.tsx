"use client";

import type { ReceiptPaperWidth } from "../../core/receipt/printer-preference";

import {
  friendlyDeviceName,
  printerCapabilityLabel,
  scannerCapabilityLabel,
  toCashierError,
} from "../../ui/cashier-language";

export type SettingsWorkspaceState = "ready" | "loading" | "empty" | "offline" | "degraded" | "error";
export type AppearancePreference = "system" | "light" | "dark";

export interface PosSettingsView {
  readonly deviceName: string;
  readonly registerName: string;
  readonly scannerLabel: string;
  readonly printerLabel: string;
  readonly appearance: AppearancePreference;
}

export interface SettingsScreenProps {
  readonly settings: PosSettingsView;
  readonly state?: SettingsWorkspaceState;
  readonly errorMessage?: string;
  readonly onAppearanceChange?: (appearance: AppearancePreference) => void;
  readonly onOpenStoreHealth?: () => void;
  readonly onRetry?: () => void;
  readonly paperWidth?: ReceiptPaperWidth;
  readonly onPaperWidthChange?: (width: ReceiptPaperWidth) => void;
}

export function SettingsScreen({
  settings,
  state = "ready",
  errorMessage,
  onAppearanceChange,
  onOpenStoreHealth,
  onRetry,
  paperWidth = 80,
  onPaperWidthChange,
}: SettingsScreenProps) {
  return (
    <section className="settings-workspace workspace-surface" aria-labelledby="settings-title">
      <div className="page-head">
        <div>
          <h1 id="settings-title">Settings</h1>
          <p>Device and register information, appearance, and system status for this POS.</p>
        </div>
      </div>

      {state === "offline" ? (
        <div className="banner warning workspace-banner" role="status"><strong>Offline.</strong><span>Device and register information remains readable. Changes that need confirmation should wait for connection.</span></div>
      ) : null}
      {state === "degraded" ? (
        <div className="banner warning workspace-banner" role="status"><strong>Some system information is temporarily unavailable.</strong><span>Open System status for current connection detail.</span></div>
      ) : null}
      {state === "error" ? (
        <div className="banner danger workspace-banner" role="alert">
          <strong>Settings could not be fully loaded.</strong><span>{errorMessage ? toCashierError({ message: errorMessage, domain: "generic" }).message : "Current device settings are shown where available."}</span>
          {onRetry ? <button className="btn small" type="button" onClick={onRetry}>Retry</button> : null}
        </div>
      ) : null}
      {state === "loading" ? (
        <div className="card card-pad workspace-state settings-loading" role="status" aria-live="polite">
          <div className="workspace-skeleton" aria-hidden="true"><span className="skeleton-line" /><span className="skeleton-line" /><span className="skeleton-line" /></div>
          <div><strong>Loading settings…</strong><p>Saved device settings are not being reset.</p></div>
        </div>
      ) : null}
      {state === "empty" ? (
        <div className="card card-pad workspace-state" role="status"><div><strong>Settings are not available.</strong><p>Register settings will appear here when this device is assigned.</p></div></div>
      ) : null}

      {state !== "loading" && state !== "empty" ? (
        <div className="settings-grid">
          <section className="card card-pad stack" aria-labelledby="device-register-title">
            <h2 id="device-register-title">Device & register</h2>
            <div className="settings-value"><span className="label">Device</span><strong>{friendlyDeviceName(settings.deviceName)}</strong></div>
            <div className="settings-value"><span className="label">Register</span><strong>{settings.registerName}</strong></div>
            <div className="settings-value"><span className="label">Scanner</span><span>{scannerCapabilityLabel(settings.scannerLabel)}</span></div>
            <div className="settings-value"><span className="label">Printer</span><span>{printerCapabilityLabel(settings.printerLabel)}</span></div>
            <label className="field" htmlFor="receipt-paper-width">
              <span>Receipt paper width</span>
              <select
                id="receipt-paper-width"
                className="select"
                value={paperWidth}
                disabled={!onPaperWidthChange}
                onChange={(event) => onPaperWidthChange?.(event.target.value === "58" ? 58 : 80)}
              >
                <option value={80}>80 mm</option>
                <option value={58}>58 mm</option>
              </select>
            </label>
            <p className="muted">Saved on this device. Match the paper width in the printer dialog.</p>
          </section>

          <section className="card card-pad stack settings-side" aria-labelledby="appearance-title">
            <h2 id="appearance-title">Appearance</h2>
            <label className="field" htmlFor="appearance-select">
              <span>Theme</span>
              <select
                id="appearance-select"
                className="select"
                value={settings.appearance}
                disabled={!onAppearanceChange}
                onChange={(event) => onAppearanceChange?.(event.target.value as AppearancePreference)}
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            {onOpenStoreHealth ? (
              <>
                <div className="settings-divider" />
                <h2>System status</h2>
                <p className="muted">Check connection and service availability. Management diagnostics stay in the Management workspace.</p>
                <button className="btn block" type="button" onClick={onOpenStoreHealth}>
                  Open System status
                </button>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  );
}
