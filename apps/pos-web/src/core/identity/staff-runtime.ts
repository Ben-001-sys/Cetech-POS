import type { ApiResult, RegisterPort } from "../../../../../docs/contracts/ports";
import type { Register, Session, Shift } from "../../../../../docs/contracts/domain.generated";
import type { StaffAuthFailureKind, StaffAuthProvider, StaffSignInRequest } from "./staff-auth-provider";
import { StaffAuthError } from "./staff-auth-provider";
import type { StaffPresentationNotice } from "./staff-presentation-notice";
import type { StaffSessionBffGateway } from "./bff-staff-session-gateway";
import type { StaffSessionContext } from "./staff-session-context";
import {
  formatOfflineVerifiedAt,
  OFFLINE_GRACE_EXPIRED_MESSAGE,
  type OfflineStaffPresentationStore,
} from "./offline-staff-presentation";
import {
  createLocalSelectedRegisterStore,
  decideSelectedRegisterId,
  type SelectedRegisterDecision,
  type SelectedRegisterStore,
} from "./selected-register-preference";

export type StaffRuntimeStatus =
  | "restoring"
  | "signed_out"
  | "expired"
  | "unauthorized"
  | "unavailable"
  | "ready";

export type StaffRuntimeAuthority = {
  readonly status: StaffRuntimeStatus;
  readonly session: Session | null;
  readonly assignedLocationIds: readonly string[];
  readonly assignedRegisterIds: readonly string[];
  readonly assignedRegisters: readonly Register[];
  readonly selectedRegisterId: string | null;
  readonly register: Register | null;
  readonly shift: Shift | null;
  readonly shiftOpen: boolean;
  readonly errorMessage?: string;
  /** Classified cashier notice. UI renders this instead of errorMessage. */
  readonly presentationNotice?: StaffPresentationNotice;
  /** Safe support reference for this sign-in attempt. Never a credential. */
  readonly supportReference?: string;
  readonly presentationOnly?: boolean;
  readonly mustChangePassword?: boolean;
  /** ISO time of the last server verification. Present only for cached offline presentation. */
  readonly lastVerifiedAt?: string;
};

export type StaffRuntimeController = {
  getState(): StaffRuntimeAuthority;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  signIn(request?: StaffSignInRequest): Promise<void>;
  signOut(): Promise<void>;
  /** Records that remote sign-out could not be confirmed. Never restores a session. */
  reportUnconfirmedRemoteSignOut(): void;
  refreshRegister(): Promise<void>;
  selectRegister(registerId: string): Promise<boolean>;
  applyShift(shift: Shift | null): void;
};

export const REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE =
  "Signed out on this device. Remote sign-out could not be confirmed.";

const idle: StaffRuntimeAuthority = {
  status: "restoring",
  session: null,
  assignedLocationIds: [],
  assignedRegisterIds: [],
  assignedRegisters: [],
  selectedRegisterId: null,
  register: null,
  shift: null,
  shiftOpen: false,
};

function shiftIsOpen(shift: Shift | null): boolean {
  return shift?.status === "open";
}

function noticeFromFailure(result: ApiResult<unknown>): StaffRuntimeStatus {
  if (!result.ok && result.error.code === "AUTH_REQUIRED") {
    return sessionEnded(result) ? "expired" : "signed_out";
  }
  if (!result.ok && result.error.code === "FORBIDDEN") {
    return "unauthorized";
  }
  return "unavailable";
}

function sessionEnded(result: ApiResult<unknown>): boolean {
  if (result.ok) return false;
  if (result.error.details?.field === "session") return true;
  const message = result.error.message.toLowerCase();
  return message.includes("expired") || message.includes("revoked");
}

function presentationNoticeForFailure(result: ApiResult<unknown>): StaffPresentationNotice | undefined {
  if (result.ok) return undefined;
  const field = result.error.details?.field;
  if (result.error.code === "INTEGRATION_UNAVAILABLE" && field === "assignments") {
    return "assignments_unavailable";
  }
  if (result.error.code === "FORBIDDEN" && field === "pos_access") {
    return "access_disabled";
  }
  if (result.error.code === "AUTH_REQUIRED") {
    return sessionEnded(result) ? "session_expired" : undefined;
  }
  if (result.error.code === "INTEGRATION_UNAVAILABLE") {
    return "provider_unavailable";
  }
  if (result.error.code === "FORBIDDEN") {
    return undefined;
  }
  return "provider_unavailable";
}

