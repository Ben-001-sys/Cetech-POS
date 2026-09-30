import type {
  ApiFailure,
  CommandContext,
  IndependentEffectSummary,
  ReturnExecuteRequest,
  ReturnLineRequest,
  ReturnPreview,
  ReturnResolution,
  SettledIndependentEffectSummary,
} from "../../../../../docs/contracts/domain.generated";
import type { ApiResult, ReturnPort } from "../../../../../docs/contracts/ports";
import { parseQuantityInput } from "../sell/state/quantity";
import { cashierErrorMessage } from "../../ui/cashier-language";
import type { ExistingReturnLineView, HistoricReturnSaleWithExisting } from "./existingReturn";
import {
  idleReturnSession,
  OUTSTANDING_RETURN_COPY,
  presentsAutomaticSellableRestock,
  returnIdentityLocked,
  type IndependentEffectView,
  type ReturnLineDraftView,
  type ReturnPreviewLineView,
  type ReturnSessionView,
  type ReturnStageView,
} from "./returnView";

export type ReturnApprovalBindingView = {
  readonly approvalId: string;
  readonly returnId: string;
  readonly fingerprint: string;
};

export type ReturnControllerPorts = {
  readonly returns: ReturnPort;
  readonly createUuid?: () => string;
};

type UnknownOutcome = { readonly kind: "unknown"; readonly message: string };
type KnownOutcome<T> = { readonly kind: "result"; readonly value: ApiResult<T> };
type Settled<T> = UnknownOutcome | KnownOutcome<T>;

function defaultUuid(): string {
  return crypto.randomUUID();
}

async function settle<T>(run: () => Promise<ApiResult<T>>): Promise<Settled<T>> {
  try {
    return { kind: "result", value: await run() };
  } catch (error) {
    return {
      kind: "unknown",
      message: cashierErrorMessage(
        { message: error instanceof Error ? error.message : undefined },
        "returns",
      ),
    };
  }
}

function keepThisReturn(message: string, outstanding = false): string {
  const suffix = outstanding
    ? `Keep this return. ${OUTSTANDING_RETURN_COPY}`
    : "Keep this return. Do not start another return.";
  return message.includes("Keep this return") ? message : `${message} ${suffix}`;
}

function shouldResolveFailure(failure: ApiFailure): boolean {
  return failure.error.nextAction === "resolve";
}

function mapEffect(effect: IndependentEffectSummary | SettledIndependentEffectSummary): IndependentEffectView {
  return {
    effectId: effect.effectId,
    status: effect.status,
  };
}

function mapPreviewLines(preview: ReturnPreview): readonly ReturnPreviewLineView[] {
  return preview.lines.map((line) => ({
    orderLineId: line.orderLineId,
    requestedQuantity: line.requestedQuantity,
    remainingReturnableQuantity: line.remainingReturnableQuantity,
    condition: line.condition,
    intendedDisposition: line.intendedDisposition,
    dispositionPolicy: line.dispositionPolicy,
    automaticSellableRestock: presentsAutomaticSellableRestock(
      line.condition,
      line.intendedDisposition,
      line.dispositionPolicy,
    ),
  }));
}

function collectRefundIdentities(resolution: ReturnResolution, previous: readonly string[]): readonly string[] {
  const next = [...previous];
  for (const effect of [resolution.providerRefund, resolution.cashRefund]) {
    if (effect.effectId && !next.includes(effect.effectId)) {
      next.push(effect.effectId);
    }
  }
  return next;
}

function stageFromResolution(status: ReturnResolution["status"]): ReturnStageView {
  if (status === "completed") return "completed";
  if (status === "approval_required") return "approval_required";
  if (status === "refund_pending") return "refund_pending";
  if (status === "requires_attention") return "requires_attention";
  if (status === "previewed") return "previewed";
  return "in_progress";
}

