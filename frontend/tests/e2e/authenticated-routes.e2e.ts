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

  test("network settings contains horizontal scrolling to local panels", async ({
    authenticatedPage: page,
  }) => {
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
      timeout: 15_000,
    });
    await expect(page.getByRole("link", { name: /Grok Build/ })).toBeVisible({ timeout: 15_000 });
  });

  test("general, policies, and account maintenance keep their upstream setting groups", async ({
    authenticatedPage: page,
  }) => {
    for (const [path, heading] of [
      ["/settings", /Service capacity|\u670d\u52a1\u5bb9\u91cf/],
      ["/settings/policies", /Routing policy|\u8def\u7531\u7b56\u7565/],
      ["/settings/accounts", /Account maintenance|\u8d26\u53f7\u7ef4\u62a4/],
    ] as const) {
      await page.goto(path);
      await expectMainReady(page);
      await expect(page.locator("main").getByRole("heading", { name: heading })).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test("each provider settings route renders its own section", async ({
    authenticatedPage: page,
  }) => {
    for (const [path, heading] of [
      ["/settings/build", /Grok Build/],
      ["/settings/web", /Grok Web/],
      ["/settings/console", /Grok Console/],
    ] as const) {
      await page.goto(path);
      await expectMainReady(page);
      await expect(page.locator("main").getByRole("heading", { name: heading })).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test("read-only settings routes expose rendered release information", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/settings/about");
    await expect(page.locator("main").getByText("v3.4.1").first()).toBeVisible({ timeout: 15_000 });
    await page.goto("/settings/changelog");
    await expect(
      page.getByRole("heading", { name: /Release notes|\u66f4\u65b0\u8bf4\u660e/ }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Security and routing refinements")).toBeVisible({
      timeout: 15_000,
    });
  });
  test("model dialog mounts and unmounts without an application crash @cross-browser", async ({
    authenticatedPage: page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/models");
    await page.getByRole("button", { name: /Add model|\u6dfb\u52a0\u6a21\u578b/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: /Add model route|\u6dfb\u52a0\u6a21\u578b\u8def\u7531/ }),
    ).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });
});
