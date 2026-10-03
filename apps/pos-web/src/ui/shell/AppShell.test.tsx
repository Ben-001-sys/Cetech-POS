import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, test, vi } from "vitest";
import { AppShell } from "./AppShell";
import { TopBar, type TopBarProps } from "./TopBar";
import { PRIMARY_NAV_ITEMS, POS_ROUTE_HREFS } from "./routes";

function renderShell(activeRoute: "sell" | "settings" = "sell") {
  return renderToStaticMarkup(
    <AppShell
      activeRoute={activeRoute}
      registerName="Front Counter 1"
      cashierDisplayName="Staff member"
      shiftOpen
      online
      attentionCount={2}
      liveMessage="Ready"
    >
      <p>Workspace</p>
    </AppShell>,
  );
}

describe("AppShell", () => {
  test("keeps cashier primary navigation operational and leaves System status outside it", () => {
    const html = renderShell();
    expect(html).toContain("Skip to main content");
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('aria-label="App sidebar"');
    expect(html).toContain('aria-label="Primary navigation"');
    expect(html).toContain("<header");
    expect(html).toContain("<main");
    expect(html).toContain("<nav");
    expect(html).toContain("<aside");
    expect(html).toContain('id="main-content"');
    expect(html).toContain("CETECH POS");
    expect(html).toContain("Front Counter 1");
    expect(html).toContain("Shift open");
    expect(html).toContain("Online");
    for (const item of PRIMARY_NAV_ITEMS) {
      expect(html).toContain(`data-route="${item.route}"`);
      expect(html).toContain(`data-href="${POS_ROUTE_HREFS[item.route]}"`);
      expect(html).toContain(item.label);
    }
    expect(html).not.toContain('data-route="health"');
    expect(html.match(/data-route="settings"/g)).toHaveLength(1);
    expect(html).not.toContain("sidebar-bottom");
    expect(html).toContain("Attention");
    expect(html).toContain("2");
    expect(html).not.toContain("Demo controls");
  });

  test("marks the active route for assistive technology", () => {
    const html = renderShell("settings");
    expect(html).toContain('data-route="settings"');
    expect(html).toContain('aria-current="page"');
  });

  test("exposes a polite live region", () => {
    const html = renderShell();
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Ready");
  });

  test("uses the existing attention navigation for the compact header action", () => {
    const onNavigate = vi.fn();
    const tree = AppShell({ activeRoute: "sell", attentionCount: 2, onNavigate, children: <p>Workspace</p> });
    const main = tree.props.children.find((element: ReactElement<{ className?: string }>) => element.props.className === "app-main");
    const header = main.props.children.find((element: ReactElement<TopBarProps> | null) => element?.type === TopBar);
    expect(header.props.attentionCount).toBe(2);
    header.props.onOpenAttention();
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith("attention");
    expect(renderToStaticMarkup(tree)).toContain('aria-label="Needs attention 2"');
    const empty = renderToStaticMarkup(<AppShell activeRoute="sell" attentionCount={0}><p>Workspace</p></AppShell>);
    expect(empty).not.toContain("mobile-attention");
  });
});
