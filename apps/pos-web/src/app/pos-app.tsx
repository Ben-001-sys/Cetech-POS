"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { SellLoadingSkeleton, SellRuntimeScreen, type SellSessionPorts } from "../features/sell";
import { createBrowserPricingPort } from "../features/sell/runtime/pricingClient";
import {
  createBrowserCashCheckoutPorts,
  createBrowserPaymentPort,
  createBrowserRegisterPort,
  createBrowserReturnPort,
  createBrowserSalesResolvePort,
} from "./checkout-client";
import {
  checkoutBlockedByLocalRecovery,
  createAttentionRecoveryLock,
  createRecoveryScanGate,
  isLocalRecoveryContextCurrent,
  loadLocalJournalAttentionItems,
  localRecoverySellBanner,
  mergeAttentionItems,
  runAttentionRecovery,
  type LocalRecoveryContext,
} from "./attention-recovery";
import { RegisterRuntimeScreen } from "./register-runtime";
import { ReturnsRuntimeScreen, createBrowserHistoricReturnSaleLookup } from "./returns-runtime";
import { StaffAuthGate } from "./staff-auth-gate";
import { PasswordChangeScreen } from "../features/auth/PasswordChangeScreen";
import { ApprovedWorkspaceScreens, clientAttentionExtras } from "./workspace-runtime";
import { AppShell, POS_ROUTE_HREFS, type PosRoute } from "../ui/shell";
import { returnSelectionHref } from "./pos-route";
import { resolveBrowserCatalogSourcePolicy } from "../core/catalog/source-policy";
import { createBurstRefresh } from "../core/identity/authority-refresh";
import {
  CATALOG_REFRESH_MIN_INTERVAL_MS,
  createCartDraftStore,
  createLocalCatalogPort,
  createLocalCustomerPort,
  createOperationJournal,
  createTenderActivityPort,
  ensureCashierLocalSeed,
  ensureCatalogProjection,
  inspectLocalCatalogProjection,
  openPosLocalDatabase,
  readCatalogSyncState,
  recallActiveCartId,
  rememberActiveCartId,
  replaceActiveCartDraft,
} from "../local";
import type { CatalogProjectionAvailability, CatalogProjectionSyncResult } from "../local/catalog-sync";
import { catalogProjectionSyncApplied } from "../local/catalog-sync";
import {
  checkoutScopeFromStaffAuthority,
  createBffStaffSessionGateway,
  createPublicSupabaseStaffAuthProvider,
  createLocalOfflineStaffPresentationStore,
  offlinePresentationBanner,
  OFFLINE_GRACE_EXPIRED_MESSAGE,
  createStaffIdentityPort,
  createStaffRuntimeController,
  lockStaffSession,
  readOrCreateLocalDeviceId,
  REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE,
  type StaffRuntimeAuthority,
  type StaffRuntimeController,
} from "../core/identity";
import type { AuthNoticeState } from "../features/auth";
import { staffPresentationCopy } from "../core/identity/staff-presentation-notice";
import { toCashierError } from "../ui/cashier-language";
import type { OperationJournal } from "../../../../docs/contracts/ports";
import type { Shift } from "../../../../docs/contracts/domain.generated";
import type { CustomerSummary } from "../../../../docs/contracts/domain.generated";
import type { CustomerSearchResultView } from "../features/sell";
import type { AppToastView } from "../ui/toast";
import type { AttentionItemView, OperationalLoadState } from "../ui/operational";
import { applyAppearance, readStoredAppearance, type AppearancePreference } from "../features/settings/appearance";
import { loadCustomerSearchPresentation } from "../features/customers/loadCustomerSearch";
import { customerViewFromSummary } from "../features/sell/runtime/mapCartDraft";
import { fetchAttentionInbox, fetchCustomerDirectory, fetchPaymentMethodCapabilities } from "./operational-client";
import { STAFF_CSRF_COOKIE, STAFF_CSRF_HEADER } from "../config/auth";
import { fetchManagementContext } from "./management-client";

function bumpCatalogProjectionGeneration(
  generationRef: { current: number },
  result: CatalogProjectionSyncResult | "applied",
): number {
  if (result === "applied" || catalogProjectionSyncApplied(result)) {
    generationRef.current += 1;
  }
  return generationRef.current;
}

