import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ManagementReturnsAttentionItem, ManagementReturnsAttentionView } from "../../server/admin/management-returns-attention-directory";
import { ManagementScreen } from "./ManagementScreen";
import { ManagementReturnDetail, ReturnsApprovalsPanel } from "./ReturnsApprovalsPanel";
import type { ManagementReturnDetailView } from "../../server/admin/handle-management-return-detail";

function item(
  overrides: Partial<ManagementReturnsAttentionItem> & Pick<ManagementReturnsAttentionItem, "id" | "category" | "priority" | "statusLabel">,
): ManagementReturnsAttentionItem {
  return {
    intervention: "required",
    organizationId: "org_a",
    locationId: "loc_a1",
    locationName: "Accra Main Store and Service Counter — North Ridge Industrial",
    registerName: "Front Register A — Express Lane",
    persistedStatus: "requires_attention",
    summary: "This return did not finish cleanly.",
    nextAction: "Review the existing return. Do not start a replacement return for the same sale.",
    updatedAt: "2026-09-22T12:00:00.000Z",
    ...overrides,
  };
}

function view(rows: readonly ManagementReturnsAttentionItem[]): ManagementReturnsAttentionView {
  return {
    scope: { kind: "locations", locationIds: ["loc_a1"] },
    limit: 40,
    truncated: false,
    rows,
  };
}

function render(props: Partial<Parameters<typeof ReturnsApprovalsPanel>[0]> = {}) {
  return renderToStaticMarkup(<ReturnsApprovalsPanel view={view([])} {...props} />);
}

