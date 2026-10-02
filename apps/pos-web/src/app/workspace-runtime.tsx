"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CustomerPort, PrintPort, ReceiptPort } from "../../../../docs/contracts/ports";
import type { CustomerSummary, StoreHealth } from "../../../../docs/contracts/domain.generated";
import type { PaymentMethodCapabilities } from "../server/payments/method-capabilities";
import { OrdersScreen, OrderDetailDialog, type OrderDetailView, type OrderListItemView } from "../features/orders";
import { ReceiptPaper } from "../features/sell/components/ReceiptPaper";
import type { ReceiptViewModel } from "../features/sell/state/checkoutSession";
import { mapReceiptSnapshot } from "../features/sell/runtime/cashCheckoutController";
import { receiptPaperIsMounted, reprintImmutableReceipt } from "../features/orders/reprint-receipt";
import { CustomersScreen } from "../features/customers";
import { loadCustomerSearchPresentation } from "../features/customers/loadCustomerSearch";
import { SettingsScreen, type AppearancePreference } from "../features/settings";
import { applyAppearance, readStoredAppearance } from "../features/settings/appearance";
import {
  KEYBOARD_SCANNER_CAPABILITY,
  BROWSER_PRINT_CAPABILITY,
  toCashierError,
} from "../ui/cashier-language";
import {
  NeedsAttentionScreen,
  StoreHealthScreen,
  type AttentionItemView,
  type OperationalLoadState,
} from "../ui/operational";
import { inspectLocalRecoveryState, type LocalRecoveryDiagnostics } from "../local";
import type { CatalogProjectionAvailability, CatalogProjectionSyncResult } from "../local/catalog-sync";
import { ensureCatalogProjection } from "../local/catalog-sync";
import { resolveBrowserCatalogSourcePolicy } from "../core/catalog/source-policy";
import type { StaffRuntimeAuthority } from "../core/identity";
import type { PosRoute } from "../ui/shell";
import { catalogRebuildStatusText, type CatalogRebuildView } from "./catalog-rebuild-status";
import { usePwaLifecycle } from "./pwa-lifecycle-runtime";
import {
  fetchCustomerDirectory,
  fetchOrderDetail,
  fetchOrderHistory,
  fetchPaymentMethodCapabilities,
  fetchStoreHealth,
} from "./operational-client";

