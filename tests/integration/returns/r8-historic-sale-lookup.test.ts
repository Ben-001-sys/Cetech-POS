import { describe, expect, test } from "vitest";
import { createReturnController } from "../../../apps/pos-web/src/features/returns/returnController";
import { createBrowserHistoricReturnSaleLookup } from "../../../apps/pos-web/src/app/returns-runtime";
import { createBrowserReturnPort } from "../../../apps/pos-web/src/app/checkout-client";
import { handleGetHistoricReturnSale } from "../../../apps/pos-web/src/server/returns/handle-get-historic-return-sale";
import { handlePreviewReturn } from "../../../apps/pos-web/src/server/returns/handle-preview-return";
import { createMemoryOperationalPolicyStore } from "../../../apps/pos-web/src/server/admin/operational-policy-store";
import { projectHistoricReturnSale } from "../../../apps/pos-web/src/server/returns/historic-sale-projection";
import {
  CORRELATION,
  CSRF,
  DEVICE_ID,
  FINGERPRINT,
  LINE_1,
  NOW,
  ORIGIN,
  TX_A,
  cashierAssignments,
  createRt01Runtime,
  ghs,
  staffCookies,
} from "./helpers";

function fabricatedReceiptIdentity(saleId: string, index = 0): string {
  return `${saleId}:receipt:${index}`;
}

async function lookupHistoric(
  runtime: Awaited<ReturnType<typeof createRt01Runtime>>,
  input: {
    readonly saleKey: string;
    readonly cookieHeader: string;
    readonly sessionStore: Awaited<ReturnType<typeof staffCookies>>["store"];
    readonly assignments?: ReturnType<typeof cashierAssignments>;
  },
) {
  return handleGetHistoricReturnSale({
    correlationIdHeader: CORRELATION,
    origin: ORIGIN,
    referer: null,
    cookieHeader: input.cookieHeader,
    csrfHeader: CSRF,
    saleKey: input.saleKey,
    now: NOW,
    sessionStore: input.sessionStore,
    allowedOrigins: [ORIGIN],
    checkoutStore: runtime.checkoutStore,
    returnStore: runtime.returnStore,
    assignments: input.assignments ?? cashierAssignments(),
  });
}