describe("ReturnsApprovalsPanel", () => {
  test("shows a return that needs attention without cashier controls", () => {
    const html = render({
      view: view([item({
        id: "return:1",
        category: "return",
        priority: "needs_attention",
        statusLabel: "Return needs attention",
        returnId: "33333333-3333-4333-8333-333333333333",
        saleId: "sale_attention",
        amount: { minor: 150000, currency: "GHS" },
      })]),
    });
    expect(html).toContain("Return needs attention");
    expect(html).toContain("Accra Main Store and Service Counter — North Ridge Industrial");
    expect(html).toContain("Front Register A — Express Lane");
    expect(html).toContain("Needs review");
    expect(html).toContain("GHS");
    expect(html).toContain("status-pill danger");
    expect(html).toContain('data-layout="attention-card"');
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Pay");
    expect(html).not.toContain("IndexedDB");
    expect(html).not.toContain(">Approved<");
    expect(html).not.toContain(">Rejected<");
  });

  test("shows refund reconciliation as pending review rather than a new refund", () => {
    const html = render({
      view: view([item({
        id: "refund:1",
        category: "refund_reconciliation",
        priority: "awaiting_reconciliation",
        intervention: "blocked",
        statusLabel: "Refund check needed",
        summary: "This refund is still pending.",
        nextAction: "Check the existing refund. Do not start another refund.",
        refundId: "55555555-5555-4555-8555-555555555555",
        amount: { minor: 2500, currency: "GHS" },
      })]),
    });
    expect(html).toContain("Refund check needed");
    expect(html).toContain("Waiting for confirmation");
    expect(html).toContain("Do not start another refund");
    expect(html).toContain("status-pill warning");
    expect(html).not.toContain("Refund now");
  });

  test("shows a completed return as informational", () => {
    const html = render({
      view: view([item({
        id: "return:done",
        category: "return",
        priority: "informational",
        intervention: "informational",
        persistedStatus: "completed",
        statusLabel: "Return completed",
        summary: "This return is completed.",
        nextAction: "No action is needed from this screen.",
      })]),
    });
    expect(html).toContain("Return completed");
    expect(html).toContain("No action needed");
    expect(html).not.toContain("status-pill danger");
    expect(html).not.toContain("Needs review");
  });

  test("renders more than one kind of work", () => {
    const html = render({
      view: view([
        item({ id: "return:1", category: "return", priority: "needs_attention", statusLabel: "Return needs attention" }),
        item({
          id: "stock:1",
          category: "stock_disposition",
          priority: "needs_attention",
          statusLabel: "Stock update needs attention",
          summary: "Stock update is recorded separately from the customer return and the payment refund.",
          nextAction: "Do not create another stock update from this screen.",
        }),
      ]),
    });
    expect(html).toContain('data-attention-category="return"');
    expect(html).toContain('data-attention-category="stock_disposition"');
    expect(html).toContain("Stock update needs attention");
  });

  test("empty authorized scope is not an error", () => {
    const html = render({ view: view([]) });
    expect(html).toContain("No returns or refunds need attention in your management scope.");
    expect(html).toContain("Showing returns and refunds only for locations you manage.");
    expect(html).not.toContain("temporarily unavailable");
  });

  test("server unavailability is an error state", () => {
    const html = render({
      view: null,
      errorMessage: "returns and approvals are unavailable",
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(html).toContain("Returns and approvals are temporarily unavailable.");
    expect(html).toContain("Reference aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(html).not.toContain("No returns or refunds need attention");
  });

  test("renders only the authorized rows it was given", () => {
    const html = render({
      view: view([item({
        id: "return:mine",
        category: "return",
        priority: "pending",
        statusLabel: "Approval required",
        locationName: "Accra Main Store",
        summary: "This return is stored as requiring approval before it can execute.",
        nextAction: "Approve return when you are the operational manager at this location.",
      })]),
    });
    expect(html).toContain("Accra Main Store");
    expect(html).toContain("Showing returns and refunds for Accra Main Store.");
    expect(html).not.toContain("Tema Harbour");
    expect(html).not.toContain("Grant approval");
  });

  test("exposes exact existing-return review and only server-permitted approval/refund buttons", () => {
    const html = render({
      view: view([
        item({ id: "approval:a", category: "return", priority: "pending", statusLabel: "Approval required", approvalState: "required", canApprove: true, canReview: true, returnId: "33333333-3333-4333-8333-333333333333" }),
        item({ id: "refund:a", category: "refund_reconciliation", priority: "awaiting_reconciliation", statusLabel: "Refund check needed", canReconcile: true, refundId: "55555555-5555-4555-8555-555555555555" }),
      ]),
      onReviewReturn: async () => { throw new Error("render does not read or mutate"); },
    });
    expect(html).toContain("Review existing return");
    expect(html).toContain(">Approve return<");
    expect(html).toContain(">Check refund<");
    expect(html).toContain("Counts are work items");
  });

  test("expired preview has history wording, no approval button and a clear next step", () => {
    const html = render({ view: view([item({
      id: "preview:expired", category: "return", priority: "informational", intervention: "informational",
      statusLabel: "Return preview expired", persistedStatus: "previewed", previewState: "expired",
      previewExpiresAt: "2026-10-02T06:00:00.000Z", canApprove: false, canReview: true,
      actionUnavailableReason: "This preview has expired and cannot be approved or completed. Review the original sale again in Returns.",
      returnId: "33333333-3333-4333-8333-333333333333",
    })]), onReviewReturn: async () => { throw new Error("not called"); } });
    expect(html).toContain("Return preview expired");
    expect(html).toContain("cannot be approved or completed");
    expect(html).toContain("History");
    expect(html).not.toContain(">Approve return<");
    expect(html).toContain("Review existing return");
  });

  test("read-only detail renders original lines and separate persisted effect state", () => {
    const detail: ManagementReturnDetailView = {
      returnId: "33333333-3333-4333-8333-333333333333", saleId: "sale_a", saleReference: "Order 123",
      locationId: "loc_a1", registerId: "reg_a", persistedStatus: "requires_attention",
      statusLabel: "Return needs attention", refundTotal: { minor: 999, currency: "GHS" },
      previewExpiresAt: "2026-10-02T06:00:00.000Z", executed: true, canApprove: false, namesAvailable: true,
      lines: [{ orderLineId: "line_a", name: "Original saved product name", quantity: "1", reason: "Damaged packaging", condition: "damaged", intendedDisposition: "no_automatic_restock", allocatedAmount: { minor: 999, currency: "GHS" } }],
      effects: [
        { kind: "cash_refund", label: "Cash refund", effectId: "55555555-5555-4555-8555-555555555555", status: "verified", amount: { minor: 999, currency: "GHS" } },
        { kind: "stock_disposition", label: "Stock handling", effectId: "77777777-7777-4777-8777-777777777777", status: "requires_attention", message: "Remote stock record needs review." },
      ],
    };
    const html = renderToStaticMarkup(<ManagementReturnDetail detail={detail} />);
    expect(html).toContain(`data-return-detail="${detail.returnId}"`);
    expect(html).toContain("Original saved product name");
    expect(html).toContain("Damaged packaging");
    expect(html).toContain("Cash refund · Completed");
    expect(html).toContain("Stock handling · Needs review");
    expect(html).toContain("Remote stock record needs review.");
    expect(html).toContain("does not send a refund or change stock");
    expect(html).not.toContain(">Approve return<");
    expect(html).not.toContain("Complete return");
  });

  test("management screen replaces the returns placeholder", () => {
    const html = renderToStaticMarkup(
      <ManagementScreen
        context={{
          actorId: "manager_a",
          displayName: "Ama Mensah — Store Manager",
          organizationId: "org_a",
          controlRole: null,
          managerLocationIds: ["loc_a1"],
          locationRoles: [{ locationId: "loc_a1", role: "manager" }],
          sections: ["overview", "returns_approvals"],
        }}
        activeSection="returns_approvals"
        onBackToPos={() => undefined}
        returnsAttentionView={view([item({
          id: "return:1",
          category: "return",
          priority: "needs_attention",
          statusLabel: "Return needs attention",
          locationName: "Accra Main Store",
        })])}
      />,
    );
    expect(html).toContain("Ama Mensah — Store Manager");
    expect(html).toContain("Return needs attention");
    expect(html).toContain("Back to POS");
    expect(html).not.toContain("Foundation screen only");
  });
});
