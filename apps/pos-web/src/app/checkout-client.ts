import type {
  ApiResult,
  CheckoutUseCases,
  OperationJournal,
  PaymentPort,
  PrintPort,
  ReceiptPort,
  RegisterPort,
  ReturnPort,
  SalesPort,
} from "../../../../docs/contracts/ports";
import type {
  CancelSaleRequest,
  CashPaymentRequest,
  CloseShiftRequest,
  CommandContext,
  FinalizeSaleRequest,
  InitializePaymentRequest,
  OpenShiftRequest,
  PaymentLookup,
  PaymentState,
  PendingOperation,
  PreparedSale,
  PrepareSaleRequest,
  PrintResult,
  ReceiptSnapshot,
  Register,
  ReturnExecuteRequest,
  ReturnPreview,
  ReturnPreviewRequest,
  ReturnResolution,
  SaleResolution,
  Shift,
  ShiftReport,
  Uuid,
} from "../../../../docs/contracts/domain.generated";
import type { CashCheckoutPorts, CashCheckoutScope } from "../features/sell";
import { canonicalJson, sha256Hex } from "../local/canonical";
import type { TenderActivityPort } from "../local";

function readCookie(name: string): string | null {
  if (typeof document === "undefined") {
    return null;
  }
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) {
      return trimmed.slice(name.length + 1);
    }
  }
  return null;
}

type BrowserCheckoutOptions = {
  readonly fetchImpl?: typeof fetch;
  readonly csrfCookie?: string;
  readonly csrfHeader?: string;
  readonly origin?: string;
  readonly tenderActivity?: TenderActivityPort;
  readonly journal?: OperationJournal;
  readonly now?: () => Date;
};

type JournalEffect = {
  readonly operation: PendingOperation["operation"];
  readonly transactionId?: Uuid;
};

async function beginJournalEffect(
  options: BrowserCheckoutOptions,
  context: CommandContext | { correlationId: Uuid },
  body: unknown,
  effect: JournalEffect | undefined,
): Promise<Uuid | undefined> {
  if (!options.journal || !effect || !("idempotencyKey" in context)) {
    return undefined;
  }

  const payload = {
    payloadVersion: "1.0.0" as const,
    operation: effect.operation,
    transactionId: effect.transactionId,
    request: body ?? null,
  };
  const serialized = JSON.stringify(payload);
  const requestHash = await sha256Hex(canonicalJson(payload));
  const operationId = context.idempotencyKey;
  const pending: PendingOperation = {
    id: operationId,
    transactionId: effect.transactionId,
    operation: effect.operation,
    idempotencyKey: context.idempotencyKey,
    requestHash,
    payloadVersion: "1.0.0",
    status: "pending",
    attempts: 0,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
  };

  await options.journal.appendBeforeSend(pending, serialized);
  return operationId;
}

async function finishJournalEffect<T>(
  options: BrowserCheckoutOptions,
  operationId: Uuid | undefined,
  result: ApiResult<T>,
): Promise<void> {
  if (!options.journal || !operationId) {
    return;
  }
  try {
    if (!result.ok && result.error.details?.field === "pre_effect") {
      await options.journal.markAcknowledged(operationId);
      return;
    }
    if (!result.ok && result.error.nextAction === "resolve") {
      await options.journal.markResponseUnknown(operationId);
      return;
    }
    if (!result.ok && result.error.code === "REQUIRES_ATTENTION") {
      await options.journal.markRequiresAttention(operationId, result.error.code);
      return;
    }
    if (!result.ok && result.error.details?.field === "remote_sale") {
      await options.journal.markAcknowledged(operationId);
      return;
    }
    await options.journal.markAcknowledged(operationId);
  } catch {
    // The append-before-send row already exists. If local acknowledgement fails,
    // keep the durable row for recovery rather than hiding the server outcome.
  }
}

async function markJournalResponseUnknown(
  options: BrowserCheckoutOptions,
  operationId: Uuid | undefined,
): Promise<void> {
  if (!options.journal || !operationId) {
    return;
  }
  try {
    await options.journal.markResponseUnknown(operationId);
  } catch {
    // A sent/pending row is still safer than erasing an ambiguous operation.
  }
}

