import type { ApiResult, OperationJournal, PaymentPort, SalesPort } from "../../../../docs/contracts/ports";
import type { PaymentState, PendingOperation, SaleResolution } from "../../../../docs/contracts/domain.generated";
import { cashierErrorMessage } from "../ui/cashier-language";
import { listUnresolvedJournalRecords } from "../local/operation-journal";
import {
  presentLocalRecovery,
  recoveryKindForOperation,
  UNKNOWN_ORGANIZATION_RECOVERY_COPY,
  type LocalRecoveryViewer,
} from "../local/journal-recovery-scope";
import type { PosLocalDatabase } from "../local/pos-local-db";
import type { AttentionItemView } from "../ui/operational";


const SALE_RECOVERY_OPERATIONS = new Set<PendingOperation["operation"]>([
  "sale.prepare",
  "sale.finalize",
  "sale.cancel",
]);

const PAYMENT_RECOVERY_OPERATIONS = new Set<PendingOperation["operation"]>([
  "payment.initialize",
  "payment.cash",
  "payment.resolve",
]);

/** A local recovery scan is valid only for the context that produced it. */
export type LocalRecoveryContext = {
  readonly organizationId: string;
  readonly actorId: string;
  readonly registerId: string;
  readonly deviceId: string;
};

export function localRecoveryContextKey(context: LocalRecoveryContext): string {
  return [context.organizationId, context.actorId, context.registerId, context.deviceId].join("\u001f");
}

/** One automatic auth refresh until this context has a successful inbox read. */
export function createAttentionAuthRefreshGate(): {
  readonly shouldRefresh: (context: LocalRecoveryContext, result: ApiResult<unknown>) => boolean;
  readonly reset: () => void;
} {
  let contextKey: string | null = null;
  let spent = false;
  return {
    shouldRefresh(context, result) {
      const nextContextKey = localRecoveryContextKey(context);
      if (contextKey !== nextContextKey) {
        contextKey = nextContextKey;
        spent = false;
      }
      if (result.ok) {
        spent = false;
        return false;
      }
      if (result.error.code !== "AUTH_REQUIRED" || spent) return false;
      spent = true;
      return true;
    },
    reset() {
      contextKey = null;
      spent = false;
    },
  };
}

export function isLocalRecoveryContextCurrent(
  scanned: LocalRecoveryContext | null,
  current: LocalRecoveryContext,
): boolean {
  if (!scanned) return false;
  return localRecoveryContextKey(scanned) === localRecoveryContextKey(current);
}

export function checkoutBlockedByLocalRecovery(input: {
  readonly scanned: LocalRecoveryContext | null;
  readonly current: LocalRecoveryContext;
  readonly items: readonly AttentionItemView[];
}): boolean {
  if (!isLocalRecoveryContextCurrent(input.scanned, input.current)) return true;
  return hasBlockingLocalTransactionRecovery(input.items);
}

/** Invalidates an in-flight scan when organization, actor, register, or device changes. */
export function createRecoveryScanGate(): {
  readonly start: () => number;
  readonly isCurrent: (token: number) => boolean;
} {
  let generation = 0;
  return {
    start() {
      generation += 1;
      return generation;
    },
    isCurrent(token) {
      return token === generation;
    },
  };
}

export function localJournalRecoveryKind(
  operation: PendingOperation["operation"],
): "sale" | "payment" | null {
  if (SALE_RECOVERY_OPERATIONS.has(operation)) return "sale";
  if (PAYMENT_RECOVERY_OPERATIONS.has(operation)) return "payment";
  return null;
}

export async function loadLocalJournalAttentionItems(
  journal: OperationJournal | undefined,
  viewer?: LocalRecoveryViewer,
  db?: PosLocalDatabase,
): Promise<readonly AttentionItemView[]> {
  if (!db && !journal) return [];
  const records = db ? await listUnresolvedJournalRecords(db) : [];
  if (!db) {
    const pending = await journal!.pending();
    return pending.flatMap((row) => presentPendingWithoutDatabase(row, viewer));
  }
  return records.flatMap((record): AttentionItemView[] => {
    if (!record.pending.transactionId && recoveryKindForOperation(record.pending.operation)) {
      return [];
    }
    const presented = presentLocalRecovery({
      row: {
        id: record.pending.id,
        operation: record.pending.operation,
        status: record.pending.status,
        transactionId: record.pending.transactionId,
        idempotencyKey: record.pending.idempotencyKey,
        scope: record.scope,
      },
      viewer,
    });
    if (presented.quarantine) {
      return [{
        id: `local-journal:${record.pending.id}`,
        title: presented.title,
        summary: presented.summary,
        typeLabel: "Saved work",
        severity: "critical",
        resolveAllowed: false,
        retryAllowed: false,
        reviewAllowed: false,
        blocksCheckout: true,
        localRecoveryOwner: "unknown",
        quarantine: true,
      }];
    }
    if (!presented.applicable) return [];
    const recoverKind = localJournalRecoveryKind(record.pending.operation);
    const uncertain = record.pending.status === "response_unknown" || record.pending.status === "requires_attention";
    return [{
      id: `local-journal:${record.pending.id}`,
      title: presented.title,
      summary: presented.summary,
      typeLabel: recoverKind === "payment" ? "Payment recovery" : recoverKind === "sale" ? "Sale recovery" : "Saved work",
      severity: uncertain || presented.blocksCheckout ? "critical" : "medium",
      transactionId: record.pending.transactionId,
      resolveAllowed: recoverKind !== null,
      retryAllowed: false,
      reviewAllowed: false,
      recoverKind: recoverKind ?? undefined,
      blocksCheckout: presented.blocksCheckout,
      localRecoveryOwner: presented.authoredByViewer ? "viewer" : presented.actorKnown ? "other" : "unknown",
    }];
  });
}

