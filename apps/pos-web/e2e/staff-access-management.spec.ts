import { expect, test, type Page } from "@playwright/test";
import type { StaffAccessRecord } from "../src/server/admin/staff-access-directory";

const CORRELATION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

async function staffWorkspace(page: Page) {
  const staff: StaffAccessRecord[] = [
    { actorId: "cashier_a", displayName: "Ama Cashier", email: "ama@example.test", identityStatus: "linked", authStatus: "active", posAccessStatus: "active", controlRole: null, locations: [] },
    { actorId: "cashier_b", displayName: "Kwame Inactive", email: "kwame@example.test", identityStatus: "linked", authStatus: "active", posAccessStatus: "disabled", controlRole: null, locations: [] },
    { actorId: "historical_actor", displayName: "Unlinked staff reference", identityStatus: "unlinked", authStatus: "unknown", posAccessStatus: "disabled", controlRole: null, locations: [] },
  ];
  const mutations: Array<{ actorId: string; body: Record<string, unknown> }> = [];
  const data = (value: unknown) => JSON.stringify({ ok: true, correlationId: CORRELATION, data: value });
  await page.route("**/api/pos/v1/session", (route) => route.fulfill({ contentType: "application/json", body: data({
    session: { actorId: "owner_a", displayName: "Store Owner", organizationId: "org_a", locationIds: [], capabilities: [], expiresAt: "2099-01-01T00:00:00.000Z" },
    assignedLocationIds: [], assignedRegisterIds: [],
  }) }));
  await page.route("**/api/pos/v1/admin/context", (route) => route.fulfill({ contentType: "application/json", body: data({
    actorId: "owner_a", displayName: "Store Owner", organizationId: "org_a", controlRole: "owner", managerLocationIds: [], locationRoles: [], sections: ["overview", "staff_access"],
  }) }));
  await page.route("**/api/pos/v1/admin/staff", (route) => route.fulfill({ contentType: "application/json", body: data(staff) }));
  await page.route("**/api/pos/v1/admin/topology", (route) => route.fulfill({ contentType: "application/json", body: data([]) }));
  await page.route("**/api/pos/v1/admin/staff/*/access-status", async (route) => {
    const actorId = new URL(route.request().url()).pathname.split("/").at(-2)!;
    const body = route.request().postDataJSON() as Record<string, unknown>;
    mutations.push({ actorId, body });
    const index = staff.findIndex((row) => row.actorId === actorId);
    staff[index] = { ...staff[index]!, posAccessStatus: body.status as "active" | "disabled" };
    await route.fulfill({ contentType: "application/json", body: data({ organizationId: "org_a", actorId, status: body.status, revokedSessionCount: body.status === "disabled" ? 1 : 0 }) });
  });
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  await page.locator(".management-nav").getByRole("button", { name: "Staff & access", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ama Cashier", exact: true })).toBeVisible();
  return { mutations };
}

test("staff views retain inactive and unlinked records without presenting them as usable logins", async ({ page }) => {
  await staffWorkspace(page);
  await expect(page.getByText("Sign-in email: ama@example.test", { exact: true })).toBeVisible();
  await page.getByLabel("Show staff").selectOption("active");
  await expect(page.getByRole("heading", { name: "Ama Cashier", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kwame Inactive", exact: true })).toHaveCount(0);
  await page.getByLabel("Show staff").selectOption("inactive");
  await expect(page.getByRole("heading", { name: "Kwame Inactive", exact: true })).toBeVisible();
  await page.getByLabel("Show staff").selectOption("unlinked");
  await expect(page.getByRole("heading", { name: "Unlinked staff reference", exact: true })).toBeVisible();
  await expect(page.getByText("Login account not linked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset temporary password", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reactivate staff", exact: true })).toBeDisabled();
});

test("staff deactivation requires confirmation and preserves the record for reactivation", async ({ page }) => {
  const { mutations } = await staffWorkspace(page);
  await page.getByLabel("Show staff").selectOption("active");
  await page.getByRole("button", { name: "Deactivate staff", exact: true }).click();
  expect(mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Keep active", exact: true }).click();
  expect(mutations).toHaveLength(0);
  await page.getByRole("button", { name: "Deactivate staff", exact: true }).click();
  await page.getByRole("button", { name: "Confirm deactivation", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Ama Cashier", exact: true })).toHaveCount(0);
  expect(mutations).toEqual([{ actorId: "cashier_a", body: { status: "disabled", reason: "Staff deactivated from POS management; history retained" } }]);
  await page.getByLabel("Show staff").selectOption("inactive");
  const card = page.locator(".management-staff-card").filter({ has: page.getByRole("heading", { name: "Ama Cashier", exact: true }) });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Reactivate staff", exact: true }).click();
  await expect(card).toHaveCount(0);
  expect(mutations[1]).toEqual({ actorId: "cashier_a", body: { status: "active" } });
  await page.getByLabel("Show staff").selectOption("active");
  await expect(page.getByRole("heading", { name: "Ama Cashier", exact: true })).toBeVisible();
});