function draftsFromSale(sale: HistoricReturnSaleWithExisting): readonly ReturnLineDraftView[] {
  return sale.lines.map((line) => ({
    orderLineId: line.orderLineId,
    name: line.name,
    originalSoldQuantity: line.originalSoldQuantity,
    quantity: "",
    reason: "",
    condition: "resellable",
  }));
}

function draftsFromExisting(lines: readonly ExistingReturnLineView[]): readonly ReturnLineDraftView[] {
  return lines.map((line) => ({
    orderLineId: line.orderLineId,
    name: line.name,
    originalSoldQuantity: line.originalSoldQuantity,
    quantity: line.quantity,
    reason: line.reason,
    condition: line.condition,
  }));
}

function previewLinesFromExisting(lines: readonly ExistingReturnLineView[]): readonly ReturnPreviewLineView[] {
  return lines.map((line) => ({
    orderLineId: line.orderLineId,
    requestedQuantity: line.quantity,
    remainingReturnableQuantity: line.remainingReturnableQuantity,
    condition: line.condition,
    intendedDisposition: line.intendedDisposition,
    dispositionPolicy: line.dispositionPolicy,
    automaticSellableRestock: presentsAutomaticSellableRestock(
      line.condition,
      line.intendedDisposition,
      line.dispositionPolicy,
    ),
  }));
}

