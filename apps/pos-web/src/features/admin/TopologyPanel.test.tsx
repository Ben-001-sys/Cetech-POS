import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TopologyPanel } from "./TopologyPanel";

const rows = [{
  id: "loc_a", name: "Main shop", status: "active" as const,
  registers: [{ id: "reg_a", name: "Front counter", currency: "GHS", status: "active" as const }],
  devices: [{ id: "device-a", label: "Tablet", status: "active" as const }],
}] as const;

describe("topology lifecycle actions", () => {
  test.each([
    ["locations", "Deactivate location"], ["registers", "Disable register"], ["devices", "Deactivate device"],
  ] as const)("%s exposes the history-preserving action only to administrators", (mode, label) => {
    const editable = renderToStaticMarkup(<TopologyPanel rows={rows} mode={mode} canManage onSave={() => undefined} />);
    expect(editable).toContain(label);
    expect(editable).toContain("Sales, receipts, staff assignments and history are kept.");
    const readOnly = renderToStaticMarkup(<TopologyPanel rows={rows} mode={mode} />);
    expect(readOnly).not.toContain(`>${label}</button>`);
    expect(readOnly).not.toContain("<input");
    expect(readOnly).toContain("An organization owner or admin can make these changes.");
  });

  test("inactive entries remain visible with reactivation actions", () => {
    const inactive = [{ ...rows[0], status: "inactive" as const,
      registers: [{ ...rows[0].registers[0], status: "disabled" as const }],
      devices: [{ ...rows[0].devices[0], status: "inactive" as const }],
    }];
    for (const [mode, label] of [["locations", "Reactivate location"], ["registers", "Reactivate register"], ["devices", "Reactivate device"]] as const) {
      const html = renderToStaticMarkup(<TopologyPanel rows={inactive} mode={mode} canManage onSave={() => undefined} />);
      expect(html).toContain(label);
    }
  });

  test("a blocked save keeps the editable rows and retry controls visible", () => {
    const html = renderToStaticMarkup(<TopologyPanel rows={rows} mode="locations" canManage onSave={() => undefined} errorMessage="Close the affected shift first." />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Close the affected shift first.");
    expect(html).toContain("Main shop");
    expect(html).toContain("Save location");
    expect(html).toContain("Deactivate location");
  });

  test("saving locks lifecycle actions", () => {
    const html = renderToStaticMarkup(<TopologyPanel rows={rows} mode="devices" canManage saving onSave={() => undefined} />);
    expect(html).toMatch(/<button[^>]+disabled=""[^>]*>Deactivate device<\/button>/);
  });
});