/** Cashier Reference is for support failures. Canonical POS disablement is an access decision. */
function cashierSupportReference(result: ApiResult<unknown>): string | undefined {
  if (result.ok) return undefined;
  if (result.error.code === "FORBIDDEN" && result.error.details?.field === "pos_access") {
    return undefined;
  }
  return result.correlationId;
}

function noticeForAuthFailure(kind: StaffAuthFailureKind): StaffPresentationNotice {
  switch (kind) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "credentials_required":
      return "credentials_required";
    case "access_disabled":
      return "access_disabled";
    case "offline":
      return "offline_sign_in";
    case "provider_unavailable":
      return "provider_unavailable";
  }
}

function isAuthClosed(status: StaffRuntimeStatus): boolean {
  return status === "signed_out" || status === "expired" || status === "unauthorized";
}

function authClosedAuthority(
  status: StaffRuntimeStatus,
  errorMessage: string | undefined,
): StaffRuntimeAuthority {
  return {
    ...idle,
    status,
    errorMessage,
    presentationNotice: status === "expired" || status === "signed_out" ? "session_expired" : undefined,
  };
}

function isRetryableRegisterFailure(result: ApiResult<unknown>): boolean {
  if (result.ok) {
    return false;
  }
  if (result.error.code === "AUTH_REQUIRED" || result.error.code === "FORBIDDEN") {
    return false;
  }
  if (result.error.code === "NOT_FOUND") {
    return false;
  }
  return result.error.code === "INTEGRATION_UNAVAILABLE" || result.error.retryable === true;
}

function canPreserveRegister(
  previous: StaffRuntimeAuthority,
  context: StaffSessionContext,
  selectedRegisterId: string,
): boolean {
  return (
    previous.status === "ready" &&
    previous.session?.actorId === context.session.actorId &&
    previous.session?.organizationId === context.session.organizationId &&
    previous.register?.id === selectedRegisterId &&
    previous.selectedRegisterId === selectedRegisterId &&
    context.assignedRegisterIds.includes(selectedRegisterId)
  );
}

function readyWithoutRegister(
  context: StaffSessionContext,
  assignedRegisters: readonly Register[],
  selectedRegisterId: string | null,
  errorMessage?: string,
): StaffRuntimeAuthority {
  return {
    status: "ready",
    session: context.session,
    assignedLocationIds: context.assignedLocationIds,
    assignedRegisterIds: context.assignedRegisterIds,
    assignedRegisters,
    selectedRegisterId,
    register: null,
    shift: null,
    shiftOpen: false,
    errorMessage,
  };
}

