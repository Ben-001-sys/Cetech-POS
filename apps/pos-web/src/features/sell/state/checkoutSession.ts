import type { ReceiptPresentation } from "../../../../../../docs/contracts/domain.generated";

/**
 * FE-05 checkout presentation view-model.
 * Discriminants describe cashier-visible stages; they are not CheckoutUseCases.
 */

export type CheckoutMoneyView = {
  readonly minor: number;
  readonly currency: string;
};

export type PreparedSaleView = {
  readonly transactionId: string;
  readonly saleId: string;
  readonly orderReference: string;
  readonly quoteFingerprint: string;
  readonly total: CheckoutMoneyView;
};

export type ReceiptLineView = {
  readonly name: string;
  readonly sku?: string;
  readonly variationLabel?: string;
  readonly quantity: string;
  readonly unitPrice: CheckoutMoneyView;
  readonly total: CheckoutMoneyView;
};

export type ReceiptViewModel = {
  readonly id: string;
  readonly transactionId: string;
  readonly receiptNumber: string;
  readonly orderReference: string;
  readonly issuedAt: string;
  readonly locationName: string;
  readonly registerName: string;
  readonly cashierName: string;
  readonly customerLabel: string;
  readonly customerPhone?: string;
  readonly presentation?: ReceiptPresentation;
  readonly lines: readonly ReceiptLineView[];
  readonly subtotal: CheckoutMoneyView;
  readonly discount: CheckoutMoneyView;
  readonly tax: CheckoutMoneyView;
  readonly total: CheckoutMoneyView;
  readonly tender: string;
  readonly cashReceived?: CheckoutMoneyView;
  readonly changeDue?: CheckoutMoneyView;
  readonly documentKind: "operational_pos_receipt";
};

export type PrintStatusView = "idle" | "printing" | "dialog_opened" | "failed" | "unsupported";

export type CheckoutStageView =
  | "idle"
  | "preparing"
  | "prepare_failed"
  | "resolving_sale"
  | "choose_payment"
  | "cash"
  | "confirming_cash"
  | "cash_failed"
  | "cancelling"
  | "cancel_failed"
  | "resolving_payment"
  | "finalizing"
  | "finalize_failed"
  | "complete"
  | "receipt_failed"
  | "receipt_ready"
  | "printing"
  | "print_failed";

export type CheckoutSessionView = {
  readonly stage: CheckoutStageView;
  readonly message: string;
  readonly inputError?: string;
  readonly prepared?: PreparedSaleView;
  readonly receipt?: ReceiptViewModel;
  readonly printStatus: PrintStatusView;
  readonly printMessage?: string;
  readonly saleCompleted: boolean;
  readonly transactionId?: string;
};

export function idleCheckoutSession(): CheckoutSessionView {
  return {
    stage: "idle",
    message: "",
    printStatus: "idle",
    saleCompleted: false,
  };
}

export function checkoutCommandInFlight(stage: CheckoutStageView): boolean {
  return (
    stage === "preparing" ||
    stage === "resolving_sale" ||
    stage === "confirming_cash" ||
    stage === "cancelling" ||
    stage === "resolving_payment" ||
    stage === "finalizing" ||
    stage === "printing"
  );
}

export function checkoutDialogOpen(stage: CheckoutStageView): boolean {
  return stage !== "idle";
}

export function hasOutstandingPreparedSale(session: CheckoutSessionView): boolean {
  if (session.saleCompleted) {
    return false;
  }
  if (session.prepared) {
    return true;
  }
  return (
    session.stage === "choose_payment" ||
    session.stage === "cash" ||
    session.stage === "cash_failed" ||
    session.stage === "confirming_cash" ||
    session.stage === "cancelling" ||
    session.stage === "cancel_failed" ||
    session.stage === "resolving_payment" ||
    session.stage === "finalizing" ||
    session.stage === "finalize_failed"
  );
}

export function canBeginNewSale(session: CheckoutSessionView): boolean {
  if (hasOutstandingPreparedSale(session)) {
    return false;
  }
  if (checkoutCommandInFlight(session.stage)) {
    return false;
  }
  if (session.stage === "resolving_sale" || session.stage === "resolving_payment") {
    return false;
  }
  if (session.saleCompleted) {
    return (
      session.stage === "complete" ||
      session.stage === "receipt_ready" ||
      session.stage === "receipt_failed" ||
      session.stage === "printing" ||
      session.stage === "print_failed"
    );
  }
  return session.stage === "idle" || session.stage === "prepare_failed";
}

/** Only an unprepared failure may return to the editable Sell workspace. */
export function checkoutDismissAllowed(session: CheckoutSessionView): boolean {
  return session.stage === "prepare_failed" && !hasOutstandingPreparedSale(session);
}

export function canReturnToPaymentChoice(stage: CheckoutStageView): boolean {
  return stage === "cash" || stage === "cash_failed";
}

export function checkoutCloseRequestsCancel(stage: CheckoutStageView): boolean {
  return stage === "choose_payment" || stage === "cash" || stage === "cash_failed" || stage === "cancel_failed";
}

export function formatMinorDecimal(minor: number): string {
  if (!Number.isInteger(minor) || minor < 0) {
    return "";
  }
  const whole = Math.trunc(minor / 100);
  const frac = minor - whole * 100;
  const fracText = frac < 10 ? `0${frac}` : String(frac);
  return `${whole}.${fracText}`;
}

export function describeCheckoutStage(stage: CheckoutStageView): {
  readonly title: string;
  readonly status: string;
} {
  switch (stage) {
    case "idle":
      return { title: "Checkout", status: "" };
    case "preparing":
      return { title: "Checking price and stock…", status: "Checking price and stock…" };
    case "prepare_failed":
      return { title: "Sale couldn't be started", status: "The sale was not started. The cart is unchanged." };
    case "resolving_sale":
      return {
        title: "Checking sale",
        status: "Sale status is uncertain. Do not start another sale.",
      };
    case "choose_payment":
      return { title: "Choose payment", status: "" };
    case "cash":
      return { title: "Cash payment", status: "" };
    case "cancelling":
      return { title: "Cancelling sale", status: "Checking sale status…" };
    case "cancel_failed":
      return { title: "Sale could not be cancelled", status: "This sale is still active. Do not start another sale." };
    case "confirming_cash":
      return { title: "Confirming cash", status: "Confirming cash payment. Do not start another payment." };
    case "cash_failed":
      return { title: "Cash confirmation failed", status: "Cash was not confirmed. The cart is unchanged." };
    case "resolving_payment":
      return {
        title: "Checking payment",
        status: "Payment status is uncertain. Do not confirm cash again.",
      };
    case "finalizing":
      return { title: "Completing sale…", status: "Completing the sale. Payment has been submitted; do not charge again." };
    case "finalize_failed":
      return { title: "Sale could not be finished", status: "The sale could not be finished. Do not start another payment." };
    case "complete":
      return { title: "Sale complete", status: "The sale is complete. Loading the official receipt." };
    case "receipt_failed":
      return {
        title: "Receipt unavailable",
        status: "The sale is complete, but the receipt could not be loaded. Do not repeat the sale.",
      };
    case "receipt_ready":
      return { title: "Sale complete", status: "The sale is complete." };
    case "printing":
      return { title: "Printing receipt", status: "Sending the receipt to the printer." };
    case "print_failed":
      return { title: "Print failed", status: "Printing failed. The sale remains complete." };
  }
}