function authNoticeFor(authority: StaffRuntimeAuthority): AuthNoticeState {
  switch (authority.presentationNotice) {
    case "invalid_credentials":
    case "credentials_required":
    case "access_disabled":
    case "assignments_unavailable":
    case "provider_unavailable":
    case "offline_sign_in":
      return authority.presentationNotice;
    case "session_expired":
      return "expired";
    case "offline_grace_expired":
      return "offline_expired";
    case "remote_sign_out_unconfirmed":
      return "remote_sign_out_unconfirmed";
    default:
      break;
  }
  if (authority.errorMessage === OFFLINE_GRACE_EXPIRED_MESSAGE) return "offline_expired";
  if (authority.errorMessage === REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE) return "remote_sign_out_unconfirmed";
  if (authority.status === "expired") return "expired";
  if (authority.status === "unauthorized") return "unauthorized";
  if (authority.status === "restoring") return "loading";
  return "signed_out";
}

export function hasFreshStaffActionAuthority(authority: StaffRuntimeAuthority): boolean {
  return authority.status === "ready" && Boolean(authority.session) && !authority.presentationOnly;
}

export function PosApp({
  route,
  fetchImpl,
  initialReturnSaleId,
}: {
  readonly route: PosRoute;
  readonly fetchImpl?: typeof fetch;
  readonly initialReturnSaleId?: string | null;
}) {
  const router = useRouter();
  return (
    <PosRuntime
      route={route}
      fetchImpl={fetchImpl}
      initialReturnSaleId={initialReturnSaleId}
      onNavigate={(next) => router.push(POS_ROUTE_HREFS[next])}
      onOpenManagement={() => router.push("/management")}
      onReturnSaleSelected={(saleId) => router.push(returnSelectionHref(saleId))}
    />
  );
}