export function ApprovedWorkspaceScreens({
  route,
  authority,
  customers,
  online,
  catalogAvailability,
  fetchImpl,
  appearance,
  attentionItems,
  attentionCount,
  attentionState,
  onNavigate,
  onCatalogProjectionChange,
  onUseCustomer,
  onAppearanceChange,
  onRebuildSuccess,
  onRetryAttention,
  selectedCustomerId,
  receipts,
  printer,
  onStartReturn,
  onResolveAttention,
  recoveringItemId,
}: {
  readonly route: PosRoute;
  readonly authority: StaffRuntimeAuthority;
  readonly customers: CustomerPort;
  readonly online: boolean;
  readonly catalogAvailability: CatalogProjectionAvailability | null;
  readonly fetchImpl?: typeof fetch;
  readonly appearance: AppearancePreference;
  readonly attentionItems: readonly AttentionItemView[];
  readonly attentionCount: number;
  readonly attentionState: OperationalLoadState;
  readonly onNavigate: (route: PosRoute) => void;
  readonly onCatalogProjectionChange?: (result: CatalogProjectionSyncResult) => void;
  readonly onUseCustomer: (customer: CustomerSummary) => void;
  readonly onAppearanceChange: (appearance: AppearancePreference) => void;
  readonly onRebuildSuccess: () => void;
  readonly onRetryAttention: () => void;
  readonly selectedCustomerId?: string;
  readonly receipts?: ReceiptPort;
  readonly printer?: PrintPort;
  readonly onStartReturn?: (saleId: string) => void;
  readonly onResolveAttention?: (item: AttentionItemView) => void;
  readonly recoveringItemId?: string | null;
}) {
  if (route === "orders") {
    return (
      <OrdersWorkspace
        online={online}
        fetchImpl={fetchImpl}
        onNavigate={onNavigate}
        receipts={receipts}
        printer={printer}
        onStartReturn={onStartReturn}
      />
    );
  }
  if (route === "customers") {
    return (
      <CustomersWorkspace
        customers={customers}
        online={online}
        fetchImpl={fetchImpl}
        selectedCustomerId={selectedCustomerId}
        onUseCustomer={onUseCustomer}
      />
    );
  }
  if (route === "settings") {
    return (
      <SettingsScreen
        settings={{
          deviceName: authority.shift?.deviceId ? "Assigned to current shift" : "Select a POS device when opening a register",
          registerName: authority.register?.name ?? "No register assigned",
          scannerLabel: KEYBOARD_SCANNER_CAPABILITY,
          printerLabel: BROWSER_PRINT_CAPABILITY,
          appearance,
        }}
        state={online ? "ready" : "offline"}
        onAppearanceChange={onAppearanceChange}
        onOpenStoreHealth={() => onNavigate("health")}
      />
    );
  }
  if (route === "health") {
    return (
      <HealthWorkspace
        catalogAvailability={catalogAvailability}
        fetchImpl={fetchImpl}
        online={online}
        attentionCount={attentionCount}
        onNavigate={onNavigate}
      />
    );
  }
  if (route === "attention") {
    return (
      <AttentionWorkspace
        items={attentionItems}
        state={attentionState}
        fetchImpl={fetchImpl}
        onCatalogProjectionChange={onCatalogProjectionChange}
        onRetryLoad={onRetryAttention}
        onResolveAttention={onResolveAttention}
        recoveringItemId={recoveringItemId}
        onRebuildSuccess={onRebuildSuccess}
      />
    );
  }
  return null;
}

function OrdersWorkspace({
  online,
  fetchImpl,
  onNavigate,
  receipts,
  printer,
  onStartReturn,
}: {
  readonly online: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly onNavigate: (route: PosRoute) => void;
  readonly receipts?: ReceiptPort;
  readonly printer?: PrintPort;
  readonly onStartReturn?: (saleId: string) => void;
}) {
  const [orders, setOrders] = useState<readonly OrderListItemView[]>([]);
  const [state, setState] = useState<"ready" | "loading" | "error" | "offline">("loading");
  const [detail, setDetail] = useState<OrderDetailView | undefined>();
  const [detailOpen, setDetailOpen] = useState(false);
  const [printReceipt, setPrintReceipt] = useState<ReceiptViewModel | null>(null);
  const [actionMessage, setActionMessage] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | undefined>();

  const load = useCallback(async () => {
    setState("loading");
    const result = await fetchOrderHistory("", fetchImpl);
    if (!result.ok) {
      setState("error");
      return;
    }
    setOrders(result.data.items);
    setState(online ? "ready" : "offline");
  }, [fetchImpl, online]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <>
      <OrdersScreen
        orders={orders}
        state={state}
        actionMessage={actionMessage}
        actionError={actionError}
        onRetry={() => {
          void load();
        }}
        onNewSale={() => onNavigate("sell")}
        onSelectOrder={(orderId) => {
          setActionMessage(undefined);
          setActionError(undefined);
          void (async () => {
            const result = await fetchOrderDetail(orderId, fetchImpl);
            if (!result.ok) {
              setActionError("Order details could not be loaded. Try again.");
              return;
            }
            setDetail(result.data);
            setDetailOpen(true);
          })();
        }}
      />
      <OrderDetailDialog
        open={detailOpen}
        order={detail}
        onClose={() => setDetailOpen(false)}
        onReprint={
          receipts && printer
            ? (order) => {
                setActionMessage(undefined);
                setActionError(undefined);
                void (async () => {
                  const outcome = await reprintImmutableReceipt({
                    transactionId: order.id,
                    receipts,
                    mapReceipt: mapReceiptSnapshot,
                    present: (view) => {
                      flushSync(() => {
                        setPrintReceipt(view);
                      });
                      return receiptPaperIsMounted(document, view.receiptNumber);
                    },
                    print: (receiptId) => printer.print({ receiptId, reason: "reprint" }),
                  });
                  if (!outcome.ok) {
                    setPrintReceipt(null);
                    setActionError(outcome.message);
                    return;
                  }
                  if (outcome.printed.status === "dialog_opened") {
                    setActionMessage("Print dialog opened.");
                  } else {
                    setActionError(outcome.printed.message ?? "Receipt printing is not available.");
                  }
                  setPrintReceipt(null);
                })();
              }
            : undefined
        }
        onStartReturn={
          onStartReturn
            ? (order) => {
                setDetailOpen(false);
                onStartReturn(order.saleId ?? order.id);
              }
            : undefined
        }
      />
      {printReceipt ? (
        <div className="receipt-print-host" aria-hidden="true">
          <ReceiptPaper receipt={printReceipt} />
        </div>
      ) : null}
    </>
  );
}