function presentPendingWithoutDatabase(
  row: PendingOperation,
  viewer: LocalRecoveryViewer | undefined,
): AttentionItemView[] {
  if (!row.transactionId) return [];
  const recoverKind = localJournalRecoveryKind(row.operation);
  if (!recoverKind) return [];
  const presented = presentLocalRecovery({
    row: {
      id: row.id,
      operation: row.operation,
      status: row.status,
      transactionId: row.transactionId,
      idempotencyKey: row.idempotencyKey,
      scope: {},
    },
    viewer,
  });
  if (presented.quarantine) {
    return [{
      id: `local-journal:${row.id}`,
      title: presented.title,
      summary: presented.summary,
      typeLabel: "Saved work",
      severity: "critical",
      resolveAllowed: false,
      retryAllowed: false,
      reviewAllowed: false,
      blocksCheckout: true,
      localRecoveryOwner: "unknown",
      quarantine: true,
    }];
  }
  if (!presented.applicable) return [];
  return [{
    id: `local-journal:${row.id}`,
    title: presented.title,
    summary: presented.summary,
    typeLabel: recoverKind === "payment" ? "Payment recovery" : "Sale recovery",
    severity: "critical",
    transactionId: row.transactionId,
    resolveAllowed: true,
    retryAllowed: false,
    reviewAllowed: false,
    recoverKind,
    blocksCheckout: true,
    localRecoveryOwner: "unknown",
  }];
}

export function localRecoverySellBanner(
  checked: boolean,
  items: readonly AttentionItemView[],
): { readonly title: string; readonly detail: string } | null {
  if (!checked) {
    return {
      title: "Checking saved transaction work…",
      detail: "Checkout will stay unavailable until saved transaction work has been checked.",
    };
  }
  if (!hasBlockingLocalTransactionRecovery(items)) {
    return null;
  }
  const quarantine = items.some(
    (item) => item.id.startsWith("local-journal:") && item.blocksCheckout !== false && item.quarantine,
  );
  if (quarantine) {
    return {
      title: "Saved work needs a status check.",
      detail: UNKNOWN_ORGANIZATION_RECOVERY_COPY,
    };
  }
  const anotherSignIn = items.some(
    (item) =>
      item.id.startsWith("local-journal:") &&
      item.blocksCheckout !== false &&
      item.localRecoveryOwner !== "viewer",
  );
  if (anotherSignIn) {
    return {
      title: "This register needs a status check.",
      detail:
        "Unfinished work from another sign-in is still on this register. Open Needs attention and check that transaction before taking a payment. Do not start it again.",
    };
  }
  return {
    title: "Previous transaction needs a status check.",
    detail: "Open Needs attention and check the existing transaction before taking another payment.",
  };
}

export function hasBlockingLocalTransactionRecovery(
  items: readonly AttentionItemView[],
): boolean {
  return items.some(
    (item) =>
      item.id.startsWith("local-journal:") &&
      item.blocksCheckout !== false &&
      (item.recoverKind === "sale" || item.recoverKind === "payment" || item.recoverKind === undefined),
  );
}

export function mergeAttentionItems(
  serverItems: readonly AttentionItemView[],
  localItems: readonly AttentionItemView[],
  extras: readonly AttentionItemView[],
): readonly AttentionItemView[] {
  const next: AttentionItemView[] = [...localItems];
  for (const server of serverItems) {
    const duplicate = next.some(
      (item) =>
        Boolean(item.transactionId) &&
        item.transactionId === server.transactionId &&
        item.recoverKind === server.recoverKind &&
        item.resolveAllowed &&
        server.resolveAllowed,
    );
    if (!duplicate) next.push(server);
  }
  next.push(...extras);
  return next;
}

export type AttentionRecoveryPorts = {
  readonly payments: Pick<PaymentPort, "resolve">;
  readonly sales: Pick<SalesPort, "resolve">;
};

