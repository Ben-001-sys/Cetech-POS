import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { ManagementLoading, type ManagementLoadingVariant } from "./ManagementLoading";
import { AuditPanel } from "./AuditPanel";
import { PolicyPanel } from "./PolicyPanel";
import { ShiftCashPanel } from "./ShiftCashPanel";
import { SystemHealthPanel } from "./SystemHealthPanel";

const variants: readonly ManagementLoadingVariant[] = [
  "system-health", "staff", "topology", "policy", "audit", "shifts", "returns", "receipt",
];

describe("management loading layouts", () => {
  test.each(variants)("%s keeps the announcement separate from decorative busy content", (variant) => {
    const html = renderToStaticMarkup(<ManagementLoading variant={variant} message="Loading saved data…" />);
    expect(html).toMatch(/^<section[^>]*aria-live="polite"[^>]*>/);
    expect(html.match(/^<section[^>]*>/)?.[0]).not.toContain("aria-busy");
    expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('aria-busy="true"'));
    expect(html).toContain('<div aria-hidden="true" aria-busy="true">');
    expect(html).not.toMatch(/<(?:button|input|select|textarea|a)\b/);
    expect(html).not.toMatch(/GHS|Working|Unavailable|Pending|Completed/);
    expect(html).not.toContain('class="management-loading-summary"');
  });

  test("system status anticipates a banner and stacked checks instead of operational metrics", () => {
    const html = renderToStaticMarkup(<SystemHealthPanel view={null} loading />);
    expect(html).toContain('data-management-loading="system-health"');
    expect(html).toContain('class="banner management-skeleton-banner"');
    expect(html).toContain('class="system-health-list"');
    expect(html.match(/system-health-card/g)).toHaveLength(3);
    expect(html).not.toContain("-summary");
  });

  test("only shifts and returns anticipate four operational summary cards", () => {
    for (const variant of variants) {
      const html = renderToStaticMarkup(<ManagementLoading variant={variant} message="Loading…" />);
      const hasSummary = /class="(?:shift-cash|returns-attention)-summary"/.test(html);
      expect(hasSummary).toBe(variant === "shifts" || variant === "returns");
      if (hasSummary) expect(html.match(/<li\b/g)).toHaveLength(4);
    }
    expect(renderToStaticMarkup(<ShiftCashPanel view={null} loading />)).toContain('data-management-loading="shifts"');
  });

  test("policy and audit loaders use the same form and event wrappers as their loaded panels", () => {
    const policy = renderToStaticMarkup(<PolicyPanel view={null} loading />);
    expect(policy).toContain('data-management-loading="policy"');
    expect(policy).toContain('class="card card-pad stack management-policy"');
    expect(policy).toContain('class="management-policy-row"');
    const audit = renderToStaticMarkup(<AuditPanel view={null} loading />);
    expect(audit).toContain('data-management-loading="audit"');
    expect(audit).toContain('class="management-audit-list"');
    expect(audit).not.toContain("management-grid");
  });

  test.each(["staff", "topology"] as const)("%s reserves creation space only when creation is available", (variant) => {
    const readOnly = renderToStaticMarkup(<ManagementLoading variant={variant} message="Loading…" />);
    const editable = renderToStaticMarkup(<ManagementLoading variant={variant} message="Loading…" showCreate />);
    expect(readOnly).not.toContain("management-topology-create");
    expect(editable).toContain("management-topology-create");
    if (variant === "topology") expect(readOnly).toContain('class="management-grid"');
    else expect(readOnly).toContain('class="management-staff-list"');
  });

  test("receipt settings reserves the responsive editor and preview columns", () => {
    const html = renderToStaticMarkup(<ManagementLoading variant="receipt" message="Loading receipt settings…" />);
    expect(html).toContain('class="receipt-settings-grid"');
    expect(html).toContain('class="receipt-settings-fields stack"');
    expect(html).toContain('class="receipt-settings-preview stack"');
    expect(html).toContain('class="receipt-settings-preview-paper"');
  });
});
