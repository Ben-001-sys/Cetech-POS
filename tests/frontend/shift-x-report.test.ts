import { describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ApiResult, Shift, ShiftReport } from "../../docs/contracts/domain.generated";
import { createRegisterController } from "../../apps/pos-web/src/features/register/registerController";
import { RegisterScreen } from "../../apps/pos-web/src/features/register/RegisterScreen";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHIFT = "s1111111-1111-4111-8111-111111111111";
const DEVICE = "d1111111-1111-4111-8111-111111111111";

function success<T>(data: T): ApiResult<T> {
  return { ok: true, data, correlationId: CORRELATION };
}

function openShift(): Shift {
  return {
    id: SHIFT,
    registerId: "reg-main",
    deviceId: DEVICE,
    cashierId: "cashier-1",
    status: "open",
    openingFloat: { minor: 50000, currency: "GHS" },
    openedAt: "2026-09-15T08:00:00.000Z",
  };
}

function xReport(expectedMinor = 12500): ShiftReport {
  return {
    id: "report-x-1",
    shiftId: SHIFT,
    kind: "X",
    expectedCash: { minor: expectedMinor, currency: "GHS" },
    createdAt: "2026-09-15T12:00:00.000Z",
  };
}

function screen(session: ReturnType<ReturnType<typeof createRegisterController>["getSession"]>) {
  return renderToStaticMarkup(
    createElement(RegisterScreen, {
      openForm: { registers: [{ id: "reg-main", name: "Front Counter" }], onSubmit: () => undefined },
      session,
      inFlight: false,
      onShowXReport: () => undefined,
    }),
  );
}

describe("open-shift X report", () => {
  test("a successful X report shows expected cash and does not close the shift", async () => {
    const close = vi.fn();
    const cashMovement = vi.fn();
    const report = vi.fn(async () => success(xReport()));
    const controller = createRegisterController({
      register: {
        get: vi.fn(),
        activeShift: vi.fn(async () => success(openShift())),
        open: vi.fn(),
        cashMovement,
        close,
        report,
      },
      registerId: "reg-main",
      deviceId: DEVICE,
      currency: "GHS",
    });
    await controller.load();
    await controller.report("X");
    const session = controller.getSession();
    expect(session.status).toBe("open");
    expect(session.closeSucceeded).toBe(false);
    expect(session.reportPhase).toBe("ready");
    expect(session.expectedCash).toBeUndefined();
    const html = screen(session);
    expect(html).toContain("Shift summary (X report)");
    expect(html).toContain("Expected GHS 125.00");
    expect(html).toContain('data-x-report=""');
    expect(html).toContain("The shift stays open.");
    expect(html).not.toContain("data-shift-closed");
    expect(close).not.toHaveBeenCalled();
    expect(cashMovement).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0]).toEqual([SHIFT, "X"]);

    await controller.report("X");
    expect(report).toHaveBeenCalledTimes(2);
    expect(close).not.toHaveBeenCalled();
    expect(cashMovement).not.toHaveBeenCalled();
    expect(controller.getSession().status).toBe("open");
  });

  test("loading is not shown as a finished summary", async () => {
    let release!: (value: ApiResult<ShiftReport>) => void;
    const pending = new Promise<ApiResult<ShiftReport>>((resolve) => {
      release = resolve;
    });
    const controller = createRegisterController({
      register: {
        get: vi.fn(),
        activeShift: vi.fn(async () => success(openShift())),
        open: vi.fn(),
        cashMovement: vi.fn(),
        close: vi.fn(),
        report: vi.fn(() => pending),
      },
      registerId: "reg-main",
      deviceId: DEVICE,
      currency: "GHS",
    });
    await controller.load();
    const request = controller.report("X");
    expect(controller.getSession().reportPhase).toBe("loading");
    const html = screen(controller.getSession());
    expect(html).toContain('data-shift-report="loading"');
    expect(html).toContain("Loading the shift summary.");
    expect(html).not.toContain('data-x-report=""');
    expect(html).not.toContain("Shift summary is ready");
    release(success(xReport()));
    await request;
  });

  test("an error is not shown as an empty report", async () => {
    const controller = createRegisterController({
      register: {
        get: vi.fn(),
        activeShift: vi.fn(async () => success(openShift())),
        open: vi.fn(),
        cashMovement: vi.fn(),
        close: vi.fn(),
        report: vi.fn(async () => ({
          ok: false as const,
          correlationId: CORRELATION,
          error: { code: "INTEGRATION_UNAVAILABLE" as const, message: "upstream", retryable: true, nextAction: "retry" as const },
        })),
      },
      registerId: "reg-main",
      deviceId: DEVICE,
      currency: "GHS",
    });
    await controller.load();
    await controller.report("X");
    expect(controller.getSession().reportPhase).toBe("error");
    const html = screen(controller.getSession());
    expect(html).toContain('data-shift-report="error"');
    expect(html).not.toContain('data-shift-report="empty"');
    expect(html).not.toContain("No shift totals are available");
    expect(html).not.toContain('data-x-report=""');
  });

  test("a report without totals is empty, not an error or a closed shift", async () => {
    const controller = createRegisterController({
      register: {
        get: vi.fn(),
        activeShift: vi.fn(async () => success(openShift())),
        open: vi.fn(),
        cashMovement: vi.fn(),
        close: vi.fn(),
        report: vi.fn(async () => success({ ...xReport(), expectedCash: undefined as unknown as ShiftReport["expectedCash"] })),
      },
      registerId: "reg-main",
      deviceId: DEVICE,
      currency: "GHS",
    });
    await controller.load();
    await controller.report("X");
    expect(controller.getSession().status).toBe("open");
    expect(controller.getSession().reportPhase).toBe("empty");
    const html = screen(controller.getSession());
    expect(html).toContain('data-shift-report="empty"');
    expect(html).toContain("No shift totals are available for this report.");
    expect(html).not.toContain('data-shift-report="error"');
    expect(html).not.toContain('data-x-report=""');
  });

  test("a closed shift still shows the Z report", async () => {
    const closed: Shift = {
      ...openShift(),
      status: "closed",
      countedCash: { minor: 12500, currency: "GHS" },
      expectedCash: { minor: 12500, currency: "GHS" },
      variance: { minor: 0, currency: "GHS" },
      closedAt: "2026-09-15T18:00:00.000Z",
      zReportId: "z-1",
    };
    const zReport: ShiftReport = {
      id: "z-1",
      shiftId: SHIFT,
      kind: "Z",
      expectedCash: { minor: 12500, currency: "GHS" },
      countedCash: { minor: 12500, currency: "GHS" },
      variance: { minor: 0, currency: "GHS" },
      createdAt: "2026-09-15T18:00:00.000Z",
    };
    const close = vi.fn();
    const controller = createRegisterController({
      register: {
        get: vi.fn(),
        activeShift: vi.fn(async () => success(closed)),
        open: vi.fn(),
        cashMovement: vi.fn(),
        close,
        report: vi.fn(async () => success(zReport)),
      },
      registerId: "reg-main",
      deviceId: DEVICE,
      currency: "GHS",
    });
    await controller.load();
    await controller.report("Z");
    expect(controller.getSession().status).toBe("closed");
    expect(close).not.toHaveBeenCalled();
    const html = screen(controller.getSession());
    expect(html).toContain('data-z-report=""');
    expect(html).toContain("End-of-shift report (Z report)");
    expect(html).toContain("Expected GHS 125.00");
    expect(html).not.toContain('data-x-report=""');
  });
});
