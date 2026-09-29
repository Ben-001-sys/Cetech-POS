import { describe, expect, test, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ApiFailure,
  ApiResult,
  IndependentEffectSummary,
  ReturnPreview,
  ReturnResolution,
  SettledIndependentEffectSummary,
} from "../../docs/contracts/domain.generated";
import { createReturnController } from "../../apps/pos-web/src/features/returns/returnController";
import { ReturnFlow } from "../../apps/pos-web/src/features/returns/ReturnFlow";
import { ReturnsScreen } from "../../apps/pos-web/src/features/returns/ReturnsScreen";
import { presentsAutomaticSellableRestock } from "../../apps/pos-web/src/features/returns/returnView";
import type { HistoricReturnSaleView } from "../../apps/pos-web/src/features/returns/returnView";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RETURN_ID = "r1111111-1111-4111-8111-111111111111";
const FINGERPRINT = "fp-return-1";
const REFUND_1 = "rf111111-1111-4111-8111-111111111111";
const REFUND_2 = "rf222222-2222-4222-8222-222222222222";
const COMMERCIAL_ID = "cr-111111-1111-4111-8111-111111111111";
const STOCK_ID = "sd-111111-1111-4111-8111-111111111111";

function success<T>(data: T): ApiResult<T> {
  return { ok: true, data, correlationId: CORRELATION };
}

function failure(nextAction: ApiFailure["error"]["nextAction"], message: string): ApiFailure {
  return {
    ok: false,
    correlationId: CORRELATION,
    error: { code: "REQUIRES_ATTENTION", message, retryable: nextAction === "resolve", nextAction },
  };
}

const sale: HistoricReturnSaleView = {
  saleId: "sale-hist-1",
  orderReference: "POS-2001",
  currency: "GHS",
  lines: [
    { orderLineId: "ol-1", name: "Epoxy Hardener", originalSoldQuantity: "2" },
    { orderLineId: "ol-2", name: "Gloves", originalSoldQuantity: "1" },
  ],
};

function preview(overrides: Partial<ReturnPreview> = {}): ReturnPreview {
  return {
    returnId: RETURN_ID,
    saleId: "sale-hist-1",
    economicsVersion: "eco-1",
    refundTotal: { minor: 1500, currency: "GHS" },
    approvalRequired: false,
    fingerprint: FINGERPRINT,
    expiresAt: "2099-01-01T00:00:00.000Z",
    lines: [
      {
        orderLineId: "ol-1",
        requestedQuantity: "1",
        remainingReturnableQuantity: "1",
        condition: "resellable",
        intendedDisposition: "restock_sellable",
        dispositionPolicy: "automatic_sellable_restock",
      },
    ],
    ...overrides,
  };
}

function settled(status: SettledIndependentEffectSummary["status"], effectId?: string): SettledIndependentEffectSummary {
  if (status === "completed") {
    return { effectId: effectId ?? "eff-1", status: "completed" };
  }
  return { status: "not_required" };
}

function openEffect(status: IndependentEffectSummary["status"], effectId?: string): IndependentEffectSummary {
  if (status === "not_started" || status === "not_required") {
    return { status };
  }
  return { effectId: effectId ?? "eff-open", status };
}

function completedResolution(): ReturnResolution {
  return {
    returnId: RETURN_ID,
    status: "completed",
    providerRefund: settled("completed", REFUND_1),
    cashRefund: settled("not_required"),
    commercialRefund: settled("completed", "cr-1"),
    stockDisposition: settled("completed", "sd-1"),
  };
}

function uuidSequence(values: string[]): () => string {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? values[0]!;
}

const otherSale: HistoricReturnSaleView = {
  saleId: "sale-hist-2",
  orderReference: "POS-2002",
  currency: "GHS",
  lines: [{ orderLineId: "ol-9", name: "Thinner", originalSoldQuantity: "4" }],
};

function pendingResolution(
  status: "refund_pending" | "in_progress" | "requires_attention",
): ReturnResolution {
  return {
    returnId: RETURN_ID,
    status,
    providerRefund: openEffect("pending", REFUND_1),
    cashRefund: openEffect("pending", REFUND_2),
    commercialRefund: openEffect("pending", COMMERCIAL_ID),
    stockDisposition: openEffect("pending", STOCK_ID),
  };
}

function renderFlow(session: ReturnType<ReturnType<typeof createReturnController>["getSession"]>) {
  return renderToStaticMarkup(
    createElement(ReturnFlow, {
      session,
      inFlight: false,
      onUpdateLine: () => undefined,
      onPreview: () => undefined,
      onExecute: () => undefined,
      onResolve: () => undefined,
    }),
  );
}

