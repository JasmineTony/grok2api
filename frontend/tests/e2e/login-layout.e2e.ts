import { expect, test } from "@playwright/test";

import { installAnonymousApiMocks } from "./fixtures";

test.describe("login layout", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`${theme} theme keeps login controls usable`, async ({ page }) => {
      await page.addInitScript((selectedTheme) => {
        localStorage.setItem("theme", selectedTheme);
      }, theme);
      await installAnonymousApiMocks(page);
      await page.goto("/login");
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator("#username")).toBeVisible();
      await expect(page.locator("#password")).toBeVisible();
      await expect(page.getByRole("button", { name: /sign in|登录/i })).toBeVisible();
      await expect(page).toHaveScreenshot(`login-${theme}.png`, {
        fullPage: true,
      });
    });
  }
});
