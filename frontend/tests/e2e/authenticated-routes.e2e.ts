import { expect, test, type Page } from "@playwright/test";

const admin = { id: "e2e-admin", username: "e2e@example.test" };
const tokens = {
  accessToken: "e2e-access-token",
  accessTokenExpiresAt: "2099-01-01T00:00:00Z",
  refreshTokenExpiresAt: "2099-01-01T00:00:00Z",
};

const routes = [
  ["/dashboard", "dashboard"],
  ["/accounts", "accounts"],
  ["/models", "models"],
  ["/client-keys", "keys"],
  ["/request-audits", "audits"],
  ["/settings", "settings"],
  ["/creative-console", "creative-console"],
] as const;

function ok(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  };
}

async function installAuthenticatedApiMocks(page: Page): Promise<void> {
  await page.route("**/api/admin/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/refresh")) {
      await route.fulfill(ok(tokens));
      return;
    }
    if (url.pathname.endsWith("/me")) {
      await route.fulfill(ok(admin));
      return;
    }
    // Route smoke tests intentionally exercise the shell and lazy route boundaries;
    // individual feature contracts remain covered by their API decoders and unit tests.
    await route.fulfill(ok({}));
  });
}

test.describe("authenticated route boundaries", () => {
  test.beforeEach(async ({ page }) => {
    await installAuthenticatedApiMocks(page);
  });

  for (const [path, label] of routes) {
    test(`${label} route renders without an application crash`, async ({
      page,
    }) => {
      const uncaught: string[] = [];
      page.on("pageerror", (error) => uncaught.push(error.message));
      await page.goto(path);
      await expect(page.locator("main")).toBeVisible();
      await expect(page.locator("main")).toContainText(/.*/, {
        timeout: 10_000,
      });
      await expect(page.getByText("Unexpected Application Error")).toHaveCount(
        0,
      );
      expect(uncaught).toEqual([]);
    });
  }
});