function CustomersWorkspace({
  customers,
  online,
  fetchImpl,
  selectedCustomerId,
  onUseCustomer,
}: {
  readonly customers: CustomerPort;
  readonly online: boolean;
  readonly fetchImpl?: typeof fetch;
  readonly selectedCustomerId?: string;
  readonly onUseCustomer: (customer: CustomerSummary) => void;
}) {
  const [rows, setRows] = useState<readonly CustomerSummary[]>([]);
  const [commercialContextById, setCommercialContextById] = useState<Readonly<Record<string, string>>>({});
  const [state, setState] = useState<"ready" | "loading" | "error" | "offline">("loading");

  const loadGeneration = useRef(0);

  const load = useCallback(async (query = "") => {
    const generation = ++loadGeneration.current;
    const result = await loadCustomerSearchPresentation({
      query,
      remoteSearch: (needle: string) => fetchCustomerDirectory(needle, fetchImpl),
      localSearch: (needle: string) => customers.search(needle),
    });
    if (generation !== loadGeneration.current) {
      return;
    }
    if (!result.ok) {
      setState("error");
      return;
    }
    setRows(result.customers);
    setCommercialContextById(result.commercialContextById);
    setState(online ? "ready" : "offline");
  }, [customers, fetchImpl, online]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load("");
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <CustomersScreen
      customers={rows}
      state={state}
      selectedCustomerId={selectedCustomerId}
      commercialContextById={commercialContextById}
      onRetry={() => {
        void load("");
      }}
      onSearchQueryChange={(query) => {
        void load(query);
      }}
      onUseCustomer={onUseCustomer}
    />
  );
}