describe("R8-02 historic return-sale lookup", () => {
  test("production lookup returns durable orderLineId and real preview accepts it", async () => {
    const runtime = await createRt01Runtime();
    const durable = await runtime.checkoutStore.getSaleBySaleId("org_a", "woo-rt01");
    expect(durable?.status).toBe("completed");
    const durableOrderLineId = durable?.orderLines?.[0]?.orderLineId;
    expect(durableOrderLineId).toBe(LINE_1);
    expect(durableOrderLineId).not.toBe(fabricatedReceiptIdentity("woo-rt01"));

    const projected = projectHistoricReturnSale(durable!);
    expect(projected?.lines[0]?.orderLineId).toBe(LINE_1);
    expect(projected?.lines[0]?.orderLineId).not.toContain(":receipt:");

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      const common = {
        correlationIdHeader: headers.get("x-correlation-id") ?? CORRELATION,
        origin: ORIGIN,
        referer: null as string | null,
        cookieHeader: runtime.sessions.cookieHeader,
        csrfHeader: headers.get("x-csrf-token") || CSRF,
        now: NOW,
        sessionStore: runtime.sessions.store,
        allowedOrigins: [ORIGIN],
        checkoutStore: runtime.checkoutStore,
        returnStore: runtime.returnStore,
        assignments: cashierAssignments(),
      };
      if (url.includes("/api/pos/v1/returns/history/")) {
        const encoded = url.slice(url.indexOf("/history/") + "/history/".length);
        const result = await handleGetHistoricReturnSale({
          ...common,
          saleKey: decodeURIComponent(encoded.split("?")[0] ?? ""),
        });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/pos/v1/returns/preview")) {
        const result = await handlePreviewReturn({
          ...common,
          body: init?.body ? JSON.parse(String(init.body)) : null,
          returnStore: runtime.returnStore,
          policies: createMemoryOperationalPolicyStore(),
        });
        return new Response(JSON.stringify(result.body), {
          status: result.status,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected lookup/preview url ${url}`);
    };

    Object.defineProperty(globalThis, "document", {
      value: { cookie: runtime.sessions.cookieHeader },
      configurable: true,
    });

    const lookup = createBrowserHistoricReturnSaleLookup({ fetchImpl });
    const matches = await lookup.search("woo-rt01");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.lines[0]?.orderLineId).toBe(durableOrderLineId);
    expect(matches[0]?.lines[0]?.orderLineId).not.toBe(fabricatedReceiptIdentity("woo-rt01"));
    expect(matches[0]?.saleId).toBe("woo-rt01");

    const controller = createReturnController({
      returns: createBrowserReturnPort({ fetchImpl }),
    });
    controller.selectSale(matches[0]!);
    controller.updateLine(durableOrderLineId!, {
      quantity: "1",
      reason: "customer changed mind",
      condition: "resellable",
    });
    await controller.preview();
    const session = controller.getSession();
    expect(session.stage).toBe("previewed");
    expect(session.previewLines[0]?.orderLineId).toBe(LINE_1);
    expect(session.refundTotal?.minor).toBe(1500);
  });

  test("same-organization allowed-location cashier can view completed sale", async () => {
    const runtime = await createRt01Runtime();
    const result = await lookupHistoric(runtime, {
      saleKey: "woo-rt01",
      cookieHeader: runtime.sessions.cookieHeader,
      sessionStore: runtime.sessions.store,
    });
    expect(result.body.ok).toBe(true);
    if (!result.body.ok) {
      return;
    }
    expect(result.body.data.lines[0]?.orderLineId).toBe(LINE_1);
  });

  test("different organization cannot view completed sale", async () => {
    const runtime = await createRt01Runtime();
    const outsider = await staffCookies({
      actorId: "cashier_b",
      displayName: "Cashier B",
      organizationId: "org_b",
      locationIds: ["loc_b1"],
    });
    const result = await lookupHistoric(runtime, {
      saleKey: TX_A,
      cookieHeader: outsider.cookieHeader,
      sessionStore: outsider.store,
    });
    expect(result.body.ok).toBe(false);
    if (result.body.ok) {
      return;
    }
    expect(result.body.error.code).toBe("NOT_FOUND");
  });

  test("unauthorized location cannot view completed sale", async () => {
    const runtime = await createRt01Runtime();
    const otherLocation = await staffCookies({
      actorId: "cashier_a",
      displayName: "Cashier A",
      organizationId: "org_a",
      locationIds: ["loc_a2"],
    });
    const result = await lookupHistoric(runtime, {
      saleKey: TX_A,
      cookieHeader: otherLocation.cookieHeader,
      sessionStore: otherLocation.store,
      assignments: cashierAssignments(["reg_b1"], "loc_a2"),
    });
    expect(result.body.ok).toBe(false);
    if (result.body.ok) {
      return;
    }
    expect(result.body.error.code).toBe("FORBIDDEN");
  });

  test("non-completed sale is not exposed as returnable history", async () => {
    const runtime = await createRt01Runtime();
    const lineTotal = ghs(3000);
    await runtime.checkoutStore.seedPreparedSale({
      organizationId: "org_a",
      locationId: "loc_a1",
      locationName: "Accra Store",
      registerId: "reg_a1",
      registerName: "Register 1",
      deviceId: DEVICE_ID,
      shiftId: runtime.shiftId,
      cashierId: "cashier_a",
      cashierName: "Cashier A",
      customer: { kind: "walkin" },
      customerLabel: "Walk-in",
      prepared: {
        transactionId: "11111111-1111-4111-8111-111111111499",
        saleId: "woo-open-01",
        orderReference: "woo-open-01",
        quoteFingerprint: FINGERPRINT,
        total: lineTotal,
        status: "prepared",
        stockCommitment: "reserved",
        preparedAt: "2026-09-15T13:00:00.000Z",
        expiresAt: "2026-09-15T18:00:00.000Z",
      },
      lines: [
        {
          name: "Hardener",
          quantity: "2",
          unitPrice: lineTotal,
          subtotal: lineTotal,
          discount: ghs(0),
          tax: ghs(0),
          total: lineTotal,
        },
      ],
      orderLines: [
        {
          orderLineId: LINE_1,
          quantity: "2",
          subtotal: lineTotal,
          discount: ghs(0),
          tax: ghs(0),
          total: lineTotal,
        },
      ],
      quoteId: "quote-open-1",
      subtotal: lineTotal,
      discount: ghs(0),
      tax: ghs(0),
    });
    const result = await lookupHistoric(runtime, {
      saleKey: "woo-open-01",
      cookieHeader: runtime.sessions.cookieHeader,
      sessionStore: runtime.sessions.store,
    });
    expect(result.body.ok).toBe(false);
    if (result.body.ok) {
      return;
    }
    expect(result.body.error.code).toBe("NOT_FOUND");
  });

  test("unknown sale returns NOT_FOUND without leaking existence", async () => {
    const runtime = await createRt01Runtime();
    const result = await lookupHistoric(runtime, {
      saleKey: "woo-missing",
      cookieHeader: runtime.sessions.cookieHeader,
      sessionStore: runtime.sessions.store,
    });
    expect(result.body.ok).toBe(false);
    if (result.body.ok) {
      return;
    }
    expect(result.body.error.code).toBe("NOT_FOUND");
  });

  test("fabricated receipt-position identity is rejected by real preview", async () => {
    const runtime = await createRt01Runtime();
    const result = await handlePreviewReturn({
      correlationIdHeader: CORRELATION,
      origin: ORIGIN,
      referer: null,
      cookieHeader: runtime.sessions.cookieHeader,
      csrfHeader: CSRF,
      body: {
        saleId: "woo-rt01",
        lines: [
          {
            orderLineId: fabricatedReceiptIdentity("woo-rt01"),
            quantity: "1",
            reason: "customer changed mind",
            condition: "resellable",
          },
        ],
      },
      now: NOW,
      sessionStore: runtime.sessions.store,
      allowedOrigins: [ORIGIN],
      checkoutStore: runtime.checkoutStore,
      returnStore: runtime.returnStore,
      assignments: cashierAssignments(),
      policies: createMemoryOperationalPolicyStore(),
    });
    expect(result.body.ok).toBe(false);
    if (result.body.ok) {
      return;
    }
    expect(result.body.error.code).toBe("VALIDATION_ERROR");
  });
});
