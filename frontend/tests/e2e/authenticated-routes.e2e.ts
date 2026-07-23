import { expect, test } from "./fixtures";

const routes = [
  ["/dashboard", "dashboard"],
  ["/accounts", "accounts"],
  ["/models", "models"],
  ["/client-keys", "keys"],
  ["/request-audits", "audits"],
  ["/settings", "settings"],
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
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("main")).toContainText(/.*/, {
        timeout: 10_000,
      });
      await expect(page.getByText("Unexpected Application Error")).toHaveCount(0);
      expect(uncaught).toEqual([]);
    });
  }

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