function HealthWorkspace({
  catalogAvailability,
  fetchImpl,
  online,
  attentionCount,
  onNavigate,
}: {
  readonly catalogAvailability: CatalogProjectionAvailability | null;
  readonly fetchImpl?: typeof fetch;
  readonly online: boolean;
  readonly attentionCount: number;
  readonly onNavigate: (route: PosRoute) => void;
}) {
  const lifecycle = usePwaLifecycle();
  const [health, setHealth] = useState<StoreHealth | undefined>();
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodCapabilities | undefined>();
  const [state, setState] = useState<OperationalLoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [recovery, setRecovery] = useState<LocalRecoveryDiagnostics | undefined>();
  const [updateCheckBusy, setUpdateCheckBusy] = useState(false);

  const load = useCallback(async () => {
    const [result, diagnostics, capabilities] = await Promise.all([
      fetchStoreHealth(fetchImpl),
      inspectLocalRecoveryState().catch(() => undefined),
      fetchPaymentMethodCapabilities(fetchImpl),
    ]);
    setPaymentMethods(capabilities.ok ? capabilities.data : undefined);
    setRecovery(diagnostics);
    if (!result.ok) {
      setHealth(undefined);
      setState("error");
      setErrorMessage(
        toCashierError({
          code: result.error.code,
          message: result.error.message,
          domain: "health",
        }).message,
      );
      return;
    }
    setHealth(result.data);
    setState(online ? "ready" : "offline");
    setErrorMessage(undefined);
  }, [fetchImpl, online]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <>
      <StoreHealthScreen
        health={health}
        state={state}
        errorMessage={errorMessage}
        online={online}
        catalogAvailability={catalogAvailability}
        paymentMethods={paymentMethods}
        attentionCountOverride={attentionCount}
        onRetry={() => {
          void load();
        }}
        onOpenAttention={() => onNavigate("attention")}
      />

      {recovery ? (
        <section className="card card-pad operational-panel" aria-labelledby="recovery-summary-title">
          <h2 id="recovery-summary-title">Saved work</h2>
          <p className="muted">
            Your current sale and pending work are kept while the app updates or refreshes.
          </p>
          <div className="operational-metrics" aria-label="Recovery summary">
            <div className="card operational-metric">
              <span className="eyebrow">Current sale saved</span>
              <strong>{recovery.recoverableCartCount > 0 ? "Yes" : "No"}</strong>
            </div>
            <div className="card operational-metric">
              <span className="eyebrow">Pending work</span>
              <strong>{recovery.pendingOperationCount}</strong>
            </div>
            <div className="card operational-metric">
              <span className="eyebrow">Needs attention</span>
              <strong>{recovery.attentionOperationCount}</strong>
            </div>
          </div>

          {!recovery.schemaCompatible ? (
            <div className="banner danger" role="alert">
              <strong>Saved offline data needs a safe update.</strong>
              <span>Do not clear the current sale or pending work as a normal repair step.</span>
            </div>
          ) : null}

          {recovery.pendingOperationCount > 0 ? (
            <div className="banner warning" role="status">
              <strong>Pending work must be resolved before an app update.</strong>
              <span>Do not repeat a sale just because its result is not yet confirmed.</span>
            </div>
          ) : null}

          {lifecycle?.updateReady ? (
            <div className="banner info" role="status">
              <strong>Update ready.</strong>
              <span>The app will wait for a safe point before applying it.</span>
            </div>
          ) : null}

          {lifecycle ? (
            <div className="operational-actions">
              <button
                className="btn"
                type="button"
                disabled={updateCheckBusy}
                onClick={() => {
                  setUpdateCheckBusy(true);
                  void lifecycle.checkForUpdate().finally(() => setUpdateCheckBusy(false));
                }}
              >
                {updateCheckBusy ? "Checking for update…" : "Check for update"}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

function AttentionWorkspace({
  items,
  state,
  fetchImpl,
  onCatalogProjectionChange,
  onRetryLoad,
  onResolveAttention,
  recoveringItemId,
  onRebuildSuccess,
}: {
  readonly items: readonly AttentionItemView[];
  readonly state: OperationalLoadState;
  readonly fetchImpl?: typeof fetch;
  readonly onCatalogProjectionChange?: (result: CatalogProjectionSyncResult) => void;
  readonly onRetryLoad: () => void;
  readonly onResolveAttention?: (item: AttentionItemView) => void;
  readonly recoveringItemId?: string | null;
  readonly onRebuildSuccess: () => void;
}) {
  const [catalogRebuild, setCatalogRebuild] = useState<CatalogRebuildView>({ phase: "idle" });
  const catalogRefreshing = catalogRebuild.phase === "rebuilding";
  const catalogStatus = catalogRebuildStatusText(catalogRebuild);

  return (
    <>
      {catalogStatus ? (
        <div
          className={`banner ${catalogRebuild.phase === "failure" ? "danger" : catalogRebuild.phase === "stale" ? "warning" : "info"} operational-banner`}
          role="status"
          aria-live="polite"
        >
          <strong>{catalogRebuild.phase === "rebuilding" ? "Refreshing products…" : catalogRebuild.phase === "success" ? "Products refreshed." : "Product refresh status"}</strong>
          {catalogRebuild.phase !== "rebuilding" ? <span>{catalogStatus}</span> : <span>Checking for the latest product list. You can keep this screen open.</span>}
        </div>
      ) : null}
      <NeedsAttentionScreen
      items={items}
      state={state}
      recoveringItemId={catalogRefreshing ? "catalog-projection" : recoveringItemId}
      onRetryLoad={onRetryLoad}
      onRetryItem={(id) => {
        if (id !== "catalog-projection" || catalogRefreshing) {
          return;
        }
        void runCatalogRebuild({
          fetchImpl,
          onCatalogProjectionChange,
          setRebuild: setCatalogRebuild,
          onSuccess: onRebuildSuccess,
        });
      }}
      onResolveItem={
        onResolveAttention
          ? (id) => {
              const item = items.find((row) => row.id === id);
              if (item) {
                onResolveAttention(item);
              }
            }
          : undefined
      }
    />
    </>
  );
}

export function clientAttentionExtras(input: {
  readonly catalogAvailability: CatalogProjectionAvailability | null;
  readonly authority: StaffRuntimeAuthority;
}): readonly AttentionItemView[] {
  const next: AttentionItemView[] = [];
  if (input.catalogAvailability === "unavailable" || input.catalogAvailability === "stale") {
    next.push({
      id: "catalog-projection",
      title: input.catalogAvailability === "unavailable" ? "Products couldn't be loaded" : "Products may be out of date",
      summary:
        input.catalogAvailability === "unavailable"
          ? "Products are not available on this device yet. Saved carts are kept."
          : "The product list may be older than the last successful update. Search still uses saved products.",
      typeLabel: "Products",
      severity: input.catalogAvailability === "unavailable" ? "critical" : "medium",
      retryAllowed: true,
      resolveAllowed: false,
      reviewAllowed: false,
      recoverKind: "catalog",
    });
  }
  if (
    input.authority.status === "ready" &&
    !input.authority.presentationOnly &&
    input.authority.assignedRegisterIds.length === 0 &&
    !input.authority.register
  ) {
    next.push({
      id: "register-unassigned",
      title: "No register assigned",
      summary: "No register is assigned to this staff account. Opening or closing a shift stays unavailable until a manager assigns one.",
      typeLabel: "Register",
      severity: "medium",
      recoverKind: "register",
    });
  } else if (input.authority.register && !input.authority.shiftOpen) {
    next.push({
      id: "shift-closed",
      title: "No open shift",
      summary: "Checkout stays unavailable until you open a shift on an assigned register. Open Register to continue.",
      typeLabel: "Register",
      severity: "low",
      recoverKind: "register",
    });
  }
  return next;
}

async function runCatalogRebuild(input: {
  readonly fetchImpl?: typeof fetch;
  readonly onCatalogProjectionChange?: (result: CatalogProjectionSyncResult) => void;
  readonly setRebuild: (view: CatalogRebuildView) => void;
  readonly onSuccess?: () => void;
}): Promise<void> {
  input.setRebuild({ phase: "rebuilding" });
  try {
    const result = await ensureCatalogProjection({
      policy: resolveBrowserCatalogSourcePolicy({
        hostname: typeof window === "undefined" ? "localhost" : window.location.hostname,
        nodeEnv: process.env.NODE_ENV,
      }),
      fetchImpl: input.fetchImpl,
      force: true,
    });
    if (result.availability === "unavailable") {
      input.setRebuild({
        phase: "failure",
        message: "Products couldn't be refreshed. Check the connection and try again.",
      });
      input.onCatalogProjectionChange?.(result);
      return;
    }
    if (result.availability === "stale") {
      input.setRebuild({
        phase: "stale",
        itemCount: result.itemCount,
        availability: "stale",
        message: "Saved products are still available, but the latest product update failed. Try again when the connection is stable.",
      });
      input.onCatalogProjectionChange?.(result);
      return;
    }
    input.setRebuild({
      phase: "success",
      itemCount: result.itemCount,
      availability: "fresh",
    });
    input.onCatalogProjectionChange?.(result);
    input.onSuccess?.();
  } catch (error) {
    input.setRebuild({
      phase: "failure",
      message: error instanceof Error ? error.message : "catalog rebuild is unavailable",
    });
  }
}

export { readStoredAppearance, applyAppearance };
