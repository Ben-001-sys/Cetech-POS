import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ReturnsScreen } from "./ReturnsScreen";
import { idleReturnSession, type HistoricReturnSaleView } from "./returnView";

const sale: HistoricReturnSaleView = {
  saleId: "sale-24091",
  orderReference: "#24091",
  currency: "GHS",
  customerLabel: "Accra Buildworks Ltd",
  createdAt: "2026-09-10T15:12:00.000Z",
  total: { minor: 115000, currency: "GHS" },
  itemSummary: "2 × Premium Interior Emulsion Paint 20L",
  lines: [{ orderLineId: "ol-1", name: "Premium Interior Emulsion Paint 20L", originalSoldQuantity: "2" }],
};

describe("Returns discovery", () => {
  test("renders search-first cards without entering ReturnFlow until a sale is selected", () => {
    const html = renderToStaticMarkup(
      createElement(ReturnsScreen, {
        session: idleReturnSession(),
        inFlight: false,
        lookup: { async search() { return [sale]; } },
        matches: [sale],
        onSelectSale: () => undefined,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain("Find order, customer or receipt");
    expect(html).toContain("#24091");
    expect(html).toContain("Accra Buildworks Ltd");
    expect(html).toContain("Return items");
    expect(html).not.toContain("Look up sale");
    expect(html).not.toContain("Original sale");
  });

  test("selected return flow is above discovery cards and the selected sale is explicit", () => {
    const selected = {
      ...idleReturnSession(),
      stage: "selecting" as const,
      saleId: sale.saleId,
      lines: sale.lines.map((line) => ({
        ...line,
        quantity: "0",
        reason: "",
        condition: "resellable" as const,
      })),
    };
    const html = renderToStaticMarkup(
      createElement(ReturnsScreen, {
        session: selected,
        inFlight: false,
        lookup: { async search() { return [sale]; } },
        matches: [sale],
        onSelectSale: () => undefined,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );

    const flowIndex = html.indexOf('data-selected-return-flow="sale-24091"');
    const gridIndex = html.indexOf('class="returns-card-grid"');
    expect(flowIndex).toBeGreaterThanOrEqual(0);
    expect(gridIndex).toBeGreaterThanOrEqual(0);
    expect(flowIndex).toBeLessThan(gridIndex);
    expect(html).toContain('data-selected-sale="true"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("Select return items");
  });

  test("a locked return hides other sales so another return cannot be started", () => {
    const locked = {
      ...idleReturnSession(),
      stage: "requires_attention" as const,
      saleId: sale.saleId,
      returnId: "ret-1",
      identityLocked: true,
      lines: sale.lines.map((line) => ({
        ...line,
        quantity: "1",
        reason: "Damaged",
        condition: "damaged" as const,
      })),
    };
    const html = renderToStaticMarkup(
      createElement(ReturnsScreen, {
        session: locked,
        inFlight: false,
        lookup: { async search() { return [sale]; } },
        matches: [sale],
        onSelectSale: () => undefined,
        onUpdateLine: () => undefined,
        onPreview: () => undefined,
        onExecute: () => undefined,
        onResolve: () => undefined,
      }),
    );
    expect(html).toContain("data-discovery-collapsed");
    expect(html).not.toContain("returns-card-grid");
    expect(html).toContain("disabled");
  });
});