async function reconcileSaleJournal(
  options: BrowserCheckoutOptions,
  transactionId: Uuid,
  result: ApiResult<SaleResolution>,
): Promise<void> {
  if (!options.journal || !result.ok) {
    return;
  }
  let rows: ReadonlyArray<PendingOperation>;
  try {
    rows = (await options.journal.pending()).filter(
      (row) =>
        row.transactionId === transactionId &&
        (row.operation === "sale.prepare" ||
          row.operation === "sale.finalize" ||
          row.operation === "sale.cancel" ||
          row.operation === "payment.initialize" ||
          row.operation === "payment.cash" ||
          row.operation === "payment.resolve"),
    );
  } catch {
    return;
  }

  for (const row of rows) {
    try {
      const isPaymentRow = row.operation.startsWith("payment.");
      if (result.data.status === "prepared" && row.operation === "sale.prepare") {
        await options.journal.markAcknowledged(row.id);
        continue;
      }
      if (result.data.status === "completed") {
        await options.journal.markAcknowledged(row.id);
        continue;
      }
      if (result.data.status === "not_found" || result.data.status === "cancelled") {
        if (isPaymentRow) {
          await options.journal.markRequiresAttention(
            row.id,
            result.data.status === "cancelled"
              ? "Payment work exists but the sale was cancelled; manager review is required"
              : "Payment work exists but the sale was not found; manager review is required",
          );
        } else {
          await options.journal.markAcknowledged(row.id);
        }
        continue;
      }
      await options.journal.markRequiresAttention(
        row.id,
        result.data.message ?? "Existing transaction is not terminal; resolve it before starting another attempt",
      );
    } catch {
      // Keep unresolved local evidence visible if reconciliation persistence fails.
    }
  }
}

async function reconcilePaymentJournal(
  options: BrowserCheckoutOptions,
  transactionId: Uuid,
  result: ApiResult<PaymentState>,
): Promise<void> {
  if (!options.journal || !result.ok) {
    return;
  }
  let rows: ReadonlyArray<PendingOperation>;
  try {
    rows = (await options.journal.pending()).filter(
      (row) =>
        row.transactionId === transactionId &&
        (row.operation === "payment.initialize" ||
          row.operation === "payment.cash" ||
          row.operation === "payment.resolve"),
    );
  } catch {
    return;
  }
  for (const row of rows) {
    try {
      await options.journal.markRequiresAttention(
        row.id,
        result.data.status === "verified"
          ? "Payment is verified; confirm the sale outcome before starting another attempt"
          : "Payment state is known but the sale still needs recovery before another attempt",
      );
    } catch {
      // Keep unresolved local evidence visible if reconciliation persistence fails.
    }
  }
}

function unavailable<T>(correlation: Uuid, message: string): ApiResult<T> {
  return {
    ok: false,
    error: {
      code: "INTEGRATION_UNAVAILABLE",
      message,
      retryable: true,
      nextAction: "resolve",
    },
    correlationId: correlation,
  };
}

async function command<T>(
  url: string,
  method: "GET" | "POST",
  context: CommandContext | { correlationId: Uuid },
  options: BrowserCheckoutOptions,
  body?: unknown,
  journalEffect?: JournalEffect,
  beforeSend?: () => Promise<void>,
): Promise<ApiResult<T>> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const csrfCookie = options.csrfCookie ?? "cetech_pos_csrf";
  const csrfHeader = options.csrfHeader ?? "x-csrf-token";
  const idempotencyKey = "idempotencyKey" in context ? context.idempotencyKey : undefined;
  let journalOperationId: Uuid | undefined;
  try {
    journalOperationId = await beginJournalEffect(options, context, body, journalEffect);
  } catch {
    return unavailable(
      context.correlationId,
      "Local recovery journal is unavailable. Resolve existing work before retrying.",
    );
  }
  try {
    await beforeSend?.();
    if (options.journal && journalOperationId) {
      await options.journal.markSent(journalOperationId);
    }
  } catch {
    return unavailable(
      context.correlationId,
      "Local recovery state could not be secured. Resolve existing work before retrying.",
    );
  }
  try {
    const headers: Record<string, string> = {
      "x-correlation-id": context.correlationId,
      [csrfHeader]: readCookie(csrfCookie) ?? "",
    };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    if (idempotencyKey) {
      headers["idempotency-key"] = idempotencyKey;
    }
    const response = await fetchImpl(url, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json()) as ApiResult<T>;
    await finishJournalEffect(options, journalOperationId, result);
    return result;
  } catch {
    await markJournalResponseUnknown(options, journalOperationId);
    return unavailable(context.correlationId, "Checkout transport failed. Resolve the existing operation.");
  }
}

