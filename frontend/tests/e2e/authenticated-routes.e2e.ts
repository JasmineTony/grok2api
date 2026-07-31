import { expect, expectMainReady, test } from "./fixtures";

const routes = [
  ["/dashboard", "dashboard"],
  ["/accounts", "accounts"],
  ["/models", "models"],
  ["/client-keys", "keys"],
  ["/request-audits", "audits"],
  ["/settings", "settings"],
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
    await expect(page.getByRole("heading", { name: /Egress proxies|出口代理/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Grok Build/ })).toBeVisible();
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
      await expect(page.locator("main").getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("read-only settings routes expose rendered release information", async ({
    authenticatedPage: page,
  }) => {
    await page.goto("/settings/about");
    await expect(page.locator("main").getByText("v3.2.0").first()).toBeVisible();
    await page.goto("/settings/changelog");
    await expect(page.getByRole("heading", { name: /Release notes|更新说明/ })).toBeVisible();
    await expect(page.getByText("Security and routing refinements")).toBeVisible();
  });
  test("model dialog mounts and unmounts without an application crash @cross-browser", async ({
    authenticatedPage: page,
  }) => {
    const uncaught: string[] = [];
    page.on("pageerror", (error) => uncaught.push(error.message));
    await page.goto("/models");
    await page.getByRole("button", { name: /Add model|添加模型/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Add model route|添加模型路由/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(uncaught).toEqual([]);
  });
});
