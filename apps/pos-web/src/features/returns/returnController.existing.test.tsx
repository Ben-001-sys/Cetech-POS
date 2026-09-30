import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { ReturnPort } from "../../../../../docs/contracts/ports";
import { ReturnFlow } from "./ReturnFlow";
import { createReturnController } from "./returnController";
import type { HistoricReturnSaleWithExisting } from "./existingReturn";

const sale: HistoricReturnSaleWithExisting = {
  saleId: "49816",
  orderReference: "49816",
  currency: "GHS",
  lines: [{ orderLineId: "line-1", name: "ABRO Epoxy Steel BLACK", originalSoldQuantity: "1" }],
  existingReturn: {
    returnId: "return-49816",
    status: "requires_attention",
    refundTotal: { minor: 2000, currency: "GHS" },
    lines: [{
      orderLineId: "line-1",
      name: "ABRO Epoxy Steel BLACK",
      originalSoldQuantity: "1",
      quantity: "1",
      reason: "Damaged",
      condition: "damaged",
      intendedDisposition: "no_automatic_restock",
      dispositionPolicy: "mandatory_no_automatic_restock",
      remainingReturnableQuantity: "1",
    }],
  },
};

describe("existing return recovery", () => {
  test("opens and resolves the durable return without previewing or creating another return", async () => {
    const preview = vi.fn(async () => {
      throw new Error("preview must not run");
    });
    const execute = vi.fn(async () => {
      throw new Error("execute must not run");
    });
    const resolve = vi.fn(async () => ({
      ok: true as const,
      correlationId: "corr-1",
      data: {
        returnId: "return-49816",
        status: "requires_attention" as const,
        message: "The order refund record still needs attention.",
        providerRefund: { status: "not_required" as const },
        cashRefund: { effectId: "cash-refund-1", status: "completed" as const },
        commercialRefund: { effectId: "commercial-1", status: "requires_attention" as const },
        stockDisposition: { effectId: "stock-1", status: "pending" as const },
      },
    }));
    const returns: ReturnPort = { preview, execute, resolve };
    const controller = createReturnController({ returns, createUuid: () => "uuid-1" });

    await controller.selectSale(sale);

    expect(preview).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("return-49816");
    const session = controller.getSession();
    expect(session.returnId).toBe("return-49816");
    expect(session.stage).toBe("requires_attention");
    expect(session.identityLocked).toBe(true);
    expect(session.cashRefund?.status).toBe("completed");
    expect(session.commercialRefund?.status).toBe("requires_attention");
    expect(session.stockDisposition?.status).toBe("pending");
    expect(session.lines[0]?.condition).toBe("damaged");

    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session,
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain("Refund — Cash — Completed");
    expect(html).toContain("Order refund record — Needs attention");
    expect(html).toContain("Stock handling — Pending");
    expect(html).toContain("Damaged goods are not automatically returned to sellable stock");
    expect(html.match(/Do not refund the customer again/g)).toHaveLength(1);
  });

  test("a preview conflict recovers the existing return id instead of leaving a fresh-return path", async () => {
    const preview = vi.fn(async () => ({
      ok: false as const,
      correlationId: "corr-2",
      error: {
        code: "OPERATION_IN_PROGRESS" as const,
        message: "This sale already has an unresolved return.",
        retryable: true,
        nextAction: "resolve" as const,
        details: { operationId: "return-existing" },
      },
    }));
    const resolve = vi.fn(async () => ({
      ok: true as const,
      correlationId: "corr-3",
      data: {
        returnId: "return-existing",
        status: "in_progress" as const,
        providerRefund: { status: "not_required" as const },
        cashRefund: { effectId: "cash-existing", status: "completed" as const },
        commercialRefund: { effectId: "commercial-existing", status: "pending" as const },
        stockDisposition: { effectId: "stock-existing", status: "pending" as const },
      },
    }));
    const returns: ReturnPort = {
      preview,
      execute: vi.fn(async () => { throw new Error("execute must not run"); }),
      resolve,
    };
    const controller = createReturnController({ returns, createUuid: () => "uuid-2" });
    await controller.selectSale({
      saleId: "sale-1",
      orderReference: "sale-1",
      currency: "GHS",
      lines: [{ orderLineId: "line-1", name: "Item", originalSoldQuantity: "1" }],
    });
    controller.updateLine("line-1", { quantity: "1", reason: "Damaged", condition: "damaged" });

    await controller.preview();

    expect(resolve).toHaveBeenCalledWith("return-existing");
    expect(controller.getSession().returnId).toBe("return-existing");
    expect(controller.getSession().stage).toBe("in_progress");
    expect(controller.getSession().identityLocked).toBe(true);
  });
});