function saleTerminal(result: ApiResult<SaleResolution>): boolean {
  return result.ok && (result.data.status === "completed" || result.data.status === "cancelled");
}

export function createBrowserCheckoutUseCases(options: BrowserCheckoutOptions = {}): CheckoutUseCases {
  return {
    async prepare(input: PrepareSaleRequest, context: CommandContext): Promise<ApiResult<PreparedSale>> {
      const result = await command<PreparedSale>(
        "/api/pos/v1/sales/prepare",
        "POST",
        context,
        options,
        input,
        { operation: "sale.prepare", transactionId: input.transactionId },
        async () => {
          await options.tenderActivity?.markActive(input.transactionId);
        },
      );
      if (!result.ok && result.error.nextAction !== "resolve") {
        await options.tenderActivity?.clear(input.transactionId);
      }
      return result;
    },
    async finalize(input: FinalizeSaleRequest, context: CommandContext): Promise<ApiResult<SaleResolution>> {
      await options.tenderActivity?.markActive(input.transactionId);
      const result = await command<SaleResolution>(
        "/api/pos/v1/sales/finalize",
        "POST",
        context,
        options,
        input,
        { operation: "sale.finalize", transactionId: input.transactionId },
      );
      if (saleTerminal(result)) {
        await options.tenderActivity?.clear(input.transactionId);
      }
      return result;
    },
  };
}

export function createBrowserPaymentPort(
  options: BrowserCheckoutOptions = {},
): Pick<PaymentPort, "initialize" | "confirmCash" | "resolve"> {
  return {
    async initialize(input: InitializePaymentRequest, context: CommandContext): Promise<ApiResult<PaymentState>> {
      await options.tenderActivity?.markActive(input.transactionId);
      return command(
        "/api/pos/v1/payments/initialize",
        "POST",
        context,
        options,
        input,
        { operation: "payment.initialize", transactionId: input.transactionId },
      );
    },
    async confirmCash(input: CashPaymentRequest, context: CommandContext): Promise<ApiResult<PaymentState>> {
      await options.tenderActivity?.markActive(input.transactionId);
      return command(
        "/api/pos/v1/payments/cash",
        "POST",
        context,
        options,
        input,
        { operation: "payment.cash", transactionId: input.transactionId },
      );
    },
    async resolve(input: PaymentLookup): Promise<ApiResult<PaymentState>> {
      await options.tenderActivity?.markActive(input.transactionId);
      const result = await command<PaymentState>(
        "/api/pos/v1/payments/resolve",
        "POST",
        { correlationId: crypto.randomUUID() },
        options,
        input,
      );
      await reconcilePaymentJournal(options, input.transactionId, result);
      return result;
    },
  };
}

