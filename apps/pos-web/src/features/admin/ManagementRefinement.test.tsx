import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ManagementContext } from "../../server/admin/management-context";
import type { ManagementLocation } from "../../server/admin/management-topology-directory";
import { ManagementScreen } from "./ManagementScreen";
import { ManagementLoading } from "./ManagementLoading";
import { TopologyPanel } from "./TopologyPanel";

const support: ManagementContext = {
  actorId: "support_a",
  displayName: "Support Desk",
  organizationId: "org_a",
  controlRole: "support",
  managerLocationIds: [],
  locationRoles: [],
  sections: ["overview", "system_health", "audit"],
};

const locations: readonly ManagementLocation[] = [{
  id: "loc_a1",
  name: "Main store",
  status: "active",
  registers: [],
  devices: [],
}];

describe("Management presentation boundaries", () => {
  test("grouped navigation and overview actions remain limited to allowed sections", () => {
    const html = renderToStaticMarkup(
      <ManagementScreen context={support} activeSection="system_health" onSelectSection={() => undefined} />,
    );
    const navigation = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(navigation).toContain("Workspace");
    expect(navigation).toContain("Support");
    expect(navigation).toContain('aria-current="page"');
    expect(navigation).toContain("System status");
    expect(navigation).not.toContain("Staff &amp; access");
    expect(navigation).not.toContain("Operational rules");
    expect(navigation).not.toContain("Receipt settings");
    const overview = renderToStaticMarkup(
      <ManagementScreen context={support} onSelectSection={() => undefined} />,
    );
    expect(overview).not.toContain("View staff &amp; access");
    expect(overview).not.toContain("View operational rules");
  });

  test("initial loading announces the state and offers no fabricated values or controls", () => {
    const html = renderToStaticMarkup(<ManagementLoading variant="shifts" message="Loading shifts and cash…" />);
    // Loading text must not sit under a busy ancestor, which may defer announcements.
    const outerRegion = html.match(/^<section[^>]*>/)?.[0];
    const announcement = html.match(/<p[^>]*role="status"[^>]*>[^<]*<\/p>/)?.[0];
    expect(outerRegion).not.toContain('aria-busy="true"');
    expect(announcement).toContain("Loading shifts and cash…");
    expect(announcement).not.toContain('aria-busy="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Loading shifts and cash…");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("GHS");
  });

  test("topology form styling retains read-only restrictions and saving lock", () => {
    const readOnly = renderToStaticMarkup(<TopologyPanel rows={locations} mode="locations" />);
    expect(readOnly).toContain("organization owner or admin");
    expect(readOnly).not.toContain("<input");
    expect(readOnly).not.toContain("Save location");
    const saving = renderToStaticMarkup(
      <TopologyPanel rows={locations} mode="locations" canManage saving onSave={() => undefined} />,
    );
    expect(saving).toContain('class="input"');
    expect(saving).toContain('aria-busy="true"');
    expect(saving).toContain("Saving…");
    expect(saving).toContain('disabled=""');
  });
});
