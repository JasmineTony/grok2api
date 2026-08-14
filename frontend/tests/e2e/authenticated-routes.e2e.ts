import { expect, expectMainReady, test } from "./fixtures";

const routes = [
  ["/dashboard", "dashboard"],
  ["/accounts", "accounts"],
  ["/models", "models"],
  ["/client-keys", "keys"],
  ["/request-audits", "audits"],
  ["/settings", "settings"],
  ["/settings/policies", "settings-policies"],
  ["/settings/accounts", "settings-accounts"],
  ["/settings/build", "settings-build"],
  ["/settings/web", "settings-web"],
  ["/settings/console", "settings-console"],
  ["/settings/media", "settings-media"],
  ["/settings/network", "settings-network"],
  ["/settings/about", "settings-about"],
  ["/settings/changelog", "settings-changelog"],
  ["/creative-console", "creative-console"],
] as const;

test.describe("authenticated route boundaries @cross-browser", () => {
  for (const [path, label] of routes) {
    test(`${label} route renders without an application crash`, async ({
      authenticatedPage: page,
    }) => {
      const uncaught: string[] = [];
      page.on("pageerror", (error) => uncaught.push(error.message));
      await page.goto(path);
      await expectMainReady(page);
      await expect(page.locator("main")).toContainText(/.*/, {
        timeout: 10_000,
      });
      await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
      expect(uncaught).toEqual([]);
    });
  }

  test("dashboard keeps wide data panels inside the mobile viewport", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/dashboard");
    await expect(page.getByText(/Gateway healthy|网关正常/)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-slot="table-scroll-container"]')).toBeVisible({
      timeout: 20_000,
    });
    const overflow = await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) >
        window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });

  test("network settings contains horizontal scrolling to local panels", async ({
    authenticatedPage: page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/settings/network");
    await expectMainReady(page);
    const overflow = await page.evaluate(
      () =>
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) >
        window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
    // The provider sections are their own routes now, so this page holds only egress.
    await expect(
      page.getByRole("heading", { name: /Egress proxies|\u51fa\u53e3\u4ee3\u7406/ }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("link", { name: /Grok Build/ })).toBeVisible({ timeout: 20_000 });
  });

  test("runtime policies retain the removed general modules in upstream order", async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/settings/policies");
    await expectMainReady(page);
    for (const heading of [
      /Service capacity|\u670d\u52a1\u5bb9\u91cf/,
      /Batch tasks|\u6279\u91cf\u4efb\u52a1/,
      /Routing policy|\u8def\u7531\u7b56\u7565/,
    ]) {
      await expect(page.locator("main").getByRole("heading", { name: heading })).toBeVisible({
        timeout: 20_000,
      });
    }
  });

  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 1000 },
  ]) {
    test(`shared layout exposes stable responsive landmarks at ${viewport.name} width`, async ({
      authenticatedPage: page,
    }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/models");
      await expectMainReady(page);
      await expect(page.locator('[data-layout="app-shell"]')).toBeVisible();
      await expect(page.locator('[data-layout="main-content"]')).toBeVisible();
      await expect(page.locator('[data-layout="page-scaffold"]')).toBeVisible();
      await expect(page.locator('[data-layout="page-header"]')).toBeVisible();
      await expect(page.locator('[data-layout="data-table-shell"]')).toBeVisible();
      const tableScroll = page.locator('[data-slot="table-scroll-container"]');
      await expect(tableScroll).toBeVisible();
      if (viewport.width === 375) {
        const localTableOverflow = await tableScroll.evaluate(
          (element) => element.scrollWidth > element.clientWidth,
        );
        expect(localTableOverflow).toBe(true);
      }
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflow).toBe(false);
    });
  }

  test("runtime settings redirect and navigation preserve the split upstream hierarchy", async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/build$/, { timeout: 20_000 });
    await expectMainReady(page);
    const hrefs = await page
      .locator("main nav a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefs).toEqual([
      "/settings/build",
      "/settings/web",
      "/settings/console",
      "/settings/media",
      "/settings/network",
      "/settings/policies",
      "/settings/accounts",
      "/settings/about",
      "/settings/changelog",
    ]);
    await expect(page.locator("#provider-base-url")).toBeVisible({ timeout: 30_000 });
  });

  test("about settings exposes the current release identity", async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(60_000);
    await page.goto("/settings/about");
    await expect(page.locator("main").getByText("v3.6.1").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("changelog settings exposes rendered release notes", async ({ authenticatedPage: page }) => {
    test.setTimeout(60_000);
    await page.goto("/settings/changelog");
    await expect(
      page.getByRole("heading", { name: /Changelog|Release notes|\u66f4\u65b0\u8bf4\u660e/ }),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.locator("main").getByText(/Upstream main parity and bounded video failover/),
    ).toBeVisible({
      timeout: 30_000,
    });
  });
  test("model dialog mounts and unmounts without an application crash @cross-browser", async ({
    authenticatedPage: page,
  }) => {
    test.setTimeout(60_000);
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/models");
    await page.getByRole("button", { name: /Add model|\u6dfb\u52a0\u6a21\u578b/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: /Add model route|\u6dfb\u52a0\u6a21\u578b\u8def\u7531/ }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });
});
