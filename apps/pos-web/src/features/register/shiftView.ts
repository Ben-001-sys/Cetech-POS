/**
 * FE-06 register/shift presentation. Expected cash and variance are displayed
 * only from RegisterPort close/report responses.
 */

export type ShiftStatusView = "no_open_shift" | "opening" | "open" | "closing" | "closed" | "requires_attention";

export type RegisterMoneyView = {
  readonly minor: number;
  readonly currency: string;
};

export type SignedRegisterMoneyView = {
  readonly minor: number;
  readonly currency: string;
};

export type ShiftReportView = {
  readonly id: string;
  readonly kind: "X" | "Z";
  readonly expectedCash: RegisterMoneyView;
  readonly countedCash?: RegisterMoneyView;
  readonly variance?: SignedRegisterMoneyView;
  readonly createdAt: string;
};

/** How the latest report request should be shown. Idle means none has been asked for. */
export type ShiftReportPhase = "idle" | "loading" | "ready" | "empty" | "error";

export type ShiftWorkspaceView = {
  readonly status: ShiftStatusView;
  readonly shiftId?: string;
  readonly registerId?: string;
  readonly registerName?: string;
  readonly openingFloat?: RegisterMoneyView;
  readonly countedCash?: RegisterMoneyView;
  readonly expectedCash?: RegisterMoneyView;
  readonly variance?: SignedRegisterMoneyView;
  readonly closedAt?: string;
  readonly report?: ShiftReportView;
  readonly reportPhase?: ShiftReportPhase;
  readonly message: string;
  readonly inputError?: string;
  readonly closeSucceeded: boolean;
};

export function idleShiftWorkspace(): ShiftWorkspaceView {
  return {
    status: "no_open_shift",
    message: "Select a register and open a shift before taking payment.",
    closeSucceeded: false,
  };
}

export function shouldAnnounceRegisterOpened(previous: ShiftStatusView, next: ShiftStatusView): boolean {
  return previous === "opening" && next === "open";
}

export function formatSignedMoneyDisplay(money: SignedRegisterMoneyView): string {
  const sign = money.minor < 0 ? "-" : money.minor > 0 ? "+" : "";
  const abs = Math.abs(money.minor);
  const whole = Math.trunc(abs / 100);
  const frac = abs - whole * 100;
  const fracText = frac < 10 ? `0${frac}` : String(frac);
  return `${sign}${money.currency} ${whole}.${fracText}`;
}

export function describeShiftStatus(status: ShiftStatusView): { readonly title: string; readonly status: string } {
  switch (status) {
    case "no_open_shift":
      return { title: "Register", status: "No open shift." };
    case "opening":
      return { title: "Opening register", status: "Opening the register." };
    case "open":
      return { title: "Shift open", status: "Shift is open. End shift with a drawer cash count." };
    case "closing":
      return { title: "Ending shift", status: "Submitting counted cash. Do not enter expected cash." };
    case "closed":
      return { title: "Shift closed", status: "Shift closed successfully." };
    case "requires_attention":
      return { title: "Shift needs attention", status: "This close needs manager review. It is not closed." };
  }
}
