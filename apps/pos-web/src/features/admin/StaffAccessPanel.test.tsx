import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { StaffAccessRecord } from "../../server/admin/staff-access-directory";
import { StaffAccessPanel } from "./StaffAccessPanel";
import { TopologyPanel } from "./TopologyPanel";

function ownerRow(): StaffAccessRecord {
  return {
    actorId: "owner_a",
    displayName: "Ama Owner",
    email: "owner@example.com",
    authStatus: "active",
    posAccessStatus: "active",
    controlRole: "owner",
    locations: [],
  };
}

function panel(callerControlRole: "owner" | "admin") {
  return renderToStaticMarkup(
    <StaffAccessPanel
      rows={[ownerRow()]}
      canManage
      callerControlRole={callerControlRole}
      currentActorId="caller"
      onResetTemporaryPassword={() => undefined}
    />,
  );
}

describe("staff password reset visibility", () => {
  test("an admin does not get an owner password reset action", () => {
    const html = panel("admin");
    expect(html).toContain("An admin cannot reset an owner password.");
    expect(html).not.toContain("Reset temporary password");
  });

  test("an owner keeps the owner password reset action", () => {
    const html = panel("owner");
    expect(html).toContain("Reset temporary password");
    expect(html).not.toContain("An admin cannot reset an owner");
  });

  test("unlinked history references are truthful and cannot offer password reset or role grants", () => {
    const html = renderToStaticMarkup(<StaffAccessPanel rows={[{
      actorId: "historical_actor",
      displayName: "historical_actor",
      identityStatus: "unlinked",
      authStatus: "unknown",
      posAccessStatus: "disabled",
      controlRole: null,
      locations: [],
    }]} canManage callerControlRole="owner" currentActorId="owner_a" onResetTemporaryPassword={() => undefined} onSaveControlMembership={() => undefined} onSaveAccessStatus={() => undefined} />);
    expect(html).toContain("Unlinked staff reference");
    expect(html).toContain("Login account not linked");
    expect(html).toContain("No matching login account was found");
    expect(html).not.toContain("Account disabled");
    expect(html).not.toContain("Reset temporary password");
    expect(html).not.toContain("Save role");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reactivate staff<\/button>/);
  });

  test("linked staff show their email, login state and last sign-in with history-preserving removal", () => {
    const html = renderToStaticMarkup(<StaffAccessPanel rows={[{
      ...ownerRow(), actorId: "cashier_a", controlRole: null, identityStatus: "linked", lastSignInAt: "2026-10-03T06:30:00.000Z",
    }]} canManage callerControlRole="owner" currentActorId="owner_a" onSaveAccessStatus={() => undefined} />);
    expect(html).toContain("Sign-in email: owner@example.com");
    expect(html).toContain("Login account active");
    expect(html).toContain("2026-10-03 06:30 UTC");
    expect(html).toContain("Deactivate staff");
    expect(html).toContain("Their sales, shifts and activity history stay available.");
    expect(html).toContain("Inactive staff");
  });

  test("self and owner deactivation remain disabled with a specific explanation", () => {
    const html = renderToStaticMarkup(<StaffAccessPanel rows={[ownerRow()]} canManage callerControlRole="owner" currentActorId="owner_a" onSaveAccessStatus={() => undefined} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Deactivate staff<\/button>/);
    expect(html).toContain("You cannot deactivate your own current management access.");
  });

  test("an inactive Auth account cannot be misleadingly reactivated with a POS-only action", () => {
    const html = renderToStaticMarkup(<StaffAccessPanel rows={[{
      ...ownerRow(), actorId: "cashier_a", controlRole: null, authStatus: "disabled", posAccessStatus: "disabled",
    }]} canManage callerControlRole="owner" currentActorId="owner_a" onSaveAccessStatus={() => undefined} />);
    expect(html).toContain("Restore a linked, active login account before reactivating POS access.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reactivate staff<\/button>/);
  });

  test("an Admin does not get a usable Owner reactivation action", () => {
    const html = renderToStaticMarkup(<StaffAccessPanel rows={[{ ...ownerRow(), posAccessStatus: "disabled" }]} canManage callerControlRole="admin" currentActorId="admin_a" onSaveAccessStatus={() => undefined} />);
    expect(html).toContain("Only an Owner can reactivate another Owner&#x27;s POS access.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Reactivate staff<\/button>/);
  });

  test("operational manager view explains scope and does not expose offboarding", () => {
    const html = renderToStaticMarkup(<StaffAccessPanel rows={[ownerRow()]} managedLocationIds={["loc_a1"]} callerControlRole={null} currentActorId="manager_a" onSaveAccessStatus={() => undefined} />);
    expect(html).toContain("Owners and Admins manage staff accounts.");
    expect(html).not.toContain(">Deactivate staff<");
    expect(html).not.toContain(">Reactivate staff<");
  });

  test("a rejected staff change keeps the existing staff records available for review", () => {
    const html = renderToStaticMarkup(<StaffAccessPanel rows={[ownerRow()]} canManage callerControlRole="owner" currentActorId="owner_a" errorMessage="That change was not saved." />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("That change was not saved.");
    expect(html).toContain("Sign-in email: owner@example.com");
    expect(html).toContain("Ama Owner");
  });
});


describe("operational readiness presentation", () => {
  test("active register without an active device is not presented as ready to open", () => {
    const html = renderToStaticMarkup(
      <TopologyPanel
        mode="registers"
        rows={[
          {
            id: "loc_a2",
            name: "Location A2",
            status: "active",
            registers: [
              { id: "reg_b", name: "Register B", currency: "GHS", status: "active" },
            ],
            devices: [],
          },
        ]}
      />,
    );
    expect(html).toContain(
      "Cannot open a shift until this location has an active POS device.",
    );
  });

  test("inactive register cannot be newly selected for an existing staff assignment", () => {
    const row: StaffAccessRecord = {
      actorId: "cashier_a",
      displayName: "Cashier A",
      email: "cashier@example.com",
      authStatus: "active",
      posAccessStatus: "active",
      controlRole: null,
      locations: [
        { locationId: "loc_a1", role: "cashier", registerIds: ["reg_a"] },
      ],
    };
    const html = renderToStaticMarkup(
      <StaffAccessPanel
        rows={[row]}
        topology={[
          {
            id: "loc_a1",
            name: "Location A1",
            status: "active",
            registers: [
              { id: "reg_a", name: "Register A", currency: "GHS", status: "active" },
              {
                id: "reg_maintenance",
                name: "Maintenance Register",
                currency: "GHS",
                status: "maintenance",
              },
            ],
            devices: [],
          },
        ]}
        canManage
        callerControlRole="admin"
        currentActorId="admin_a"
        onSaveAssignment={() => undefined}
      />,
    );
    expect(html).toContain("Maintenance Register · Maintenance");
    expect(html).toMatch(
      /<input type="checkbox" disabled=""\/><span>Maintenance Register · Maintenance<\/span>/,
    );
  });
});