export function PosRuntime({
  route,
  fetchImpl,
  onNavigate,
  onOpenManagement,
  initialReturnSaleId,
  onReturnSaleSelected,
}: {
  readonly route: PosRoute;
  readonly fetchImpl?: typeof fetch;
  readonly onNavigate: (route: PosRoute) => void;
  readonly onOpenManagement?: () => void;
  readonly initialReturnSaleId?: string | null;
  readonly onReturnSaleSelected?: (saleId: string) => void;
}) {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [ports, setPorts] = useState<SellSessionPorts | null>(null);
  const [passwordChangeBusy, setPasswordChangeBusy] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState<string | undefined>();
  const [projectionAvailability, setProjectionAvailability] = useState<CatalogProjectionAvailability | null>(null);
  const refreshInFlight = useRef(false);
  const catalogProjectionGenerationRef = useRef(0);
  const [authority, setAuthority] = useState<StaffRuntimeAuthority>(() => ({
    status: "restoring",
    session: null,
    assignedLocationIds: [],
    assignedRegisterIds: [],
    assignedRegisters: [],
    selectedRegisterId: null,
    register: null,
    shift: null,
    shiftOpen: false,
  }));
  const restoreCountRef = useRef(0);
  const catalogBootstrapCountRef = useRef(0);
  const ownerNodeRef = useRef<HTMLDivElement | null>(null);
  const [appearance, setAppearance] = useState<AppearancePreference>("system");
  const [toast, setToast] = useState<AppToastView | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [serverAttention, setServerAttention] = useState<readonly AttentionItemView[]>([]);
  const [localAttention, setLocalAttention] = useState<readonly AttentionItemView[]>([]);
  const [scannedRecoveryContext, setScannedRecoveryContext] = useState<LocalRecoveryContext | null>(null);
  const recoveryScanGate = useRef(createRecoveryScanGate());
  const [attentionState, setAttentionState] = useState<OperationalLoadState>("loading");
  const [nextSaleCustomer, setNextSaleCustomer] = useState<CustomerSearchResultView | null>(null);
  const [pendingReturnSaleId, setPendingReturnSaleId] = useState<string | null>(
    initialReturnSaleId ?? null,
  );
  const [managementActorId, setManagementActorId] = useState<string | null>(null);
  const readOnline = useCallback(() => online, [online]);

  const policy = useMemo(
    () =>
      resolveBrowserCatalogSourcePolicy({
        hostname: typeof window === "undefined" ? "localhost" : window.location.hostname,
        nodeEnv: process.env.NODE_ENV,
      }),
    [],
  );

  const recoveryJournal = useMemo<OperationJournal>(() => {
    const currentJournal = () => createOperationJournal(openPosLocalDatabase());
    return {
      appendBeforeSend: (...args) => currentJournal().appendBeforeSend(...args),
      pending: () => currentJournal().pending(),
      markSent: (...args) => currentJournal().markSent(...args),
      markResponseUnknown: (...args) => currentJournal().markResponseUnknown(...args),
      markAcknowledged: (...args) => currentJournal().markAcknowledged(...args),
      markRequiresAttention: (...args) => currentJournal().markRequiresAttention(...args),
    };
  }, []);
  const recoveryTenderActivity = useMemo(() => {
    const currentTenderActivity = () => createTenderActivityPort(openPosLocalDatabase());
    return {
      markActive: (transactionId: string) => currentTenderActivity().markActive(transactionId),
      clear: (transactionId: string) => currentTenderActivity().clear(transactionId),
    };
  }, []);
  const registerPort = useMemo(() => createBrowserRegisterPort({ fetchImpl }), [fetchImpl]);
  const paymentPort = useMemo(
    () =>
      createBrowserPaymentPort({
        fetchImpl,
        journal: recoveryJournal,
        tenderActivity: recoveryTenderActivity,
      }),
    [fetchImpl, recoveryJournal, recoveryTenderActivity],
  );
  const salesPort = useMemo(
    () =>
      createBrowserSalesResolvePort({
        fetchImpl,
        journal: recoveryJournal,
        tenderActivity: recoveryTenderActivity,
      }),
    [fetchImpl, recoveryJournal, recoveryTenderActivity],
  );
  const attentionRecoveryLock = useRef(createAttentionRecoveryLock());
  const [recoveringItemId, setRecoveringItemId] = useState<string | null>(null);
  const runtime = useMemo<StaffRuntimeController>(
    () =>
      createStaffRuntimeController({
        gateway: createBffStaffSessionGateway({ fetchImpl }),
        auth: createPublicSupabaseStaffAuthProvider({ fetchImpl }),
        registers: registerPort,
        offlinePresentationStore: createLocalOfflineStaffPresentationStore(),
        isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
      }),
    [fetchImpl, registerPort],
  );

  useEffect(() => {
    return runtime.subscribe(() => {
      setAuthority(runtime.getState());
    });
  }, [runtime]);

  useEffect(() => {
    restoreCountRef.current += 1;
    writeOwnerCounts(ownerNodeRef.current, restoreCountRef.current, catalogBootstrapCountRef.current);
    void runtime.restore();
  }, [runtime]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readStoredAppearance();
      setAppearance(stored);
      applyAppearance(stored);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const showToast = useCallback((next: AppToastView) => {
    setToast(next);
    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => {
      setToast(null);
    }, 4500);
  }, []);

  const recoveryDeviceId = authority.shift?.deviceId || (typeof window === "undefined" ? "" : readOrCreateLocalDeviceId());
  const currentRecoveryContext = useMemo<LocalRecoveryContext>(() => ({
    organizationId: authority.session?.organizationId ?? "",
    actorId: authority.session?.actorId ?? "",
    registerId: authority.selectedRegisterId ?? "",
    deviceId: recoveryDeviceId,
  }), [
    authority.selectedRegisterId,
    authority.session?.actorId,
    authority.session?.organizationId,
    recoveryDeviceId,
  ]);

  const loadAttention = useCallback(async (mode: "full" | "refresh" = "full") => {
    if (mode === "full") {
      setAttentionState("loading");
    }
    const scannedContext = currentRecoveryContext;
    const token = recoveryScanGate.current.start();
    const [result, localResult] = await Promise.all([
      fetchAttentionInbox(fetchImpl),
      loadLocalJournalAttentionItems(recoveryJournal, {
        actorId: scannedContext.actorId,
        registerId: scannedContext.registerId || null,
        organizationId: scannedContext.organizationId,
      }, openPosLocalDatabase())
        .then((items) => ({ ok: true as const, items }))
        .catch(() => ({ ok: false as const, items: [] as readonly AttentionItemView[] })),
    ]);
    if (!recoveryScanGate.current.isCurrent(token)) {
      return;
    }

    if (localResult.ok) {
      setLocalAttention(localResult.items);
      setScannedRecoveryContext(scannedContext);
    } else {
      setLocalAttention([]);
      setScannedRecoveryContext(null);
    }

    if (!result.ok) {
      setServerAttention([]);
      setAttentionState(localResult.ok ? "degraded" : "error");
      return;
    }
    setServerAttention(result.data.items);
    setAttentionState(localResult.ok ? "ready" : "degraded");
  }, [currentRecoveryContext, fetchImpl, recoveryJournal]);

  useEffect(() => {
    if (authority.status !== "ready" || !authority.session) {
      return;
    }
    const timer = window.setTimeout(() => {
      void loadAttention();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authority.session, authority.status, fetchImpl, loadAttention]);

  useEffect(() => {
    if (authority.status !== "ready" || !authority.session || authority.presentationOnly) {
      return;
    }
    const actorId = authority.session.actorId;
    let cancelled = false;
    void fetchManagementContext(fetchImpl ?? fetch).then((result) => {
      if (!cancelled) {
        setManagementActorId(result.ok ? actorId : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [authority.presentationOnly, authority.session, authority.status, fetchImpl]);

  useEffect(() => {
    const burst = createBurstRefresh(async () => {
      await runtime.refreshRegister();
      await loadAttention("refresh");
    });
    function sync() {
      setOnline(navigator.onLine);
      if (navigator.onLine) {
        burst.schedule();
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") {
        burst.schedule();
      }
    }
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      burst.cancel();
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadAttention, runtime]);

  const pricing = useMemo(() => createBrowserPricingPort({ fetchImpl }), [fetchImpl]);

  const mountPorts = useCallback(
    async (
      availability: CatalogProjectionAvailability,
      current: StaffRuntimeAuthority,
      catalogProjectionGeneration: number,
    ) => {
      const db = openPosLocalDatabase();
      const customers = createLocalCustomerPort({ db });
      const locationId = current.register?.locationId ?? current.assignedLocationIds[0];
      if (!locationId) {
        setProjectionAvailability(availability);
        setPorts(null);
        return;
      }
      const scope = checkoutScopeFromStaffAuthority(current);
      const checkout =
        scope && !current.presentationOnly
          ? createBrowserCashCheckoutPorts({
              fetchImpl,
              scope,
              journal: createOperationJournal(db, {
                createdByActorId: current.session?.actorId,
                organizationId: current.session?.organizationId,
                locationId: current.register?.locationId ?? current.assignedLocationIds[0],
                registerId: scope.registerId,
                deviceId: scope.deviceId,
              }),
              tenderActivity: createTenderActivityPort(db),
            })
          : null;
      const capabilities = await fetchPaymentMethodCapabilities(fetchImpl);
      setProjectionAvailability(availability);
      setPorts({
        catalog: createLocalCatalogPort({ db }),
        customers,
        customerSearch: async (query) => {
          const result = await loadCustomerSearchPresentation({
            query,
            remoteSearch: (needle) => fetchCustomerDirectory(needle, fetchImpl),
            localSearch: (needle) => customers.search(needle),
          });
          return result.ok ? result.customers.map(customerViewFromSummary) : [];
        },
        drafts: createCartDraftStore(db),
        rememberCartId: (cartId) => rememberActiveCartId(cartId, db),
        recallCartId: () => recallActiveCartId(db),
        replaceActiveCart: (previousCartId, next) => replaceActiveCartDraft(previousCartId, next, db),
        locationId,
        pricing: current.presentationOnly ? undefined : pricing,
        shiftOpen: current.presentationOnly ? false : current.shiftOpen,
        checkout: checkout?.checkout,
        payments: checkout?.payments,
        sales: checkout?.sales,
        receipts: checkout?.receipts,
        printer: checkout?.printer,
        checkoutScope: checkout?.scope,
        catalogAvailability: availability,
        catalogProjectionGeneration,
        ...(capabilities.ok ? { paymentMethods: capabilities.data } : {}),
      });
    },
    [fetchImpl, pricing],
  );

  useEffect(() => {
    if (authority.status !== "ready" || !authority.session) {
      return;
    }
    let cancelled = false;
    const snapshot = authority;
    catalogBootstrapCountRef.current += 1;
    writeOwnerCounts(ownerNodeRef.current, restoreCountRef.current, catalogBootstrapCountRef.current);
    void (async () => {
      if (snapshot.presentationOnly) {
        await mountPorts("stale", snapshot, catalogProjectionGenerationRef.current);
        return;
      }
      try {
        const db = openPosLocalDatabase();
        const [local, localState] = await Promise.all([
          inspectLocalCatalogProjection(db),
          readCatalogSyncState(db),
        ]);
        const hasUsableSavedCatalog = local.usableFor(policy);

        if (hasUsableSavedCatalog) {
          const savedAvailability =
            localState?.availability === "unavailable"
              ? "stale"
              : localState?.availability ?? "stale";
          await mountPorts(
            savedAvailability,
            snapshot,
            catalogProjectionGenerationRef.current,
          );
          if (cancelled) {
            return;
          }

          const synced = await ensureCatalogProjection({
            db,
            policy,
            fetchImpl,
            force: false,
            minRefreshIntervalMs: CATALOG_REFRESH_MIN_INTERVAL_MS,
          });
          if (cancelled) {
            return;
          }
          const generation = bumpCatalogProjectionGeneration(catalogProjectionGenerationRef, synced);
          setProjectionAvailability(synced.availability);
          setPorts((current) =>
            current
              ? {
                  ...current,
                  catalog: createLocalCatalogPort({ db }),
                  catalogAvailability: synced.availability,
                  catalogProjectionGeneration: generation,
                }
              : current,
          );
          return;
        }

        const synced = await ensureCatalogProjection({
          db,
          policy,
          fetchImpl,
          force: true,
        });
        if (cancelled) {
          return;
        }
        const generation = bumpCatalogProjectionGeneration(catalogProjectionGenerationRef, synced);
        await mountPorts(synced.availability, snapshot, generation);
      } catch {
        if (cancelled) {
          return;
        }
        if (policy === "synthetic_permitted") {
          await ensureCashierLocalSeed();
          const generation = bumpCatalogProjectionGeneration(catalogProjectionGenerationRef, "applied");
          await mountPorts("fresh", snapshot, generation);
          return;
        }
        await mountPorts("unavailable", snapshot, catalogProjectionGenerationRef.current);
      }
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- listed authority fields are the catalog snapshot
  }, [
    authority.status,
    authority.session,
    authority.register,
    authority.shift,
    authority.shiftOpen,
    authority.assignedLocationIds,
    fetchImpl,
    mountPorts,
    policy,
  ]);

  useEffect(() => {
    if (authority.status !== "ready" || !authority.session || authority.presentationOnly) {
      return;
    }
    async function refresh(force: boolean) {
      if (refreshInFlight.current) {
        return;
      }
      refreshInFlight.current = true;
      try {
        const synced = await ensureCatalogProjection({
          policy,
          fetchImpl,
          force,
          minRefreshIntervalMs: CATALOG_REFRESH_MIN_INTERVAL_MS,
        });
        const generation = bumpCatalogProjectionGeneration(catalogProjectionGenerationRef, synced);
        setProjectionAvailability(synced.availability);
        setPorts((current) =>
          current
            ? {
                ...current,
                catalogAvailability: synced.availability,
                catalogProjectionGeneration: generation,
              }
            : current,
        );
      } finally {
        refreshInFlight.current = false;
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") {
        void refresh(false);
      }
    }
    function onOnline() {
      void refresh(false);
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [authority.presentationOnly, authority.session, authority.status, fetchImpl, policy]);

  const returns = useMemo(() => createBrowserReturnPort({ fetchImpl }), [fetchImpl]);
  const lookup = useMemo(() => createBrowserHistoricReturnSaleLookup({ fetchImpl }), [fetchImpl]);
  const identity = useMemo(
    () =>
      createStaffIdentityPort({
        gateway: createBffStaffSessionGateway({ fetchImpl }),
        correlationId: () => crypto.randomUUID(),
        localWork: { drafts: [], journal: [] },
      }),
    [fetchImpl],
  );

  const onCatalogProjectionChange = useCallback((result: CatalogProjectionSyncResult) => {
    const generation = bumpCatalogProjectionGeneration(catalogProjectionGenerationRef, result);
    setProjectionAvailability(result.availability);
    setPorts((current) => {
      if (!current) {
        return current;
      }
      return {
        ...current,
        catalog: createLocalCatalogPort({ db: openPosLocalDatabase() }),
        catalogAvailability: result.availability,
        catalogProjectionGeneration: generation,
      };
    });
  }, []);

  const onShiftChange = useCallback(
    (shift: Shift | null) => {
      runtime.applyShift(shift);
    },
    [runtime],
  );

  const cashierAuthorityError = authority.presentationNotice
    ? staffPresentationCopy(authority.presentationNotice)
    : authority.errorMessage
      ? toCashierError({
          domain: authority.status === "ready" ? "register" : "auth",
        }).message
      : undefined;

  const authNotice: AuthNoticeState = authNoticeFor(authority);

  if (authority.status !== "ready" || !authority.session) {
    return (
      <PosRuntimeOwner
        ownerRef={ownerNodeRef}
        restoreCountRef={restoreCountRef}
        catalogBootstrapCountRef={catalogBootstrapCountRef}
        status={authority.status}
      >
        <StaffAuthGate
          noticeState={authNotice}
          busy={authority.status === "restoring"}
          errorMessage={undefined}
          supportReference={authority.supportReference}
          onSignIn={(request) => {
            void runtime.signIn(request);
          }}
        />
      </PosRuntimeOwner>
    );
  }

  if (authority.mustChangePassword) {
    return (
      <PosRuntimeOwner
        ownerRef={ownerNodeRef}
        restoreCountRef={restoreCountRef}
        catalogBootstrapCountRef={catalogBootstrapCountRef}
        status={authority.status}
      >
        <PasswordChangeScreen
          busy={passwordChangeBusy}
          errorMessage={passwordChangeError}
          onSignOut={() => {
            void runtime.signOut();
          }}
          onSubmit={(password) => {
            setPasswordChangeBusy(true);
            setPasswordChangeError(undefined);
            void changeRequiredPassword(password, fetchImpl ?? fetch).then(async (result) => {
              setPasswordChangeBusy(false);
              if (!result.ok) {
                setPasswordChangeError("The new password could not be saved. Try again.");
                return;
              }
              await runtime.signOut();
            });
          }}
        />
      </PosRuntimeOwner>
    );
  }

  const authoritativeActionsAllowed = hasFreshStaffActionAuthority(authority);
  const managementAvailable =
    authoritativeActionsAllowed &&
    managementActorId === authority.session.actorId;
  const extras = clientAttentionExtras({ catalogAvailability: projectionAvailability, authority });
  const localRecoveryChecked = isLocalRecoveryContextCurrent(scannedRecoveryContext, currentRecoveryContext);
  const effectiveLocalAttention = localRecoveryChecked ? localAttention : [];
  const attentionItems = mergeAttentionItems(serverAttention, effectiveLocalAttention, extras);
  const localTransactionRecoveryBlocked = checkoutBlockedByLocalRecovery({
    scanned: scannedRecoveryContext,
    current: currentRecoveryContext,
    items: localAttention,
  });
  const recoveryBanner = localRecoverySellBanner(localRecoveryChecked, effectiveLocalAttention);
  const attentionCount = attentionItems.length;
  const noOperationalLocation =
    !authority.presentationOnly &&
    !authority.register?.locationId &&
    authority.assignedLocationIds.length === 0;
  const sellPorts =
    ports && localTransactionRecoveryBlocked
      ? { ...ports, checkout: undefined, payments: undefined, sales: undefined }
      : ports;
  const offlineBanner = authority.presentationOnly
    ? offlinePresentationBanner({ online, lastVerifiedAt: authority.lastVerifiedAt })
    : null;

  return (
    <PosRuntimeOwner
      ownerRef={ownerNodeRef}
      restoreCountRef={restoreCountRef}
      catalogBootstrapCountRef={catalogBootstrapCountRef}
      status={authority.status}
    >
    <AppShell
      activeRoute={route}
      registerName={authority.register?.name ?? "No register"}
      cashierDisplayName={authority.session.displayName}
      shiftOpen={authority.presentationOnly ? false : authority.shiftOpen}
      online={online}
      liveMessage={cashierAuthorityError}
      attentionCount={attentionCount}
      toast={toast}
      onNavigate={onNavigate}
      onOpenManagement={managementAvailable ? onOpenManagement : undefined}
      onLock={() => {
        void lockStaffSession({ identity, runtime });
      }}
    >
      {offlineBanner ? (
        <div className="banner warning" role="status" data-offline-presentation-only="true">
          <strong>{offlineBanner.title}</strong>
          <span>{offlineBanner.detail}</span>
        </div>
      ) : cashierAuthorityError ? (
        <p className="banner danger" role="status" data-register-authority-degraded="">
          {cashierAuthorityError} Last known register and shift stay visible until we get an updated result.
        </p>
      ) : null}
      {route === "sell" ? (
        noOperationalLocation ? (
          <section className="card card-pad" data-no-operational-location="true">
            <h1>Sell</h1>
            <p className="banner warning">
              No store location is assigned to this staff account. Ask a manager to assign a location and register.
            </p>
          </section>
        ) : sellPorts ? (
          <>
            {projectionAvailability === "unavailable" ? (
              <p className="muted" role="status">
                {"Products couldn't be loaded. Check the connection and try again."}
              </p>
            ) : null}
            {localTransactionRecoveryBlocked ? (
              <div className="banner warning" role="alert" data-local-recovery-blocked="true">
                <strong>{recoveryBanner?.title}</strong>
                <span>{recoveryBanner?.detail}</span>
                {localRecoveryChecked ? (
                  <button className="btn small" type="button" onClick={() => onNavigate("attention")}>
                    View issues
                  </button>
                ) : null}
              </div>
            ) : null}
            <SellRuntimeScreen
              {...sellPorts}
              shiftOpen={authoritativeActionsAllowed ? authority.shiftOpen : false}
              online={readOnline}
              catalogAvailability={sellPorts.catalogAvailability}
              nextSaleCustomer={nextSaleCustomer}
              onNextSaleCustomerApplied={() => setNextSaleCustomer(null)}
            />
          </>
        ) : (
          <SellLoadingSkeleton />
        )
      ) : route === "returns" ? (
        authoritativeActionsAllowed ? (
          <ReturnsRuntimeScreen
            returns={returns}
            lookup={lookup}
            initialSaleId={initialReturnSaleId ?? pendingReturnSaleId}
            onSaleSelected={(saleId) => {
              setPendingReturnSaleId(saleId);
              onReturnSaleSelected?.(saleId);
            }}
          />
        ) : (
          <section className="card card-pad" data-presentation-only-returns="true">
            <h1>Returns</h1>
            <p className="banner warning">
              Reconnect and restore the staff session before reviewing or completing a return.
            </p>
          </section>
        )
      ) : route === "register" ? (
        !authoritativeActionsAllowed ? (
          <section className="card card-pad">
            <h1>Register</h1>
            <p className="banner warning">Reconnect before opening, closing, or changing a register.</p>
          </section>
        ) : authority.assignedRegisterIds.length > 0 ? (
          <RegisterRuntimeScreen
            register={registerPort}
            registerId={authority.selectedRegisterId}
            registerChoices={authority.assignedRegisterIds.map((id) => {
              const record = authority.assignedRegisters.find((item) => item.id === id);
              return {
                id,
                name: record?.name ?? id,
                locationLabel: undefined,
              };
            })}
            registerName={authority.register?.name ?? authority.selectedRegisterId ?? "Register"}
            locationLabel={undefined}
            registerStatus={authority.register?.status ?? "disabled"}
            currency={authority.register?.currency ?? "GHS"}
            onSelectRegister={(id) => {
              void runtime.selectRegister(id);
            }}
            onShiftChange={onShiftChange}
            onOpened={() => {
              showToast({ title: "Register opened." });
              onNavigate("sell");
            }}
          />
        ) : (
          <section>
            <h1>Register</h1>
            <p className="muted">No register is assigned to this staff session.</p>
          </section>
        )
      ) : (
        <ApprovedWorkspaceScreens
          route={route}
          authority={authority}
          customers={ports?.customers ?? createLocalCustomerPort()}
          online={online}
          catalogAvailability={projectionAvailability}
          fetchImpl={fetchImpl}
          appearance={appearance}
          attentionItems={attentionItems}
          attentionCount={attentionCount}
          attentionState={attentionState}
          onNavigate={onNavigate}
          onCatalogProjectionChange={onCatalogProjectionChange}
          onUseCustomer={(customer: CustomerSummary) => {
            setNextSaleCustomer(customerViewFromSummary(customer));
            showToast({ title: "Customer selected for next sale." });
            onNavigate("sell");
          }}
          onAppearanceChange={(next) => {
            setAppearance(next);
            applyAppearance(next);
          }}
          onRebuildSuccess={() => {
            showToast({
              title: "Products refreshed.",
              detail: "Your current sale was kept.",
            });
          }}
          onRetryAttention={() => {
            void loadAttention();
          }}
          selectedCustomerId={nextSaleCustomer?.id}
          receipts={ports?.receipts}
          printer={ports?.printer}
          onStartReturn={
            authoritativeActionsAllowed
              ? (saleId) => {
                  setPendingReturnSaleId(saleId);
                  if (onReturnSaleSelected) {
                    onReturnSaleSelected(saleId);
                  } else {
                    onNavigate("returns");
                  }
                }
              : undefined
          }
          recoveringItemId={recoveringItemId}
          onResolveAttention={
            authoritativeActionsAllowed
              ? (item: AttentionItemView) => {
                  if (item.recoverKind === "register" || item.recoverKind === "shift") {
                    onNavigate("register");
                    return;
                  }
                  if (item.recoverKind === "catalog") {
                    onNavigate("health");
                    return;
                  }
                  void runAttentionRecovery({
                    item,
                    lock: attentionRecoveryLock.current,
                    ports: { payments: paymentPort, sales: salesPort },
                    reload: () => loadAttention("refresh"),
                    onStart: (id) => setRecoveringItemId(id),
                    onFinish: (id) => setRecoveringItemId((current) => (current === id ? null : current)),
                  });
                }
              : undefined
          }
        />
      )}
    </AppShell>
    </PosRuntimeOwner>
  );
}

function writeOwnerCounts(
  node: HTMLDivElement | null,
  restoreCount: number,
  catalogBootstrapCount: number,
): void {
  if (!node) {
    return;
  }
  node.dataset.staffRestoreCount = String(restoreCount);
  node.dataset.catalogBootstrapCount = String(catalogBootstrapCount);
}

function PosRuntimeOwner({
  ownerRef,
  restoreCountRef,
  catalogBootstrapCountRef,
  status,
  children,
}: {
  readonly ownerRef: { current: HTMLDivElement | null };
  readonly restoreCountRef: { current: number };
  readonly catalogBootstrapCountRef: { current: number };
  readonly status: StaffRuntimeAuthority["status"];
  readonly children: ReactNode;
}) {
  return (
    <div
      ref={(node) => {
        ownerRef.current = node;
        writeOwnerCounts(node, restoreCountRef.current, catalogBootstrapCountRef.current);
      }}
      data-pos-runtime-owner="true"
      data-staff-runtime-status={status}
    >
      {children}
    </div>
  );
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return decodeURIComponent(trimmed.slice(name.length + 1));
  }
  return "";
}

async function changeRequiredPassword(
  password: string,
  fetchImpl: typeof fetch,
): Promise<{ readonly ok: boolean }> {
  try {
    const response = await fetchImpl("/api/pos/v1/session/password", {
      method: "POST",
      credentials: "include",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-correlation-id": crypto.randomUUID(),
        [STAFF_CSRF_HEADER]: readCookie(STAFF_CSRF_COOKIE),
      },
      body: JSON.stringify({ password }),
    });
    const body = await response.json() as { ok?: boolean };
    return { ok: body.ok === true };
  } catch {
    return { ok: false };
  }
}
