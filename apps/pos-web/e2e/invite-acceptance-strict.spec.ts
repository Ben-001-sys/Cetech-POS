import { createServer } from "node:http";
import { once } from "node:events";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";
import { build } from "vite";
import { resetInviteMaterialForTests } from "../src/features/auth/invite-acceptance";

const SECRET = "invite-secret-token-value";
const PASSWORD = "CorrectHorse7Battery";
const appRoot = process.cwd();
const inviteDir = path.join(appRoot, "src/app/auth/invite");

async function inviteBundle(): Promise<string> {
  const result = await build({
    configFile: false,
    root: appRoot,
    logLevel: "error",
    mode: "development",
    define: {
      "process.env.NODE_ENV": JSON.stringify("development"),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("https://project.supabase.co"),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("publishable-test-key"),
    },
    resolve: {
      alias: {
        "next/link": path.join(inviteDir, "next-link-stub.tsx"),
      },
    },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.join(inviteDir, "invite-page-harness.tsx"),
        formats: ["iife"],
        name: "InviteHarness",
      },
    },
  });
  const output = Array.isArray(result) ? result[0] : result;
  if (!output || !("output" in output)) throw new Error("invite harness bundle was empty");
  const files = output.output as ReadonlyArray<{ readonly fileName: string; readonly code?: string }>;
  const code = files.find((file) => file.fileName.endsWith(".js") && typeof file.code === "string");
  if (!code?.code) throw new Error("invite harness bundle was empty");
  if (!code.code.includes("react.development") && !code.code.includes("react-dom.development") && !code.code.includes("Invoke-Component")) {
    throw new Error("invite harness must use the development React build so Strict Mode replays effects");
  }
  return code.code;
}

const bundlePromise = inviteBundle();

async function openInvite(
  page: Page,
  bundle: string,
  search: string,
  prepare: (page: Page) => Promise<void>,
): Promise<() => void> {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><div id="root"></div><script>${bundle}</script>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("invite test server did not bind");
  }
  await page.addInitScript(() => {
    const original = history.replaceState.bind(history);
    let count = 0;
    history.replaceState = (...args: unknown[]) => {
      count += 1;
      (window as unknown as { __inviteReplaceCount: number }).__inviteReplaceCount = count;
      return original(...(args as Parameters<History["replaceState"]>));
    };
  });
  await prepare(page);
  await page.goto(`http://127.0.0.1:${address.port}/auth/invite${search}`);
  return () => {
    server.close();
  };
}

test.describe("mounted invite acceptance", () => {
  test.describe.configure({ timeout: 60_000 });

  test("Strict Mode keeps a valid invitation and clears the token after success", async ({ page }) => {
    resetInviteMaterialForTests();
    const bundle = await bundlePromise;
    const calls: string[] = [];
    const close = await openInvite(page, bundle, `?type=invite&token_hash=${SECRET}`, async (current) => {
      await current.route("**/auth/v1/**", async (route: Route) => {
        calls.push(route.request().url());
        const requestPath = new URL(route.request().url()).pathname;
        if (requestPath.endsWith("/verify")) {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ access_token: "session-access-token" }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });
    });
    await page.getByRole("button", { name: "Save password" }).waitFor();
    const rendered = await page.locator("#root").innerHTML();
    const text = await page.locator("#root").innerText();
    expect(text).not.toContain("not valid");
    expect(rendered).not.toContain(SECRET);
    expect(page.url()).not.toContain(SECRET);
    expect(page.url()).toMatch(/\/auth\/invite$/);
    expect(await page.evaluate(() => (window as unknown as { __inviteReplaceCount?: number }).__inviteReplaceCount)).toBe(1);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();
    await page.getByRole("link", { name: "Sign in" }).waitFor();
    expect(await page.locator("[data-invite-retained]").getAttribute("data-invite-retained")).toBe("false");
    const after = await page.locator("#root").innerHTML();
    expect(after).not.toContain(SECRET);
    expect(after).not.toContain("session-access-token");
    expect(page.url()).not.toContain(SECRET);
    expect(calls.some((item) => item.endsWith("/auth/v1/verify"))).toBe(true);
    expect(calls.some((item) => item.endsWith("/auth/v1/logout"))).toBe(true);
    close();
  });

  test("an unavailable password save can be retried with the same invitation", async ({ page }) => {
    resetInviteMaterialForTests();
    const bundle = await bundlePromise;
    const bodies: string[] = [];
    let userCalls = 0;
    const close = await openInvite(page, bundle, `?type=invite&token_hash=${SECRET}`, async (current) => {
      await current.route("**/auth/v1/**", async (route: Route) => {
        const requestPath = new URL(route.request().url()).pathname;
        const body = route.request().postData() ?? "";
        if (requestPath.endsWith("/user")) {
          userCalls += 1;
          bodies.push(body);
          await route.fulfill({
            status: userCalls === 1 ? 503 : 200,
            contentType: "application/json",
            body: "{}",
          });
          return;
        }
        if (requestPath.endsWith("/verify")) {
          bodies.push(body);
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ access_token: "session-access-token" }),
          });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      });
    });
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Save password" }).click();
    await page.getByRole("button", { name: "Try again" }).waitFor();
    expect(page.url()).not.toContain(SECRET);
    expect(await page.locator("#root").innerHTML()).not.toContain(SECRET);
    await page.getByRole("button", { name: "Try again" }).click();
    await page.getByRole("link", { name: "Sign in" }).waitFor();
    const verifyBodies = bodies.filter((body) => body.includes(SECRET));
    expect(verifyBodies.length).toBeGreaterThanOrEqual(2);
    expect(new Set(verifyBodies).size).toBe(1);
    expect(await page.locator("[data-invite-retained]").getAttribute("data-invite-retained")).toBe("false");
    expect(await page.locator("#root").innerHTML()).not.toContain(SECRET);
    close();
  });

  test("a second submit while the first request is in flight is ignored", async ({ page }) => {
    resetInviteMaterialForTests();
    const bundle = await bundlePromise;
    let verifyCalls = 0;
    const close = await openInvite(page, bundle, `?type=invite&token_hash=${SECRET}`, async (current) => {
      await current.route("**/auth/v1/**", async (route: Route) => {
        const requestPath = new URL(route.request().url()).pathname;
        if (requestPath.endsWith("/verify")) verifyCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ access_token: "session-access-token" }),
        });
      });
    });
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.evaluate(() => {
      const form = document.querySelector("form");
      form?.requestSubmit();
      form?.requestSubmit();
    });
    await page.getByRole("link", { name: "Sign in" }).waitFor();
    expect(verifyCalls).toBe(1);
    close();
  });
});