export function createReturnController(ports: ReturnControllerPorts) {
  const createUuid = ports.createUuid ?? defaultUuid;
  let session: ReturnSessionView = idleReturnSession();
  let commandLock = false;
  let executeContext: CommandContext | null = null;
  let executeBinding: { returnId: string; fingerprint: string; approvalId?: string } | null = null;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function setSession(next: ReturnSessionView): void {
    session = { ...next, identityLocked: returnIdentityLocked(next) };
    notify();
  }

  function commandContext(): CommandContext {
    return { idempotencyKey: createUuid(), correlationId: createUuid() };
  }

  function identityIsLocked(): boolean {
    return returnIdentityLocked(session);
  }

  function executeContextFor(request: ReturnExecuteRequest): CommandContext {
    if (
      executeContext &&
      executeBinding &&
      executeBinding.returnId === request.returnId &&
      executeBinding.fingerprint === request.fingerprint &&
      executeBinding.approvalId === request.approvalId
    ) {
      return executeContext;
    }
    executeContext = commandContext();
    executeBinding = {
      returnId: request.returnId,
      fingerprint: request.fingerprint,
      approvalId: request.approvalId,
    };
    return executeContext;
  }

  function invalidatePreview(partial: Partial<ReturnSessionView> = {}): void {
    if (identityIsLocked()) {
      return;
    }
    executeContext = null;
    executeBinding = null;
    setSession({
      ...session,
      ...partial,
      stage: session.saleId ? "selecting" : "idle",
      returnId: undefined,
      fingerprint: undefined,
      expiresAt: undefined,
      refundTotal: undefined,
      approvalRequired: false,
      approvalId: undefined,
      previewLines: [],
      providerRefund: undefined,
      cashRefund: undefined,
      commercialRefund: undefined,
      stockDisposition: undefined,
      complete: false,
      message: "Return details changed. Review the return again before completing.",
    });
  }

  function selectedLines(): ReturnLineDraftView[] {
    return session.lines.filter((line) => line.quantity.trim() !== "");
  }

  async function applyResolution(resolution: ReturnResolution): Promise<void> {
    const complete = resolution.status === "completed";
    setSession({
      ...session,
      returnId: resolution.returnId,
      stage: stageFromResolution(resolution.status),
      complete,
      message: complete
        ? resolution.message ?? "Return completed successfully."
        : resolution.message ?? "This return isn't finished yet. Some refund or stock updates are still pending.",
      providerRefund: mapEffect(resolution.providerRefund),
      cashRefund: mapEffect(resolution.cashRefund),
      commercialRefund: mapEffect(resolution.commercialRefund),
      stockDisposition: mapEffect(resolution.stockDisposition),
      refundIdentities: collectRefundIdentities(resolution, session.refundIdentities),
    });
  }

  async function resolveUnlocked(): Promise<void> {
    const returnId = session.returnId;
    if (!returnId) {
      return;
    }
    setSession({
      ...session,
      stage: "resolving",
      complete: false,
      message: "Return status is uncertain. Check the same return. Do not start another return.",
    });
    const outcome = await settle(() => ports.returns.resolve(returnId));
    if (outcome.kind === "unknown") {
      setSession({
        ...session,
        stage: "resolving",
        complete: false,
        message: keepThisReturn(outcome.message),
      });
      return;
    }
    if (!outcome.value.ok && shouldResolveFailure(outcome.value)) {
      setSession({
        ...session,
        stage: "resolving",
        complete: false,
        message: keepThisReturn(cashierErrorMessage(outcome.value.error, "returns")),
      });
      return;
    }
    if (outcome.kind === "result" && outcome.value.ok) {
      await applyResolution(outcome.value.data);
      return;
    }
    if (outcome.kind === "result" && !outcome.value.ok) {
      const returnId = session.returnId;
      if (returnId) {
        setSession({
          ...session,
          returnId,
          stage: "requires_attention",
          complete: false,
          message: keepThisReturn(cashierErrorMessage(outcome.value.error, "returns"), true),
        });
        return;
      }
      setSession({
        ...session,
        stage: "failed",
        complete: false,
        message: cashierErrorMessage(outcome.value.error, "returns"),
      });
    }
  }

  return {
    getSession(): ReturnSessionView {
      return session;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    isLocked(): boolean {
      return commandLock;
    },
    async selectSale(sale: HistoricReturnSaleWithExisting): Promise<void> {
      if (commandLock || identityIsLocked()) {
        return;
      }
      executeContext = null;
      executeBinding = null;
      const existing = sale.existingReturn;
      if (!existing) {
        setSession({
          ...idleReturnSession(),
          stage: "selecting",
          saleId: sale.saleId,
          lines: draftsFromSale(sale),
          message: `Sale ${sale.orderReference}. Select return quantities.`,
        });
        return;
      }

      setSession({
        ...idleReturnSession(),
        stage: existing.status,
        saleId: sale.saleId,
        returnId: existing.returnId,
        refundTotal: existing.refundTotal,
        lines: draftsFromExisting(existing.lines),
        previewLines: previewLinesFromExisting(existing.lines),
        complete: false,
        message: "This sale already has an unresolved return. Checking the same return. Do not refund again.",
      });
      commandLock = true;
      try {
        await resolveUnlocked();
      } finally {
        commandLock = false;
        notify();
      }
    },
    updateLine(
      orderLineId: string,
      patch: Partial<Pick<ReturnLineDraftView, "quantity" | "reason" | "condition">>,
    ): void {
      if (commandLock || identityIsLocked()) {
        return;
      }
      const lines = session.lines.map((line) => (line.orderLineId === orderLineId ? { ...line, ...patch } : line));
      invalidatePreview({ lines, inputError: undefined });
    },
    bindApproval(binding: ReturnApprovalBindingView): void {
      if (commandLock || identityIsLocked()) {
        return;
      }
      if (!session.returnId || !session.fingerprint) {
        return;
      }
      if (binding.returnId !== session.returnId || binding.fingerprint !== session.fingerprint) {
        setSession({
          ...session,
          message: "That approval does not match this return. Review the return again.",
        });
        return;
      }
      setSession({
        ...session,
        approvalId: binding.approvalId,
        message: "Manager approval is attached to this return. Complete the same return.",
      });
    },
    async preview(): Promise<void> {
      if (commandLock || identityIsLocked() || !session.saleId) {
        return;
      }
      const chosen = selectedLines();
      if (chosen.length === 0) {
        setSession({ ...session, inputError: "Select at least one return quantity." });
        return;
      }
      for (const line of chosen) {
        const parsed = parseQuantityInput(line.quantity);
        if (!parsed.ok) {
          setSession({ ...session, inputError: parsed.message });
          return;
        }
        if (!line.reason.trim()) {
          setSession({ ...session, inputError: "Enter a reason for each returned line." });
          return;
        }
      }
      const previewLines: ReturnLineRequest[] = [];
      for (const line of chosen) {
        const parsed = parseQuantityInput(line.quantity);
        if (!parsed.ok) {
          setSession({ ...session, inputError: parsed.message });
          return;
        }
        previewLines.push({
          orderLineId: line.orderLineId,
          quantity: parsed.quantity,
          reason: line.reason.trim(),
          condition: line.condition,
        });
      }
      commandLock = true;
      setSession({
        ...session,
        stage: "previewing",
        inputError: undefined,
        approvalId: undefined,
        message: "Loading the refund review.",
      });
      try {
        const outcome = await settle(() =>
          ports.returns.preview({
            saleId: session.saleId!,
            lines: previewLines,
          }),
        );
        if (outcome.kind === "unknown") {
          setSession({
            ...session,
            stage: "failed",
            message: outcome.message,
            complete: false,
          });
          return;
        }
        if (!outcome.value.ok) {
          const existingReturnId = outcome.value.error.details?.operationId;
          if (shouldResolveFailure(outcome.value) && existingReturnId) {
            setSession({
              ...session,
              returnId: existingReturnId,
              stage: "resolving",
              complete: false,
              message: "An existing return was found. Checking the same return. Do not refund again.",
            });
            await resolveUnlocked();
            return;
          }
          setSession({
            ...session,
            stage: "failed",
            message: cashierErrorMessage(outcome.value.error, "returns"),
            complete: false,
          });
          return;
        }
        const preview = outcome.value.data;
        setSession({
          ...session,
          stage: preview.approvalRequired ? "approval_required" : "previewed",
          returnId: preview.returnId,
          fingerprint: preview.fingerprint,
          expiresAt: preview.expiresAt,
          refundTotal: preview.refundTotal,
          approvalRequired: preview.approvalRequired,
          approvalId: undefined,
          previewLines: mapPreviewLines(preview),
          complete: false,
          message: preview.approvalRequired
            ? "Manager approval is required before you can continue."
            : "Review the refund and stock action before completing.",
        });
      } finally {
        commandLock = false;
        notify();
      }
    },
    async execute(): Promise<void> {
      if (commandLock || identityIsLocked() || !session.returnId || !session.fingerprint) {
        return;
      }
      commandLock = true;
      const request: ReturnExecuteRequest = {
        returnId: session.returnId,
        fingerprint: session.fingerprint,
        approvalId: session.approvalId,
      };
      const context = executeContextFor(request);
      setSession({
        ...session,
        stage: "executing",
        complete: false,
        message: "Completing this return. Do not start another return.",
      });
      try {
        const outcome = await settle(() => ports.returns.execute(request, context));
        if (outcome.kind === "unknown" || (outcome.kind === "result" && !outcome.value.ok && shouldResolveFailure(outcome.value))) {
          await resolveUnlocked();
          return;
        }
        if (outcome.kind === "result" && outcome.value.ok) {
          await applyResolution(outcome.value.data);
          return;
        }
        if (outcome.kind === "result" && !outcome.value.ok) {
          const waiting = session.approvalRequired
            && !session.approvalId
            && outcome.value.error.code === "FORBIDDEN";
          setSession({
            ...session,
            stage: waiting ? "approval_required" : "failed",
            complete: false,
            message: waiting
              ? "Manager approval is required before you can continue."
              : cashierErrorMessage(outcome.value.error, "returns"),
          });
        }
      } finally {
        commandLock = false;
        notify();
      }
    },
    async resolve(): Promise<void> {
      if (commandLock) {
        return;
      }
      commandLock = true;
      try {
        await resolveUnlocked();
      } finally {
        commandLock = false;
        notify();
      }
    },
    reset(): void {
      if (commandLock || identityIsLocked()) {
        return;
      }
      executeContext = null;
      executeBinding = null;
      setSession(idleReturnSession());
    },
  };
}

export type ReturnController = ReturnType<typeof createReturnController>;