function renderScreen(session: ReturnType<ReturnType<typeof createReturnController>["getSession"]>) {
  return renderToStaticMarkup(
    createElement(ReturnsScreen, {
      session,
      inFlight: false,
      lookup: { search: async () => [otherSale] },
      onSelectSale: () => undefined,
      onUpdateLine: () => undefined,
      onPreview: () => undefined,
      onExecute: () => undefined,
      onResolve: () => undefined,
    }),
  );
}

async function readyPreview(
  previewImpl: (input: unknown) => Promise<ApiResult<ReturnPreview>>,
) {
  const execute = vi.fn();
  const resolve = vi.fn();
  const controller = createReturnController({
    returns: { preview: previewImpl, execute, resolve },
    createUuid: uuidSequence(["k1", "c1", "k2", "c2"]),
  });
  controller.selectSale(sale);
  controller.updateLine("ol-1", { quantity: "1", reason: "Damaged in transit", condition: "damaged" });
  await controller.preview();
  return { controller, execute, resolve };
}

describe("FE-06 returns", () => {
  test("8 preview displays the authoritative refund total", async () => {
    const previewFn = vi.fn(async () => success(preview({ refundTotal: { minor: 2400, currency: "GHS" } })));
    const { controller } = await readyPreview(previewFn);
    expect(controller.getSession().refundTotal).toEqual({ minor: 2400, currency: "GHS" });
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain('data-refund-total="2400"');
    expect(html).toContain("GHS 24.00");
  });

  test("9 preview displays authoritative remaining returnable quantity", async () => {
    const previewFn = vi.fn(async () =>
      success(
        preview({
          lines: [
            {
              orderLineId: "ol-1",
              requestedQuantity: "1",
              remainingReturnableQuantity: "3",
              condition: "damaged",
              intendedDisposition: "no_automatic_restock",
              dispositionPolicy: "mandatory_no_automatic_restock",
            },
          ],
        }),
      ),
    );
    const { controller } = await readyPreview(previewFn);
    expect(controller.getSession().previewLines[0]?.remainingReturnableQuantity).toBe("3");
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain('data-remaining-qty="3"');
  });

  test("10 changing line quantity or condition invalidates a stale preview", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller } = await readyPreview(previewFn);
    expect(controller.getSession().fingerprint).toBe(FINGERPRINT);
    controller.updateLine("ol-1", { quantity: "2" });
    expect(controller.getSession().fingerprint).toBeUndefined();
    expect(controller.getSession().refundTotal).toBeUndefined();
    expect(controller.getSession().stage).toBe("selecting");
    controller.updateLine("ol-1", { condition: "quarantine" });
    expect(controller.getSession().returnId).toBeUndefined();
  });

  test("11 approval-required does not fabricate approval", async () => {
    const previewFn = vi.fn(async () => success(preview({ approvalRequired: true })));
    const { controller, execute } = await readyPreview(previewFn);
    expect(controller.getSession().approvalRequired).toBe(true);
    expect(controller.getSession().approvalId).toBeUndefined();
    expect(controller.getSession().stage).toBe("approval_required");
    execute.mockResolvedValue({
      ok: false,
      correlationId: CORRELATION,
      error: {
        code: "FORBIDDEN",
        message: "manager approval is required",
        retryable: false,
        nextAction: "contact_manager",
      },
    });
    await controller.execute();
    expect(execute).toHaveBeenCalled();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({ returnId: RETURN_ID, fingerprint: FINGERPRINT });
    expect(execute.mock.calls[0]?.[0].approvalId).toBeUndefined();
    expect(controller.getSession().stage).toBe("approval_required");
    expect(controller.getSession().approvalId).toBeUndefined();
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain("Manager approval is required before you can continue.");
    expect(html).toContain("Check approval");
    expect(html).not.toContain("Approval ID");
    expect(html).not.toContain("Technical details");
    expect(html).toContain('data-approval-id=""');
  });

  test("12 damaged never displays automatic sellable restock", async () => {
    expect(presentsAutomaticSellableRestock("damaged", "restock_sellable", "automatic_sellable_restock")).toBe(false);
    const previewFn = vi.fn(async () =>
      success(
        preview({
          lines: [
            {
              orderLineId: "ol-1",
              requestedQuantity: "1",
              remainingReturnableQuantity: "1",
              condition: "damaged",
              intendedDisposition: "restock_sellable",
              dispositionPolicy: "automatic_sellable_restock",
            },
          ],
        }),
      ),
    );
    const { controller } = await readyPreview(previewFn);
    expect(controller.getSession().previewLines[0]?.automaticSellableRestock).toBe(false);
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain('data-automatic-sellable="false"');
    expect(html).toContain("not automatically returned to sellable stock");
  });

  test("13 quarantine never displays automatic sellable restock", async () => {
    expect(presentsAutomaticSellableRestock("quarantine", "restock_sellable", "automatic_sellable_restock")).toBe(false);
    const previewFn = vi.fn(async () =>
      success(
        preview({
          lines: [
            {
              orderLineId: "ol-1",
              requestedQuantity: "1",
              remainingReturnableQuantity: "1",
              condition: "quarantine",
              intendedDisposition: "restock_sellable",
              dispositionPolicy: "automatic_sellable_restock",
            },
          ],
        }),
      ),
    );
    const { controller } = await readyPreview(previewFn);
    controller.updateLine("ol-1", { condition: "quarantine", quantity: "1", reason: "Hold" });
    await controller.preview();
    expect(controller.getSession().previewLines[0]?.automaticSellableRestock).toBe(false);
  });

  test("14 not-physically-returned never displays automatic sellable restock", async () => {
    expect(
      presentsAutomaticSellableRestock("not_physically_returned", "restock_sellable", "automatic_sellable_restock"),
    ).toBe(false);
  });

  test("15 opened_resellable and defective follow server disposition and policy", async () => {
    const previewFn = vi.fn(async () =>
      success(
        preview({
          lines: [
            {
              orderLineId: "ol-1",
              requestedQuantity: "1",
              remainingReturnableQuantity: "1",
              condition: "opened_resellable",
              intendedDisposition: "no_automatic_restock",
              dispositionPolicy: "tenant_policy_required",
            },
          ],
        }),
      ),
    );
    const { controller } = await readyPreview(previewFn);
    const line = controller.getSession().previewLines[0];
    expect(line?.intendedDisposition).toBe("no_automatic_restock");
    expect(line?.dispositionPolicy).toBe("tenant_policy_required");
    expect(line?.automaticSellableRestock).toBe(false);
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain("No automatic restock");
    expect(html).toContain("Follow the required stock action");
    expect(html).toContain('data-disposition-policy="tenant_policy_required"');
  });

  test("16 execute uses the accepted return identity and fingerprint", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute } = await readyPreview(previewFn);
    execute.mockResolvedValue(success(completedResolution()));
    await controller.execute();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual({ returnId: RETURN_ID, fingerprint: FINGERPRINT, approvalId: undefined });
  });

  test("17 ambiguous execute resolves the same returnId", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute, resolve } = await readyPreview(previewFn);
    execute.mockRejectedValue(new Error("timeout"));
    resolve.mockResolvedValue(success(completedResolution()));
    await controller.execute();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(RETURN_ID);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(controller.getSession().returnId).toBe(RETURN_ID);
  });

  test("18 pending independent effects prevent complete presentation", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute } = await readyPreview(previewFn);
    execute.mockResolvedValue(
      success({
        returnId: RETURN_ID,
        status: "refund_pending",
        providerRefund: openEffect("pending", REFUND_1),
        cashRefund: openEffect("not_required"),
        commercialRefund: openEffect("completed", "cr-1"),
        stockDisposition: openEffect("completed", "sd-1"),
      }),
    );
    await controller.execute();
    expect(controller.getSession().complete).toBe(false);
    expect(controller.getSession().stage).toBe("refund_pending");
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain('data-return-complete="false"');
    expect(html).not.toContain("data-return-complete-banner");
    expect(html).toContain("data-return-unresolved");
    expect(html).toContain("Refund — Payment — Pending");
    expect(html).not.toContain("Needs attention");
  });

  test("18b mixed return state clearly warns that cash is already refunded", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute } = await readyPreview(previewFn);
    execute.mockResolvedValue(
      success({
        returnId: RETURN_ID,
        status: "requires_attention",
        providerRefund: settled("not_required"),
        cashRefund: settled("completed", REFUND_2),
        commercialRefund: openEffect("requires_attention", COMMERCIAL_ID),
        stockDisposition: openEffect("pending", STOCK_ID),
      }),
    );
    await controller.execute();
    const html = renderFlow(controller.getSession());
    expect(html).toContain("Refund — Cash — Completed");
    expect(html).toContain("Order refund record — Needs attention");
    expect(html).toContain("Stock handling — Pending");
    expect(html).toContain("Do not refund the customer again");
    expect(html.split("Do not refund the customer again").length - 1).toBe(1);
    expect(html).not.toContain("Woo");
    expect(html).not.toContain("commercial refund");
    expect(html).not.toContain("stock disposition");
    expect(html).not.toContain("tenant policy");
    expect(html).toContain("data-return-safety");
    expect(html).not.toContain("data-return-unresolved");
  });

  test("19 completed aggregate is presented only from authoritative completed resolution", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute } = await readyPreview(previewFn);
    execute.mockResolvedValue(success(completedResolution()));
    await controller.execute();
    expect(controller.getSession().complete).toBe(true);
    expect(controller.getSession().stage).toBe("completed");
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain('data-return-complete="true"');
    expect(html).toContain("Return completed successfully.");
  });

  test("20 repeated or partial refund identities remain distinguishable", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute } = await readyPreview(previewFn);
    execute.mockResolvedValue(
      success({
        returnId: RETURN_ID,
        status: "in_progress",
        providerRefund: openEffect("pending", REFUND_1),
        cashRefund: openEffect("pending", REFUND_2),
        commercialRefund: openEffect("not_started"),
        stockDisposition: openEffect("not_started"),
      }),
    );
    await controller.execute();
    expect(controller.getSession().refundIdentities).toEqual([REFUND_1, REFUND_2]);
    const html = renderToStaticMarkup(
      createElement(ReturnFlow, {
        session: controller.getSession(),
        inFlight: false,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain(`data-refund-identity="${REFUND_1}"`);
    expect(html).toContain(`data-refund-identity="${REFUND_2}"`);
  });
});

