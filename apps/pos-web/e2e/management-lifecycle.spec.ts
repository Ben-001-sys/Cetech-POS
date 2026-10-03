import { expect, test, type Page } from "@playwright/test";

async function installWorkspace(page: Page, failSave = false) {
  const envelope = (data: unknown) => JSON.stringify({ ok: true, data, correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  let location = { id: "loc_a", name: "Main shop", status: "active", registers: [], devices: [] };
  const changes: Record<string, unknown>[] = [];
  await page.route("**/api/pos/v1/session", route => route.fulfill({ contentType: "application/json", body: envelope({ session: { actorId: "owner", displayName: "Owner", organizationId: "org_a", locationIds: ["loc_a"], capabilities: [], expiresAt: "2099-01-01T00:00:00Z" }, assignedLocationIds: ["loc_a"], assignedRegisterIds: [] }) }));
  await page.route("**/api/pos/v1/admin/context", route => route.fulfill({ contentType: "application/json", body: envelope({ actorId: "owner", displayName: "Owner", organizationId: "org_a", controlRole: "owner", managerLocationIds: [], locationRoles: [], sections: ["overview", "locations", "system_health"] }) }));
  await page.route("**/api/pos/v1/admin/topology", async route => {
    if (route.request().method() !== "GET") {
      const change = route.request().postDataJSON() as Record<string, unknown>;
      changes.push(change);
      if (failSave) {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: { code: "SHIFT_CONFLICT", message: "Close or resolve the affected shift before deactivating this location.", retryable: false }, correlationId: "test" }) });
        return;
      }
      location = { ...location, name: String(change.name), status: String(change.status) };
    }
    await route.fulfill({ contentType: "application/json", body: envelope([location]) });
  });
  await page.goto("/management");
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  return { changes };
}

test("location lifecycle requires confirmation and later edits preserve inactive status", async ({ page }) => {
  const { changes } = await installWorkspace(page);
  await page.locator(".management-nav").getByRole("button", { name: "Locations", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate location", exact: true })).toBeVisible();
  await page.locator(".management-nav").getByRole("button", { name: "Locations", exact: true }).click();
  await page.getByRole("button", { name: "Deactivate location", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(changes).toHaveLength(0);
  await page.getByRole("button", { name: "Deactivate location", exact: true }).click();
  await page.getByRole("button", { name: "Confirm deactivate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reactivate location", exact: true })).toBeVisible();
  await page.getByLabel("Location name", { exact: true }).fill("Renamed shop");
  await page.getByRole("button", { name: "Save location", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Renamed shop", exact: true })).toBeVisible();
  expect(changes.map(change => change.status)).toEqual(["inactive", "inactive"]);
  await page.getByRole("button", { name: "Reactivate location", exact: true }).click();
  await page.getByRole("button", { name: "Confirm reactivate", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deactivate location", exact: true })).toBeVisible();
  expect(changes.at(-1)?.status).toBe("active");
});

test("an unresolved shift leaves location actions and retry controls visible", async ({ page }) => {
  await installWorkspace(page, true);
  await page.locator(".management-nav").getByRole("button", { name: "Locations", exact: true }).click();
  await page.getByRole("button", { name: "Deactivate location", exact: true }).click();
  await page.getByRole("button", { name: "Confirm deactivate", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Close or resolve" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Deactivate location", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Save location", exact: true })).toBeEnabled();
});

test("system loader uses the same stacked service cards on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installWorkspace(page);
  let release: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/pos/v1/admin/system-health", async route => {
    await pending;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, correlationId: "test", data: { overall: "healthy", buildId: "candidate", checks: ["Commerce connection", "Commerce contract", "Store data"].map((label, index) => ({ id: String(index), label, status: "healthy", summary: "This check succeeded.", checkedAt: "2026-10-03T00:00:00Z" })) } }) });
  });
  await page.locator(".management-nav").getByRole("button", { name: "System status", exact: true }).click();
  const skeleton = page.locator('[data-management-loading="system-health"]');
  await expect(skeleton.locator(".system-health-card")).toHaveCount(3);
  await expect(skeleton.getByRole("status")).toHaveText("Loading system health…");
  const skeletonWidth = await skeleton.locator(".system-health-card").first().evaluate(el => el.getBoundingClientRect().width);
  release?.();
  const loaded = page.locator('[data-layout="system-health"]');
  await expect(loaded.locator(".system-health-card")).toHaveCount(3);
  const loadedWidth = await loaded.locator(".system-health-card").first().evaluate(el => el.getBoundingClientRect().width);
  expect(Math.abs(loadedWidth - skeletonWidth)).toBeLessThanOrEqual(1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
