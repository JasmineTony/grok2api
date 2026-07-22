import { type Page, test as base } from "@playwright/test";

export type AuthenticatedApiFixtures = {
  authenticatedPage: Page;
};

export function createAdminFixture() {
  return { id: "e2e-admin", username: "e2e@example.test" } as const;
}

export function createTokenFixture() {
  return {
    accessToken: "e2e-access-token",
    accessTokenExpiresAt: "2099-01-01T00:00:00Z",
    refreshTokenExpiresAt: "2099-01-01T00:00:00Z",
  } as const;
}

function ok(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  };
}

export async function installAuthenticatedApiMocks(page: Page): Promise<void> {
  const admin = createAdminFixture();
  const tokens = createTokenFixture();
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
    // These fixtures exercise shell and lazy-route boundaries. Feature-level
    // decoders and component tests own the detailed response contracts.
    await route.fulfill(ok({}));
  });
}

export async function installAnonymousApiMocks(page: Page): Promise<void> {
  const unauthorized = {
    status: 401,
    contentType: "application/json",
    body: JSON.stringify({
      error: { code: "unauthenticated", message: "not signed in" },
    }),
  };
  await page.route("**/api/admin/v1/auth/refresh", async (route) => {
    await route.fulfill(unauthorized);
  });
  await page.route("**/api/admin/v1/me", async (route) => {
    await route.fulfill(unauthorized);
  });
}

export const test = base.extend<AuthenticatedApiFixtures>({
  authenticatedPage: async ({ page }, provide) => {
    await installAuthenticatedApiMocks(page);
    await provide(page);
  },
});

export { expect } from "@playwright/test";
