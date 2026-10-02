"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { receiptPaperIsMounted } from "../../orders/reprint-receipt";
import type { CartDraftStore, CatalogPort, CheckoutUseCases, CustomerPort, PaymentPort, PricingPort, PrintPort, ReceiptPort, SalesPort } from "../../../../../../docs/contracts/ports";
import { SellScreen } from "../SellScreen";
import { ReceiptPaper } from "../components/ReceiptPaper";
import { useElectronicPayment } from "../../payments/useElectronicPayment";
import { type TenderAvailabilityView, electronicTenderAvailable } from "../components/TenderChoice";
import type { CatalogAvailability, CustomerSearchResultView, SellProductView, SellWorkspaceState } from "../state/sellView";
import type { ProductDisplayPriceView } from "../state/variableDisplayPrice";
import { lookupBarcodeViews, lookupVariations, searchCatalogViews, enrichSellProductPrices } from "./catalogLookup";
import { bindPriceCacheToGeneration } from "./productDisplayPriceCache";
import { electronicSessionLocksCheckout } from "../components/PaymentWaiting";
import { customerSummaryFromSelection, customerViewFromSummary, workspaceToCartDraft } from "./mapCartDraft";
import { restoreSellWorkspace } from "./restoreWorkspace";
import { useCartQuote } from "./useCartQuote";
import { useCashCheckout, type CashCheckoutPorts } from "./useCashCheckout";
import type { ReceiptViewModel } from "../state/checkoutSession";
import type { CashCheckoutScope } from "./cashCheckoutController";
import type { CartDraft } from "../../../../../../docs/contracts/domain.generated";
import type { PaymentMethodCapabilities } from "../../../server/payments/method-capabilities";

export type SellSessionPorts = {
  readonly catalog: CatalogPort;
  readonly customers: CustomerPort;
  readonly drafts: CartDraftStore;
  readonly rememberCartId: (cartId: string) => Promise<void>;
  readonly recallCartId: () => Promise<string | null>;
  readonly replaceActiveCart: (previousCartId: string, next: CartDraft) => Promise<void>;
  readonly locationId: string;
  readonly now?: () => Date;
  readonly online?: () => boolean;
  readonly createCartId?: () => string;
  readonly createLineId?: () => string;
  readonly pricing?: PricingPort;
  readonly shiftOpen?: boolean;
  readonly checkout?: CheckoutUseCases;
  readonly payments?: Pick<PaymentPort, "confirmCash" | "resolve"> & Partial<Pick<PaymentPort, "initialize">>;
  readonly sales?: Pick<SalesPort, "resolve" | "cancel">;
  readonly receipts?: ReceiptPort;
  readonly printer?: PrintPort;
  readonly checkoutScope?: CashCheckoutScope;
  readonly createCheckoutUuid?: () => string;
  readonly catalogAvailability?: CatalogAvailability;
  readonly catalogProjectionGeneration?: number;
  readonly paymentMethods?: PaymentMethodCapabilities;
  readonly nextSaleCustomer?: CustomerSearchResultView | null;
  readonly onNextSaleCustomerApplied?: (customer: CustomerSearchResultView) => void;
  readonly customerSearch?: (query: string) => Promise<readonly CustomerSearchResultView[]>;
};

function defaultNow(): Date {
  return new Date();
}

function defaultOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

