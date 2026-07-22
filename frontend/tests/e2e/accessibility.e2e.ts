import AxeBuilder from "@axe-core/playwright";
import { test as anonymousTest } from "@playwright/test";

import { expect, installAnonymousApiMocks, test } from "./fixtures";

function seriousViolations(results: Awaited<ReturnType<AxeBuilder["analyze"]>>) {
  return results.violations.filter(
    (violation) => violation.impact === "critical" || violation.impact === "serious",
  );
}

anonymousTest("login has no serious accessibility violations @cross-browser", async ({ page }) => {
  await installAnonymousApiMocks(page);
  await page.goto("/login");
  await expect(page.locator("main")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(seriousViolations(results)).toEqual([]);
});

test("authenticated shell has no serious accessibility violations @cross-browser", async ({
  authenticatedPage: page,
}) => {
  await page.goto("/accounts");
  await expect(page.locator("main")).toBeVisible();
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(seriousViolations(results)).toEqual([]);
});