export function createBrowserSalesResolvePort(options: BrowserCheckoutOptions = {}): Pick<SalesPort, "resolve" | "cancel"> {
  return {
    async resolve(transactionId: Uuid): Promise<ApiResult<SaleResolution>> {
      const result = await command<SaleResolution>(
        `/api/pos/v1/sales/${transactionId}`,
        "GET",
        { correlationId: crypto.randomUUID() },
        options,
      );
      await reconcileSaleJournal(options, transactionId, result);
      if (saleTerminal(result) || (result.ok && result.data.status === "not_found")) {
        await options.tenderActivity?.clear(transactionId);
      } else if (result.ok) {
        await options.tenderActivity?.markActive(transactionId);
      }
      return result;
    },
    async cancel(input: CancelSaleRequest, context: CommandContext): Promise<ApiResult<SaleResolution>> {
      await options.tenderActivity?.markActive(input.transactionId);
      const result = await command<SaleResolution>(
        "/api/pos/v1/sales/cancel",
        "POST",
        context,
        options,
        input,
        { operation: "sale.cancel", transactionId: input.transactionId },
      );
      if (saleTerminal(result)) {
        await options.tenderActivity?.clear(input.transactionId);
      }
      return result;
    },
  };
}

export function createBrowserReceiptPort(options: BrowserCheckoutOptions = {}): ReceiptPort {
  return {
    getByTransaction(id: Uuid): Promise<ApiResult<ReceiptSnapshot>> {
      return command(`/api/pos/v1/receipts/${id}`, "GET", { correlationId: crypto.randomUUID() }, options);
    },
  };
}

export function createBrowserPrintPort(): PrintPort {
  return {
    async print(): Promise<PrintResult> {
      if (typeof window === "undefined" || typeof window.print !== "function") {
        return { status: "unsupported", message: "Printing is not available in this session." };
      }
      window.print();
      return { status: "dialog_opened", message: "Print dialog opened." };
    },
  };
}

export function createBrowserCashCheckoutPorts(
  options: BrowserCheckoutOptions & { readonly scope: CashCheckoutScope },
): CashCheckoutPorts {
  return {
    checkout: createBrowserCheckoutUseCases(options),
    payments: createBrowserPaymentPort(options),
    sales: createBrowserSalesResolvePort(options),
    receipts: createBrowserReceiptPort(options),
    printer: createBrowserPrintPort(),
    scope: options.scope,
  };
}

export function createBrowserReturnPort(options: BrowserCheckoutOptions = {}): ReturnPort {
  return {
    preview(input: ReturnPreviewRequest): Promise<ApiResult<ReturnPreview>> {
      return command("/api/pos/v1/returns/preview", "POST", { correlationId: crypto.randomUUID() }, options, input);
    },
    execute(input: ReturnExecuteRequest, context: CommandContext): Promise<ApiResult<ReturnResolution>> {
      return command("/api/pos/v1/returns/execute", "POST", context, options, input);
    },
    resolve(returnId: Uuid): Promise<ApiResult<ReturnResolution>> {
      return command(`/api/pos/v1/returns/${returnId}`, "GET", { correlationId: crypto.randomUUID() }, options);
    },
  };
}

export function createBrowserRegisterPort(options: BrowserCheckoutOptions = {}): RegisterPort {
  return {
    get(id): Promise<ApiResult<Register>> {
      return command(`/api/pos/v1/registers/${id}`, "GET", { correlationId: crypto.randomUUID() }, options);
    },
    activeShift(id): Promise<ApiResult<Shift | null>> {
      return command(`/api/pos/v1/registers/${id}/active-shift`, "GET", { correlationId: crypto.randomUUID() }, options);
    },
    open(input: OpenShiftRequest, context: CommandContext): Promise<ApiResult<Shift>> {
      return command("/api/pos/v1/shifts/open", "POST", context, options, input);
    },
    cashMovement() {
      return Promise.resolve(
        unavailable(crypto.randomUUID(), "Cash movements are not mounted in this R8 composition."),
      );
    },
    close(input: CloseShiftRequest, context: CommandContext): Promise<ApiResult<Shift>> {
      return command("/api/pos/v1/shifts/close", "POST", context, options, input);
    },
    report(shiftId: Uuid, kind: "X" | "Z"): Promise<ApiResult<ShiftReport>> {
      return command(
        `/api/pos/v1/shifts/${shiftId}/report?kind=${kind}`,
        "GET",
        { correlationId: crypto.randomUUID() },
        options,
      );
    },
  };
}