describe("FE-06 outstanding executed return identity lock", () => {
  async function executeOutstanding(
    status: "refund_pending" | "in_progress" | "requires_attention",
  ) {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute, resolve } = await readyPreview(previewFn);
    execute.mockResolvedValue(success(pendingResolution(status)));
    await controller.execute();
    return { controller, execute, resolve };
  }

  test("1 refund_pending preserves the existing returnId", async () => {
    const { controller } = await executeOutstanding("refund_pending");
    expect(controller.getSession().returnId).toBe(RETURN_ID);
    expect(controller.getSession().fingerprint).toBe(FINGERPRINT);
    expect(controller.getSession().identityLocked).toBe(true);
    expect(controller.getSession().stage).toBe("refund_pending");
  });

  test("2 refund_pending cannot switch to another historical sale", async () => {
    const { controller } = await executeOutstanding("refund_pending");
    controller.selectSale(otherSale);
    expect(controller.getSession().saleId).toBe("sale-hist-1");
    expect(controller.getSession().returnId).toBe(RETURN_ID);
    const html = renderScreen(controller.getSession());
    expect(html).toContain('data-return-identity-locked="true"');
    expect(html).toContain("This return must be resolved before starting another return.");
    expect(html).toContain('id="return-sale-query"');
    expect(html).toMatch(/id="return-sale-query"[^>]*disabled/);
  });

  test("3 refund_pending cannot modify quantity, reason, or condition", async () => {
    const { controller } = await executeOutstanding("refund_pending");
    const before = controller.getSession().lines[0];
    controller.updateLine("ol-1", { quantity: "2", reason: "Changed mind", condition: "resellable" });
    expect(controller.getSession().lines[0]).toEqual(before);
    expect(controller.getSession().returnId).toBe(RETURN_ID);
    expect(controller.getSession().fingerprint).toBe(FINGERPRINT);
    const html = renderFlow(controller.getSession());
    expect(html).toMatch(/id="return-qty-ol-1"[^>]*disabled/);
    expect(html).toMatch(/id="return-reason-ol-1"[^>]*disabled/);
    expect(html).toMatch(/id="return-condition-ol-1"[^>]*disabled/);
    expect(html).not.toContain("Execute return");
    expect(html).toContain("Check return status");
  });

  test("4 in_progress cannot replace the return", async () => {
    const { controller, execute } = await executeOutstanding("in_progress");
    controller.selectSale(otherSale);
    controller.updateLine("ol-1", { quantity: "2" });
    await controller.execute();
    expect(controller.getSession().returnId).toBe(RETURN_ID);
    expect(controller.getSession().saleId).toBe("sale-hist-1");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(controller.getSession().identityLocked).toBe(true);
  });

  test("5 requires_attention cannot replace the return", async () => {
    const { controller, execute } = await executeOutstanding("requires_attention");
    controller.selectSale(otherSale);
    await controller.execute();
    expect(controller.getSession().returnId).toBe(RETURN_ID);
    expect(controller.getSession().stage).toBe("requires_attention");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  test("6 an unresolved failed resolve attempt preserves the outstanding return identity", async () => {
    const { controller, resolve } = await executeOutstanding("refund_pending");
    resolve.mockResolvedValue(failure("none", "Return service unavailable"));
    await controller.resolve();
    expect(controller.getSession().returnId).toBe(RETURN_ID);
    expect(controller.getSession().stage).toBe("requires_attention");
    expect(controller.getSession().identityLocked).toBe(true);
    expect(controller.getSession().complete).toBe(false);
    expect(controller.getSession().providerRefund?.effectId).toBe(REFUND_1);
  });

  test("7 repeated status checks call ReturnPort.resolve with the same returnId", async () => {
    const { controller, resolve } = await executeOutstanding("refund_pending");
    resolve.mockResolvedValue(success(pendingResolution("refund_pending")));
    await controller.resolve();
    await controller.resolve();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(resolve).toHaveBeenNthCalledWith(1, RETURN_ID);
    expect(resolve).toHaveBeenNthCalledWith(2, RETURN_ID);
  });

  test("8 no replacement ReturnPort.execute is started while that return is outstanding", async () => {
    const { controller, execute } = await executeOutstanding("refund_pending");
    await controller.execute();
    await controller.execute();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0].returnId).toBe(RETURN_ID);
  });

  test("9 independent provider, cash, commercial, and stock effect IDs remain visible while unresolved", async () => {
    const { controller } = await executeOutstanding("in_progress");
    controller.selectSale(otherSale);
    controller.updateLine("ol-1", { quantity: "9" });
    const session = controller.getSession();
    expect(session.providerRefund?.effectId).toBe(REFUND_1);
    expect(session.cashRefund?.effectId).toBe(REFUND_2);
    expect(session.commercialRefund?.effectId).toBe(COMMERCIAL_ID);
    expect(session.stockDisposition?.effectId).toBe(STOCK_ID);
    const html = renderFlow(session);
    expect(html).toContain(`data-effect-id="${REFUND_1}"`);
    expect(html).toContain(`data-effect-id="${REFUND_2}"`);
    expect(html).toContain(`data-effect-id="${COMMERCIAL_ID}"`);
    expect(html).toContain(`data-effect-id="${STOCK_ID}"`);
  });

  test("10 after authoritative completed, a new historical return may be selected", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute } = await readyPreview(previewFn);
    execute.mockResolvedValue(success(completedResolution()));
    await controller.execute();
    expect(controller.getSession().identityLocked).toBe(false);
    controller.selectSale(otherSale);
    expect(controller.getSession().saleId).toBe("sale-hist-2");
    expect(controller.getSession().returnId).toBeUndefined();
    expect(controller.getSession().stage).toBe("selecting");
    expect(controller.getSession().identityLocked).toBe(false);
  });

  test("11 pre-effect preview editing still works", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller } = await readyPreview(previewFn);
    expect(controller.getSession().stage).toBe("previewed");
    expect(controller.getSession().identityLocked).toBe(false);
    controller.updateLine("ol-1", { quantity: "2", reason: "Opened", condition: "opened_resellable" });
    expect(controller.getSession().stage).toBe("selecting");
    expect(controller.getSession().lines[0]?.quantity).toBe("2");
    expect(controller.getSession().lines[0]?.condition).toBe("opened_resellable");
    const html = renderFlow(controller.getSession());
    expect(html).not.toMatch(/id="return-qty-ol-1"[^>]*disabled/);
  });

  test("12 changing intent before execute still invalidates stale preview and fingerprint", async () => {
    const previewFn = vi.fn(async () => success(preview()));
    const { controller, execute } = await readyPreview(previewFn);
    expect(controller.getSession().fingerprint).toBe(FINGERPRINT);
    controller.updateLine("ol-1", { condition: "quarantine" });
    expect(controller.getSession().fingerprint).toBeUndefined();
    expect(controller.getSession().returnId).toBeUndefined();
    expect(controller.getSession().refundTotal).toBeUndefined();
    await controller.execute();
    expect(execute).not.toHaveBeenCalled();
  });
});