function defaultIdFactory(prefix: string): () => string {
  return () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${prefix}-${Date.now()}`);
}

function availabilityFromNetwork(online: boolean, searchFailed: boolean, hasCache: boolean): CatalogAvailability {
  if (searchFailed && !hasCache) return "unavailable";
  if (!online && hasCache) return "offline_cached";
  if (!online) return "offline";
  if (searchFailed) return "stale";
  return "fresh";
}

function preserveProjectionAvailability(
  current: CatalogAvailability,
  online: boolean,
  searchFailed: boolean,
  hasCache: boolean,
): CatalogAvailability {
  if (current === "unavailable") {
    return "unavailable";
  }
  if (current === "stale" && !searchFailed) {
    return online ? "stale" : "offline_cached";
  }
  return availabilityFromNetwork(online, searchFailed, hasCache);
}

export function SellLoadingSkeleton() {
  return (
    <div className="sell-workspace sell-loading-workspace" role="status" aria-live="polite" aria-busy="true">
      <div className="sell-loading-head">
        <div className="sell-skeleton sell-skeleton-search" />
        <div className="sell-loading-label">Loading saved products…</div>
      </div>
      <div className="sell-loading-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <div className="sell-loading-card" key={index}>
            <div className="sell-skeleton sell-skeleton-title" />
            <div className="sell-skeleton sell-skeleton-line" />
            <div className="sell-skeleton sell-skeleton-line short" />
            <div className="sell-skeleton sell-skeleton-price" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SellRuntimeScreen(ports: SellSessionPorts) {
  const fallbackCreateCartId = useMemo(() => defaultIdFactory("cart"), []);
  const fallbackCreateLineId = useMemo(() => defaultIdFactory("line"), []);
  const createCartId = ports.createCartId ?? fallbackCreateCartId;
  const createLineId = ports.createLineId ?? fallbackCreateLineId;
  const now = useMemo(() => ports.now ?? defaultNow, [ports.now]);
  const online = useMemo(() => ports.online ?? defaultOnline, [ports.online]);
  const catalog = ports.catalog;
  const customersPort = ports.customers;
  const drafts = ports.drafts;
  const rememberCartId = ports.rememberCartId;
  const recallCartId = ports.recallCartId;
  const locationId = ports.locationId;
  const nowRef = useRef(now);
  const onlineRef = useRef(online);
  const persistenceQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [ready, setReady] = useState(false);
  const [initialState, setInitialState] = useState<SellWorkspaceState | undefined>(undefined);
  const [browseCatalog, setBrowseCatalog] = useState<readonly SellProductView[]>([]);
  const [customers, setCustomers] = useState<readonly CustomerSearchResultView[]>([]);
  const [searchStatus, setSearchStatus] = useState<SellWorkspaceState["search"]["status"]>("idle");
  const [availability, setAvailability] = useState<CatalogAvailability>(ports.catalogAvailability ?? "fresh");
  const [workspace, setWorkspace] = useState<SellWorkspaceState | undefined>(undefined);
  const [restoreCount, setRestoreCount] = useState(0);
  const priceCacheRef = useRef(new Map<string, ProductDisplayPriceView>());
  const customerSearchSeqRef = useRef(0);
  const observedProjectionGenerationRef = useRef<number | undefined>(undefined);
  const browseProjectionGenerationRef = useRef<number | undefined>(undefined);
  const projectionGeneration = ports.catalogProjectionGeneration ?? 0;
  const connected = online();
  const presentedQuote = useCartQuote({
    pricing: ports.pricing,
    workspace,
    locationId,
    online: connected,
    shiftOpen: ports.shiftOpen ?? true,
    now,
  });
  const checkoutPorts = useMemo<CashCheckoutPorts | undefined>(() => {
    if (!ports.checkout || !ports.payments || !ports.sales || !ports.receipts || !ports.printer || !ports.checkoutScope) {
      return undefined;
    }
    return {
      checkout: ports.checkout,
      payments: ports.payments,
      sales: ports.sales,
      receipts: ports.receipts,
      printer: ports.printer,
      scope: ports.checkoutScope,
      createUuid: ports.createCheckoutUuid,
    };
  }, [
    ports.checkout,
    ports.checkoutScope,
    ports.createCheckoutUuid,
    ports.payments,
    ports.printer,
    ports.receipts,
    ports.sales,
  ]);
  const cashCheckout = useCashCheckout(checkoutPorts);
  const [printReceipt, setPrintReceipt] = useState<ReceiptViewModel | null>(null);
  const electronicPorts = useMemo(() => {
    if (!ports.payments?.initialize || !ports.payments.resolve) {
      return undefined;
    }
    return {
      payments: {
        initialize: ports.payments.initialize,
        resolve: ports.payments.resolve,
      },
      createUuid: ports.createCheckoutUuid,
    };
  }, [ports.createCheckoutUuid, ports.payments]);
  const electronic = useElectronicPayment(electronicPorts);
  const cashCheckoutRef = useRef(cashCheckout);
  const tenderAvailability = useMemo<TenderAvailabilityView>(() => {
    const canStartElectronic = Boolean(ports.payments?.initialize);
    const methods = ports.paymentMethods;
    return {
      cash: true,
      mobileMoney: canStartElectronic && methods?.mobileMoney === "configured",
      card: canStartElectronic && methods?.card === "configured",
      externalElectronic: canStartElectronic && methods?.externalTerminal === "configured",
    };
  }, [ports.paymentMethods, ports.payments?.initialize]);

  useEffect(() => {
    cashCheckoutRef.current = cashCheckout;
  }, [cashCheckout]);

  useEffect(() => {
    if (electronic.session.status === "verified") {
      void cashCheckoutRef.current.resolvePayment();
    }
  }, [electronic.session.paymentId, electronic.session.status]);

  useEffect(() => {
    nowRef.current = now;
    onlineRef.current = online;
  }, [now, online]);

  useLayoutEffect(() => {
    bindPriceCacheToGeneration(
      priceCacheRef.current,
      observedProjectionGenerationRef,
      projectionGeneration,
    );
  }, [projectionGeneration]);

  useEffect(() => {
    if (browseProjectionGenerationRef.current === undefined) {
      browseProjectionGenerationRef.current = projectionGeneration;
      return;
    }
    if (browseProjectionGenerationRef.current === projectionGeneration) {
      return;
    }
    browseProjectionGenerationRef.current = projectionGeneration;
    let cancelled = false;
    void (async () => {
      const browse = await searchCatalogViews(catalog, "");
      if (cancelled || !browse.ok) {
        return;
      }
      const views = await enrichSellProductPrices(catalog, browse.items, priceCacheRef.current);
      if (!cancelled) {
        setBrowseCatalog(views);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, projectionGeneration]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const connectedNow = onlineRef.current();
      const browse = await searchCatalogViews(catalog, "");
      const customerPage = await customersPort.search("");
      const views = browse.ok ? await enrichSellProductPrices(catalog, browse.items, priceCacheRef.current) : [];
      const restored = await restoreSellWorkspace({
        catalog,
        customers: customersPort,
        drafts,
        recallCartId,
        browseCatalog: views,
        deps: { createCartId, createLineId },
        availability:
          ports.catalogAvailability ??
          availabilityFromNetwork(connectedNow, !browse.ok, views.length > 0),
      });
      if (cancelled) return;
      await drafts.save(workspaceToCartDraft(restored, locationId, nowRef.current().toISOString()));
      await rememberCartId(restored.cartId);
      if (cancelled) return;
      setBrowseCatalog(views);
      setCustomers(customerPage.ok ? customerPage.data.map(customerViewFromSummary) : []);
      setAvailability(restored.catalogAvailability);
      setSearchStatus(browse.ok ? "ready" : "error");
      setInitialState(restored);
      setWorkspace(restored);
      setRestoreCount((count) => count + 1);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [catalog, createCartId, createLineId, customersPort, drafts, locationId, ports.catalogAvailability, recallCartId, rememberCartId]);

  const enqueuePersistence = useCallback((task: () => Promise<void>): Promise<void> => {
    const next = persistenceQueueRef.current.catch(() => undefined).then(task);
    persistenceQueueRef.current = next;
    return next;
  }, []);

  const persist = useCallback(
    (state: SellWorkspaceState) => {
      setWorkspace(state);
      const draft = workspaceToCartDraft(state, locationId, now().toISOString());
      void enqueuePersistence(async () => {
        await drafts.save(draft);
        await rememberCartId(state.cartId);
      }).catch(() => undefined);
    },
    [drafts, enqueuePersistence, locationId, now, rememberCartId],
  );

  const transitionActiveCart = useCallback(
    async (
      previous: SellWorkspaceState,
      next: SellWorkspaceState,
      _reason: "completed" | "discarded",
    ): Promise<void> => {
      const nextDraft = workspaceToCartDraft(next, locationId, now().toISOString());
      await enqueuePersistence(() => ports.replaceActiveCart(previous.cartId, nextDraft));
      setWorkspace(next);
    },
    [enqueuePersistence, locationId, now, ports],
  );

  const resolveBarcodeCatalog = useCallback(
    async (barcode: string) => {
      const result = await lookupBarcodeViews(catalog, barcode);
      if (!result.ok) {
        setAvailability((current) =>
          preserveProjectionAvailability(current, online(), true, current !== "unavailable"),
        );
        return [];
      }
      return enrichSellProductPrices(catalog, result.items, priceCacheRef.current);
    },
    [catalog, online],
  );

  const searchCatalog = useCallback(
    async (query: string) => {
      setSearchStatus("loading");
      const result = await searchCatalogViews(catalog, query);
      if (!result.ok) {
        setSearchStatus("error");
        setAvailability((current) =>
          preserveProjectionAvailability(
            current,
            online(),
            true,
            browseCatalog.length > 0 || current === "offline_cached" || current === "stale",
          ),
        );
        return browseCatalog;
      }
      const enriched = await enrichSellProductPrices(catalog, result.items, priceCacheRef.current);
      setSearchStatus("ready");
      setAvailability((current) =>
        preserveProjectionAvailability(
          current,
          online(),
          false,
          enriched.length > 0 || browseCatalog.length > 0,
        ),
      );
      return enriched;
    },
    [browseCatalog, catalog, online],
  );

  const loadVariations = useCallback(
    async (parentId: string) => {
      const result = await lookupVariations(catalog, parentId);
      return result.ok ? result.items : [];
    },
    [catalog],
  );

  const searchCustomers = useCallback(
    async (query: string) => {
      const seq = ++customerSearchSeqRef.current;
      if (ports.customerSearch) {
        const results = await ports.customerSearch(query);
        if (seq !== customerSearchSeqRef.current) return;
        setCustomers(results);
        return;
      }
      const result = await customersPort.search(query);
      if (!result.ok || seq !== customerSearchSeqRef.current) {
        return;
      }
      setCustomers(result.data.map(customerViewFromSummary));
    },
    [customersPort, ports.customerSearch],
  );

  if (!ready || !initialState) {
    return <SellLoadingSkeleton />;
  }

  return (
    <div className="sell-runtime" data-sell-restore-count={restoreCount}>
      <SellScreen
        catalog={browseCatalog}
        customers={customers}
        initialState={initialState}
        catalogAvailability={availability}
        searchStatus={searchStatus}
        createCartId={createCartId}
        createLineId={createLineId}
        searchCatalog={searchCatalog}
        resolveBarcodeCatalog={resolveBarcodeCatalog}
        loadVariations={loadVariations}
        catalogProjectionGeneration={projectionGeneration}
        nextSaleCustomer={ports.nextSaleCustomer}
        onNextSaleCustomerApplied={ports.onNextSaleCustomerApplied}
        onCustomerQueryChange={searchCustomers}
        onWorkspaceChange={persist}
        onTransitionCart={transitionActiveCart}
        quote={presentedQuote.quote}
        eligibility={presentedQuote.eligibility}
        checkoutReady={cashCheckout.ready}
        checkoutInFlight={cashCheckout.inFlight}
        checkoutSession={cashCheckout.session}
        onPay={() => {
          void cashCheckout.startPrepare(
            presentedQuote.confirmedQuote,
            customerSummaryFromSelection(workspace?.selectedCustomer),
          );
        }}
        onConfirmCash={(value) => {
          void cashCheckout.confirmCash(value);
        }}
        onResolveSale={() => {
          void cashCheckout.resolveSale();
        }}
        onResolvePayment={() => {
          void cashCheckout.resolvePayment();
        }}
        onRetryFinalize={() => {
          void cashCheckout.retryFinalize();
        }}
        onRetryReceipt={() => {
          void cashCheckout.loadReceipt();
        }}
        onPrintReceipt={() => {
          const receipt = cashCheckout.session.receipt;
          if (!receipt) {
            return;
          }
          flushSync(() => {
            setPrintReceipt(receipt);
          });
          if (!receiptPaperIsMounted(document, receipt.receiptNumber)) {
            setPrintReceipt(null);
            return;
          }
          void cashCheckout.printReceipt().finally(() => {
            setPrintReceipt(null);
          });
        }}
        onCheckoutNewSale={() => {
          cashCheckout.resetForNewSale();
          const status = electronic.session.status;
          if (
            cashCheckout.session.saleCompleted ||
            status === "idle" ||
            status === "failed" ||
            status === "cancelled"
          ) {
            electronic.reset();
          }
        }}
        onDismissCheckout={cashCheckout.dismiss}
        onSelectCash={() => {
          if (electronicSessionLocksCheckout(electronic.session)) {
            return;
          }
          cashCheckout.selectCash();
        }}
        onBackToPaymentChoice={() => {
          if (electronicSessionLocksCheckout(electronic.session)) {
            return;
          }
          if (electronic.session.status === "failed" || electronic.session.status === "cancelled") {
            electronic.reset();
          }
          cashCheckout.backToPaymentChoice();
        }}
        onCancelPreparedSale={() => {
          if (electronicSessionLocksCheckout(electronic.session)) {
            void electronic.resolve();
            void cashCheckout.resolvePayment();
            return;
          }
          void cashCheckout.cancelPreparedSale();
        }}
        onSelectElectronic={(tender) => {
          if (!electronicTenderAvailable(tender, tenderAvailability)) {
            return;
          }
          if (electronicSessionLocksCheckout(electronic.session)) {
            return;
          }
          const transactionId = cashCheckout.session.transactionId;
          if (!transactionId || !electronic.ready) {
            return;
          }
          void electronic.present({ transactionId, tender });
        }}
        tenderAvailability={tenderAvailability}
        electronicSession={electronic.ready ? electronic.session : undefined}
        electronicInFlight={electronic.inFlight}
        onResolveElectronic={() => {
          void electronic.resolve();
        }}
        onContactManager={() => {
          void electronic.resolve();
        }}
      />
      {printReceipt ? (
        <div className="receipt-print-host" aria-hidden="true">
          <ReceiptPaper receipt={printReceipt} />
        </div>
      ) : null}
    </div>
  );
}