export function createStaffRuntimeController(input: {
  readonly gateway: StaffSessionBffGateway;
  readonly auth: StaffAuthProvider;
  readonly registers: RegisterPort;
  readonly selectedRegisterStore?: SelectedRegisterStore;
  readonly offlinePresentationStore?: OfflineStaffPresentationStore;
  readonly isOnline?: () => boolean;
  readonly now?: () => Date;
}): StaffRuntimeController {
  let state: StaffRuntimeAuthority = idle;
  const listeners = new Set<() => void>();
  const selectedRegisterStore = input.selectedRegisterStore ?? createLocalSelectedRegisterStore();
  const offlinePresentationStore = input.offlinePresentationStore;
  const isOnline = input.isOnline ?? (() => true);
  const now = input.now ?? (() => new Date());
  let authorityEpoch = 0;
  let inflightRestore: Promise<void> | null = null;
  let inflightRefresh: { readonly key: string; readonly epoch: number; readonly promise: Promise<void> } | null = null;

  type RefreshCapture = {
    readonly epoch: number;
    readonly actorId: string | null;
    readonly organizationId: string | null;
    readonly presentationOnly: boolean;
    readonly selectedRegisterId: string | null;
    readonly shiftId: string | null;
    readonly shiftStatus: string | null;
    readonly shiftOpen: boolean;
  };

  function refreshKey(): string {
    if (!state.session) return "session";
    const mode = state.presentationOnly ? "revalidate" : "register";
    return `${state.session.organizationId}\u001f${state.session.actorId}\u001f${mode}`;
  }

  function captureRefresh(): RefreshCapture {
    return {
      epoch: authorityEpoch,
      actorId: state.session?.actorId ?? null,
      organizationId: state.session?.organizationId ?? null,
      presentationOnly: state.presentationOnly === true,
      selectedRegisterId: state.selectedRegisterId,
      shiftId: state.shift?.id ?? null,
      shiftStatus: state.shift?.status ?? null,
      shiftOpen: state.shiftOpen,
    };
  }

  function refreshStillCurrent(captured: RefreshCapture): boolean {
    if (captured.epoch !== authorityEpoch) return false;
    if ((state.session?.actorId ?? null) !== captured.actorId) return false;
    if ((state.session?.organizationId ?? null) !== captured.organizationId) return false;
    if ((state.presentationOnly === true) !== captured.presentationOnly) return false;
    if (state.selectedRegisterId !== captured.selectedRegisterId) return false;
    if ((state.shift?.id ?? null) !== captured.shiftId) return false;
    if ((state.shift?.status ?? null) !== captured.shiftStatus) return false;
    return state.shiftOpen === captured.shiftOpen;
  }

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setState(next: StaffRuntimeAuthority): void {
    state = next;
    notify();
  }

  async function loadAssignedRegisters(ids: readonly string[]): Promise<Register[]> {
    const loaded = await Promise.all(ids.map((id) => input.registers.get(id)));
    const registers: Register[] = [];
    loaded.forEach((result, index) => {
      if (result.ok && result.data.id === ids[index]) {
        registers.push(result.data);
      }
    });
    return registers;
  }

  type RegisterPreferenceIntent =
    | { readonly kind: "keep" }
    | { readonly kind: "clear" }
    | { readonly kind: "write"; readonly registerId: string };

  type OfflinePresentationIntent = "keep" | "clear";

  type HydratedRegister = {
    readonly authority: StaffRuntimeAuthority;
    readonly preference: RegisterPreferenceIntent;
    readonly offlinePresentation: OfflinePresentationIntent;
  };

  function hydrated(
    authority: StaffRuntimeAuthority,
    preference: RegisterPreferenceIntent,
    offlinePresentation: OfflinePresentationIntent = "keep",
  ): HydratedRegister {
    return { authority, preference, offlinePresentation };
  }

  function preferenceFromDecision(decision: SelectedRegisterDecision): RegisterPreferenceIntent {
    if (decision.persist === "write" && decision.selectedRegisterId) {
      return { kind: "write", registerId: decision.selectedRegisterId };
    }
    if (decision.persist === "clear") return { kind: "clear" };
    return { kind: "keep" };
  }

  function mergePreference(
    planned: RegisterPreferenceIntent,
    fromHydration: RegisterPreferenceIntent,
  ): RegisterPreferenceIntent {
    return fromHydration.kind === "keep" ? planned : fromHydration;
  }

  function applyRegisterPreference(
    preference: RegisterPreferenceIntent,
    organizationId: string,
    actorId: string,
  ): void {
    if (preference.kind === "clear") {
      selectedRegisterStore.clear(organizationId, actorId);
      return;
    }
    if (preference.kind === "write") {
      selectedRegisterStore.write(organizationId, actorId, preference.registerId);
    }
  }

  function applyHydratedEffects(
    loaded: HydratedRegister,
    organizationId: string,
    actorId: string,
  ): void {
    if (loaded.offlinePresentation === "clear") {
      offlinePresentationStore?.clear();
    }
    applyRegisterPreference(loaded.preference, organizationId, actorId);
  }

  async function hydrateSelectedRegister(
    context: StaffSessionContext,
    previous: StaffRuntimeAuthority,
    selectedRegisterId: string,
    assignedRegisters: readonly Register[],
    mode: "restore" | "explicit_switch" = "restore",
  ): Promise<HydratedRegister> {
    const registerResult = await input.registers.get(selectedRegisterId);
    if (!registerResult.ok) {
      if (registerResult.error.code === "FORBIDDEN") {
        const message = "This register is not permitted for the current staff session. Choose another assigned register.";
        if (mode === "explicit_switch" && previous.status === "ready" && previous.session) {
          return hydrated({ ...previous, errorMessage: message, presentationNotice: "register_forbidden" }, { kind: "keep" });
        }
        return hydrated(
          { ...readyWithoutRegister(context, assignedRegisters, null, message), presentationNotice: "register_forbidden" },
          { kind: "clear" },
        );
      }
      const notice = noticeFromFailure(registerResult);
      if (isAuthClosed(notice)) {
        return hydrated(authClosedAuthority(notice, registerResult.error.message), { kind: "keep" }, "clear");
      }
      if (registerResult.error.code === "NOT_FOUND") {
        // An explicit switch to a register that was never selected must not
        // erase the current preference. Restore still asks the caller to clear
        // a stored register the server no longer has.
        if (mode === "explicit_switch" && previous.status === "ready" && previous.session) {
          return hydrated(
            { ...previous, errorMessage: registerResult.error.message },
            { kind: "keep" },
          );
        }
        return hydrated(
          readyWithoutRegister(context, assignedRegisters, null, registerResult.error.message),
          { kind: "clear" },
        );
      }
      if (isRetryableRegisterFailure(registerResult) && canPreserveRegister(previous, context, selectedRegisterId)) {
        return hydrated({
          status: "ready",
          session: context.session,
          assignedLocationIds: context.assignedLocationIds,
          assignedRegisterIds: context.assignedRegisterIds,
          assignedRegisters,
          selectedRegisterId,
          register: previous.register,
          shift: previous.shift,
          shiftOpen: previous.shiftOpen,
          errorMessage: registerResult.error.message,
        }, { kind: "keep" });
      }
      return hydrated(
        readyWithoutRegister(context, assignedRegisters, selectedRegisterId, registerResult.error.message),
        { kind: "keep" },
      );
    }
    const shiftResult = await input.registers.activeShift(selectedRegisterId);
    if (!shiftResult.ok) {
      if (shiftResult.error.code === "FORBIDDEN") {
        const message = "This register is not permitted for the current staff session. Choose another assigned register.";
        if (mode === "explicit_switch" && previous.status === "ready" && previous.session) {
          return hydrated({ ...previous, errorMessage: message, presentationNotice: "register_forbidden" }, { kind: "keep" });
        }
        return hydrated(
          { ...readyWithoutRegister(context, assignedRegisters, null, message), presentationNotice: "register_forbidden" },
          { kind: "clear" },
        );
      }
      const notice = noticeFromFailure(shiftResult);
      if (isAuthClosed(notice)) {
        return hydrated(authClosedAuthority(notice, shiftResult.error.message), { kind: "keep" }, "clear");
      }
      const sameRegister = previous.register?.id === registerResult.data.id;
      const preserveShift =
        isRetryableRegisterFailure(shiftResult) &&
        sameRegister &&
        previous.shift !== null &&
        previous.shift.registerId === selectedRegisterId &&
        previous.session?.actorId === context.session.actorId;
      return hydrated({
        status: "ready",
        session: context.session,
        assignedLocationIds: context.assignedLocationIds,
        assignedRegisterIds: context.assignedRegisterIds,
        assignedRegisters,
        selectedRegisterId,
        register: registerResult.data,
        shift: preserveShift ? previous.shift : null,
        shiftOpen: preserveShift ? previous.shiftOpen : false,
        errorMessage: shiftResult.error.message,
      }, { kind: "keep" });
    }
    const shift =
      shiftResult.data && shiftResult.data.registerId !== selectedRegisterId ? null : shiftResult.data;
    const authority: StaffRuntimeAuthority = {
      status: "ready",
      session: context.session,
      assignedLocationIds: context.assignedLocationIds,
      assignedRegisterIds: context.assignedRegisterIds,
      assignedRegisters,
      selectedRegisterId,
      register: registerResult.data,
      shift,
      shiftOpen: shiftIsOpen(shift),
    };
    return hydrated(
      authority,
      mode === "explicit_switch" ? { kind: "write", registerId: selectedRegisterId } : { kind: "keep" },
    );
  }

  async function loadRegister(
    context: StaffSessionContext,
    previous: StaffRuntimeAuthority,
  ): Promise<HydratedRegister> {
    const assignedRegisters = await loadAssignedRegisters(context.assignedRegisterIds);
    const decision = decideSelectedRegisterId({
      assignedRegisterIds: context.assignedRegisterIds,
      storedRegisterId: selectedRegisterStore.read(context.session.organizationId, context.session.actorId),
    });
    const planned = preferenceFromDecision(decision);
    if (!decision.selectedRegisterId) {
      return hydrated(readyWithoutRegister(context, assignedRegisters, null), planned);
    }
    const loaded = await hydrateSelectedRegister(
      context,
      previous,
      decision.selectedRegisterId,
      assignedRegisters,
    );
    return hydrated(
      loaded.authority,
      mergePreference(planned, loaded.preference),
      loaded.offlinePresentation,
    );
  }

  async function applyContext(result: ApiResult<StaffSessionContext>, epochAtStart: number): Promise<void> {
    if (epochAtStart !== authorityEpoch) return;
    if (!result.ok) {
      if (result.error.code === "AUTH_REQUIRED" || result.error.code === "FORBIDDEN") {
        offlinePresentationStore?.clear();
      }
      if (result.error.code === "INTEGRATION_UNAVAILABLE") {
        const evaluation = offlinePresentationStore?.evaluate(now());
        if (evaluation?.outcome === "available") {
          const cached = evaluation.authority;
          const verifiedAt = cached.lastVerifiedAt
            ? formatOfflineVerifiedAt(cached.lastVerifiedAt)
            : null;
          setState(
            isOnline()
              ? {
                  ...cached,
                  errorMessage: verifiedAt
                    ? `Connection unavailable. Offline — staff access last verified at ${verifiedAt}. Selling and register changes stay blocked until the service recovers.`
                    : "Connection unavailable. Showing the last verified cashier and register. Selling and register changes stay blocked until the service recovers.",
                }
              : cached,
          );
          return;
        }
        if (evaluation?.outcome === "grace_expired") {
          setState({
            ...idle,
            status: "expired",
            errorMessage: OFFLINE_GRACE_EXPIRED_MESSAGE,
            presentationNotice: "offline_grace_expired",
          });
          return;
        }
      }
      setState({
        ...idle,
        status: noticeFromFailure(result),
        errorMessage: result.error.message,
        presentationNotice: presentationNoticeForFailure(result),
        supportReference: cashierSupportReference(result),
      });
      return;
    }
    if (result.data.mustChangePassword === true) {
      if (epochAtStart !== authorityEpoch) return;
      setState({
        status: "ready",
        session: result.data.session,
        assignedLocationIds: result.data.assignedLocationIds,
        assignedRegisterIds: result.data.assignedRegisterIds,
        assignedRegisters: [],
        selectedRegisterId: null,
        register: null,
        shift: null,
        shiftOpen: false,
        mustChangePassword: true,
      });
      return;
    }
    const loaded = await loadRegister(result.data, state);
    if (epochAtStart !== authorityEpoch) return;
    applyHydratedEffects(
      loaded,
      result.data.session.organizationId,
      result.data.session.actorId,
    );
    setState({ ...loaded.authority, mustChangePassword: false });
    if (loaded.authority.status === "ready" && loaded.authority.session && !loaded.authority.presentationOnly) {
      offlinePresentationStore?.write(loaded.authority, now());
    }
  }

  function signedOutState(errorMessage?: string): StaffRuntimeAuthority {
    return {
      ...idle,
      status: "signed_out",
      errorMessage,
      presentationNotice:
        errorMessage === REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE ? "remote_sign_out_unconfirmed" : undefined,
    };
  }

  function retireLocalStaffAuthority(): void {
    try {
      offlinePresentationStore?.clear();
    } catch {
      // A storage failure must not leave the previous cashier on screen.
    }
    setState(signedOutState());
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async restore() {
      if (inflightRestore) return inflightRestore;
      const epochAtStart = ++authorityEpoch;
      setState({ ...idle, status: "restoring" });
      const run = (async () => {
        await applyContext(await input.gateway.readContext(), epochAtStart);
      })();
      const tracked = run.finally(() => {
        if (inflightRestore === tracked) inflightRestore = null;
      });
      inflightRestore = tracked;
      return tracked;
    },
    async signIn(request) {
      if (!isOnline()) {
        if (state.presentationOnly && state.status === "ready") {
          return;
        }
        authorityEpoch += 1;
        setState({
          ...idle,
          status: "signed_out",
          presentationNotice: "offline_sign_in",
        });
        return;
      }
      const epochAtStart = ++authorityEpoch;
      setState({ ...state, status: "restoring", errorMessage: undefined, presentationNotice: undefined, supportReference: undefined });
      try {
        const signedIn = await input.auth.signIn(request);
        const established = await input.gateway.establish({
          accessToken: signedIn.accessToken,
          correlationId: signedIn.correlationId,
        });
        await applyContext(established, epochAtStart);
      } catch (error) {
        if (epochAtStart !== authorityEpoch) return;
        const kind = error instanceof StaffAuthError ? error.kind : "provider_unavailable";
        const supportReference = error instanceof StaffAuthError ? error.correlationId : undefined;
        setState({
          ...idle,
          status: kind === "access_disabled" ? "unauthorized" : "signed_out",
          errorMessage: error instanceof Error ? error.message : "staff identity could not be verified",
          presentationNotice: noticeForAuthFailure(kind),
          supportReference,
        });
      }
    },
    async signOut() {
      authorityEpoch += 1;
      retireLocalStaffAuthority();
      let remoteFailed = false;
      try {
        await input.gateway.clear();
      } catch {
        remoteFailed = true;
      }
      try {
        await input.auth.signOut();
      } catch {
        remoteFailed = true;
      }
      if (remoteFailed) {
        setState(signedOutState(REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE));
      }
    },
    reportUnconfirmedRemoteSignOut() {
      authorityEpoch += 1;
      if (state.session || state.status === "ready" || state.presentationOnly) {
        retireLocalStaffAuthority();
      }
      setState(signedOutState(REMOTE_SIGN_OUT_UNCONFIRMED_MESSAGE));
    },
    async refreshRegister() {
      if (inflightRestore && state.status === "restoring") {
        return inflightRestore;
      }
      const key = refreshKey();
      if (inflightRefresh?.key === key && inflightRefresh.epoch === authorityEpoch) {
        return inflightRefresh.promise;
      }
      const captured = captureRefresh();
      const run = (async () => {
        // Re-read durable assignments. A grant or revocation must not wait for
        // a new browser session, and a stale refresh must not publish it.
        const result = await input.gateway.readContext();
        if (!refreshStillCurrent(captured)) return;
        await applyContext(result, captured.epoch);
      })();
      const tracked = run.finally(() => {
        if (inflightRefresh?.promise === tracked) inflightRefresh = null;
      });
      inflightRefresh = { key, epoch: captured.epoch, promise: tracked };
      return tracked;
    },
    async selectRegister(registerId) {
      if (!state.session || state.presentationOnly) {
        return false;
      }
      if (!state.assignedRegisterIds.includes(registerId)) {
        return false;
      }
      const context: StaffSessionContext = {
        session: state.session,
        assignedLocationIds: state.assignedLocationIds,
        assignedRegisterIds: state.assignedRegisterIds,
      };
      authorityEpoch += 1;
      const captured = captureRefresh();
      const loaded = await hydrateSelectedRegister(
        context,
        state,
        registerId,
        state.assignedRegisters,
        "explicit_switch",
      );
      if (!refreshStillCurrent(captured) || !state.session || !captured.organizationId || !captured.actorId) {
        return false;
      }
      applyHydratedEffects(loaded, captured.organizationId, captured.actorId);
      setState(loaded.authority);
      return loaded.authority.selectedRegisterId === registerId && loaded.authority.register?.id === registerId;
    },
    applyShift(shift) {
      if (!state.session || !state.register || state.presentationOnly) {
        return;
      }
      if (shift && shift.registerId !== state.register.id) {
        return;
      }
      const shiftOpen = shiftIsOpen(shift);
      if (state.shift?.id === shift?.id && state.shift?.status === shift?.status && state.shiftOpen === shiftOpen) {
        return;
      }
      setState({
        ...state,
        shift,
        shiftOpen,
        errorMessage: undefined,
      });
    },
  };
}