export type AttentionRecoveryLock = {
  readonly inFlightId: () => string | null;
  readonly tryBegin: (id: string) => boolean;
  readonly end: (id: string) => void;
};

export type AttentionRecoveryStatus = "in_flight" | "unsupported" | "attempted";

export type AttentionRecoveryOutcome =
  | { readonly status: "unsupported" }
  | { readonly status: "attempted"; readonly kind: "sale"; readonly result: ApiResult<SaleResolution> }
  | { readonly status: "attempted"; readonly kind: "payment"; readonly result: ApiResult<PaymentState> }
  | { readonly status: "failed" };

/** Only locally authored copy is displayed; bridge/provider messages are never shown verbatim. */
export function attentionRecoveryFeedback(outcome: AttentionRecoveryOutcome): string {
  if (outcome.status === "unsupported") return "This saved work needs a manager check. Do not start it again.";
  if (outcome.status === "failed") return "Status could not be checked. Try again when connected. Do not take payment again.";
  if (!outcome.result.ok) return `${cashierErrorMessage(outcome.result.error, "generic")} Your saved transaction was kept. Do not take payment again.`;
  const status = outcome.result.data.status;
  if (outcome.kind === "sale") {
    if (status === "completed") return "The sale is complete. Open its existing receipt. Do not take payment again.";
    if (status === "prepared") return "The existing sale is ready. Continue the same sale from Sell.";
    if (status === "not_found" || status === "cancelled") return "The sale status was checked. Your cart was kept.";
    return "This sale still needs checking. Do not take payment again. Contact a manager if it cannot be recovered.";
  }
  if (status === "verified") return "Payment is verified. The sale still needs to be checked. Do not take payment again.";
  return "Payment is still being checked. Do not take payment again.";
}

export function recoveryRequiresSignIn(outcome: AttentionRecoveryOutcome): boolean {
  return outcome.status === "attempted" && !outcome.result.ok && outcome.result.error.code === "AUTH_REQUIRED";
}

/** Bound operator recovery reads/replays without issuing any automatic second request. */
export function boundedRecoveryFetch(fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const inherited = init?.signal;
    const cancel = () => controller.abort();
    if (inherited?.aborted) cancel();
    inherited?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });
      // Include JSON body delivery in the deadline, not only receipt of headers.
      await response.clone().arrayBuffer();
      return response;
    } finally {
      clearTimeout(timer);
      inherited?.removeEventListener("abort", cancel);
    }
  };
}

export function createAttentionRecoveryLock(): AttentionRecoveryLock {
  let inFlightId: string | null = null;
  return {
    inFlightId: () => inFlightId,
    tryBegin(id) {
      if (inFlightId) {
        return false;
      }
      inFlightId = id;
      return true;
    },
    end(id) {
      if (inFlightId === id) {
        inFlightId = null;
      }
    },
  };
}

export async function recoverAttentionItem(
  item: AttentionItemView,
  ports: AttentionRecoveryPorts,
): Promise<AttentionRecoveryOutcome> {
  if (!item.resolveAllowed || !item.transactionId) {
    return { status: "unsupported" };
  }
  if (item.recoverKind === "payment") {
    const result = await ports.payments.resolve({
      transactionId: item.transactionId,
      paymentId: item.paymentId,
    });
    if (result.ok && item.id.startsWith("local-journal:")) {
      return { status: "attempted", kind: "sale", result: await ports.sales.resolve(item.transactionId) };
    }
    return { status: "attempted", kind: "payment", result };
  }
  if (item.recoverKind === "sale") {
    return { status: "attempted", kind: "sale", result: await ports.sales.resolve(item.transactionId) };
  }
  return { status: "unsupported" };
}

export async function runAttentionRecovery(input: {
  readonly item: AttentionItemView;
  readonly lock: AttentionRecoveryLock;
  readonly ports: AttentionRecoveryPorts;
  readonly reload: () => Promise<void>;
  readonly onStart?: (id: string) => void;
  readonly onFinish?: (id: string) => void;
  readonly onOutcome?: (outcome: AttentionRecoveryOutcome) => void | Promise<void>;
}): Promise<AttentionRecoveryStatus> {
  if (!input.lock.tryBegin(input.item.id)) {
    return "in_flight";
  }
  input.onStart?.(input.item.id);
  try {
    let outcome: AttentionRecoveryOutcome;
    try {
      outcome = await recoverAttentionItem(input.item, input.ports);
    } catch {
      outcome = { status: "failed" };
    }
    await input.onOutcome?.(outcome);
    return outcome.status === "unsupported" ? "unsupported" : "attempted";
  } finally {
    try {
      await input.reload();
    } finally {
      input.lock.end(input.item.id);
      input.onFinish?.(input.item.id);
    }
  }
}
