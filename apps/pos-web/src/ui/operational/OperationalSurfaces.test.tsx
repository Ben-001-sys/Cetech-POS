import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StoreHealth } from "../../../../../docs/contracts/domain.generated";
import {
  ConnectivityNotice,
  FixAppPanel,
  LocalDataMigrationPanel,
  NeedsAttentionScreen,
  PassiveTabNotice,
  StoreHealthScreen,
  UpdateReadyDialog,
} from "./OperationalSurfaces";

const health: StoreHealth = {
  checks: [
    { id: "commerce", status: "healthy", message: "Commerce reachable", checkedAt: "2026-09-17T10:00:00.000Z" },
    { id: "pricing", status: "degraded", message: "Pricing parity not verified", checkedAt: "2026-09-17T10:00:00.000Z" },
    { id: "payments", status: "unavailable", message: "Provider unavailable", checkedAt: "2026-09-17T10:00:00.000Z" },
  ],
  contractVersion: "1.0.0",
  pendingOperationCount: 2,
  attentionCount: 1,
  buildId: "r8-staging",
};

describe("operational recovery surfaces", () => {
  test("cashier System status stays operational and hides support diagnostics", () => {
    const html = renderToStaticMarkup(<StoreHealthScreen health={health} onOpenAttention={() => undefined} />);
    expect(html).toContain("System status");
    expect(html).toContain("Pending work");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Store connection");
    expect(html).toContain("Prices");
    expect(html).toContain("View attention");
    expect(html).toContain("Degraded");
    expect(html).toContain("Unverified");
    expect(html).not.toContain("1.0.0");
    expect(html).not.toContain("r8-staging");
    expect(html).not.toContain("API contract");
    expect(html).not.toContain("Local schema");
    expect(html).not.toContain("Version &amp; recovery");
    expect(html).not.toContain("Technical details");
    expect(html).not.toContain("Fix App");
    expect(html).not.toContain("Rebuild catalog");
  });

  test("System status loading, offline, degraded and error states remain explicit", () => {
    expect(renderToStaticMarkup(<StoreHealthScreen state="loading" />)).toContain("Checking System status…");
    expect(renderToStaticMarkup(<StoreHealthScreen state="offline" />)).toContain("You are offline.");
    expect(renderToStaticMarkup(<StoreHealthScreen state="degraded" />)).toContain("Connection is degraded.");
    expect(renderToStaticMarkup(<StoreHealthScreen state="error" />)).toContain("couldn&#x27;t be refreshed");
  });

  test("Needs attention exposes only supplied safe actions", () => {
    const html = renderToStaticMarkup(
      <NeedsAttentionScreen
        items={[{ id: "a1", title: "Payment status uncertain", summary: "Resolve the existing payment before retrying.", typeLabel: "Payment", severity: "critical", transactionReference: "tx-1", resolveAllowed: true }]}
        onResolveItem={() => undefined}
      />,
    );
    expect(html).toContain("Needs attention");
    expect(html).toContain("Payment status uncertain");
    expect(html).toContain("Check / Recover");
    expect(html).not.toContain("Retry safely");
  });

  test("Check / Recover is disabled while recovery is in flight", () => {
    const html = renderToStaticMarkup(
      <NeedsAttentionScreen
        items={[{ id: "a1", title: "Payment status uncertain", summary: "Resolve the existing payment before retrying.", typeLabel: "Payment", severity: "critical", transactionReference: "tx-1", resolveAllowed: true }]}
        recoveringItemId="a1"
        onResolveItem={() => undefined}
      />,
    );
    expect(html).toContain("Check / Recover");
    expect(html).toContain("disabled");
    expect(html).toContain('aria-busy="true"');
  });

  test("Update Ready blocks activation when critical work exists and allows a safe state", () => {
    const blocked = renderToStaticMarkup(<UpdateReadyDialog open safety="blocked_critical" currentBuild="r8" onLater={() => undefined} onApply={() => undefined} />);
    expect(blocked).toContain("Update blocked by active transaction.");
    expect(blocked).not.toContain("Current build");
    expect(blocked).not.toContain("r8");
    expect(blocked).toContain("disabled");
    const safe = renderToStaticMarkup(<UpdateReadyDialog open safety="safe" currentBuild="r8" nextBuild="r8.1" onLater={() => undefined} onApply={() => undefined} />);
    expect(safe).toContain("Safe to update.");
    expect(safe).not.toContain("Current build");
    expect(safe).not.toContain("r8");
    expect(safe).toContain("New version ready");
    expect(safe).not.toContain("r8.1");
  });

  test("connectivity, passive-tab, migration and Troubleshoot copy preserve critical local state", () => {
    expect(renderToStaticMarkup(<ConnectivityNotice state="offline" />)).toContain("Saved local work stays on this device.");
    expect(renderToStaticMarkup(<PassiveTabNotice passive />)).toContain("This tab is read-only.");
    expect(renderToStaticMarkup(<LocalDataMigrationPanel state="blocked" />)).toContain("Data has not been deleted.");
    const fix = renderToStaticMarkup(<FixAppPanel criticalOperationActive onLastResortReset={() => undefined} />);
    expect(fix).toContain("Repair safely first.");
    expect(fix).toContain("Destructive reset blocked.");
    expect(fix).toContain("disabled");
  });
});
