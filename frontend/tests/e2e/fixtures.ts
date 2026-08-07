import { expect, type Page, test as base } from "@playwright/test";

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

function createSettingsSnapshotFixture() {
  return {
    config: {
      server: { maxConcurrentRequests: 100 },
      providerBuild: {
        baseURL: "https://build.example.test",
        fallbackBaseURL: "https://api.x.ai",
        clientVersion: "0.2.111",
        clientIdentifier: "grok-build",
        tokenAuth: "configured",
        tokenAuthConfigured: true,
        userAgent: "Grok/0.2.111",
        responseHeaderTimeout: "45s",
      },
      providerWeb: {
        baseURL: "https://grok.com",
        quotaTimeout: "30s",
        chatTimeout: "2m",
        imageTimeout: "5m",
        videoTimeout: "10m",
        statsigMode: "url",
        statsigManualValue: "",
        statsigManualConfigured: false,
        statsigSignerURL: "http://statsig.local/sign",
        clearanceMode: "manual",
        flareSolverrURL: "http://flaresolverr.local/v1",
        clearanceTimeout: "30s",
        clearanceRefresh: "1h",
        mediaConcurrency: 2,
        allowNSFW: false,
        recoveryBackoffBase: "30s",
        recoveryBackoffMax: "5m",
      },
      providerConsole: { baseURL: "https://console.x.ai", chatTimeout: "30s" },
      batch: {
        importConcurrency: 2,
        conversionConcurrency: 2,
        syncConcurrency: 2,
        refreshConcurrency: 2,
        randomDelay: "250ms",
      },
      media: {
        maxImageBytes: 8388608,
        maxTotalBytes: 8589934592,
        cleanupThresholdPercent: 80,
        cleanupInterval: "1h",
      },
      frontend: { publicApiBaseURL: "https://api.example.test" },
      routing: {
        stickyTTL: "1h",
        cooldownBase: "30s",
        cooldownMax: "5m",
        capacityWait: "1s",
        maxAttempts: 3,
        preferFreeBuild: true,
        segmentedSelector: { enabled: true, minCandidates: 100, windowSize: 16 },
      },
      audit: { bufferSize: 1024, batchSize: 64, flushInterval: "1s", commitDelayMS: 10 },
      clientKeyDefaults: { rpmLimit: 60, maxConcurrent: 4 },
      accounts: {
        markBuildForbiddenReauth: false,
        buildForbiddenReauthCodes: ["blocked-user"],
        autoCleanReauthEnabled: false,
        autoCleanReauthInterval: "10m",
        autoCleanReauthMinAge: "1h",
        autoCleanIncludeDisabled: false,
      },
    },
    recommendedProviderBuild: { clientVersion: "0.2.111", userAgent: "Grok/0.2.111" },
    updatedAt: "2099-01-01T00:00:00Z",
    revision: "fixture-revision",
    restartRequired: [],
  };
}

function createVersionFixture() {
  return {
    currentVersion: "v3.5.1",
    latestVersion: "v3.5.1",
    updateAvailable: false,
    status: "up_to_date",
    checkedAt: "2099-01-01T00:00:00Z",
    releaseUrl: "https://github.com/JasmineTony/grok2api/releases/tag/v3.5.1",
    releaseNotes: "## Security and routing refinements\n\n- Stable settings and egress behavior.",
    error: "",
    repository: "JasmineTony/grok2api",
    upstreamRepository: "chenyme/grok2api",
    upstreamLatestVersion: "v3.0.10",
    upstreamReleaseUrl: "https://github.com/chenyme/grok2api/releases/tag/v3.0.10",
    upstreamError: "",
  };
}
function createEgressNodesFixture() {
  return {
    items: [],
    defaultUserAgents: {
      grok_build: "",
      grok_web: "Mozilla/5.0",
      grok_console: "Mozilla/5.0",
      grok_web_asset: "Mozilla/5.0",
    },
  };
}

function createEgressOperationsFixture() {
  return {
    probeProvider: "cloudflare",
    probeIntervalSeconds: 300,
    autoAssignEnabled: false,
    autoBalanceEnabled: false,
    assignmentIntervalSeconds: 600,
    fallbacks: {
      grok_build: { mode: "none" },
      grok_web: { mode: "direct" },
      grok_console: { mode: "none" },
      grok_web_asset: { mode: "direct" },
    },
    updatedAt: "2099-01-01T00:00:00Z",
  };
}

function ok(data: unknown) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ data }),
  };
}

export async function expectMainReady(page: Page): Promise<void> {
  await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
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
    if (url.pathname.endsWith("/system/version") || url.pathname.endsWith("/system/update/check")) {
      await route.fulfill(ok(createVersionFixture()));
      return;
    }
    if (url.pathname.endsWith("/settings")) {
      await route.fulfill(ok(createSettingsSnapshotFixture()));
      return;
    }
    if (url.pathname.endsWith("/egress-nodes")) {
      await route.fulfill(ok(createEgressNodesFixture()));
      return;
    }
    if (url.pathname.endsWith("/egress-sources")) {
      await route.fulfill(ok({ items: [] }));
      return;
    }
    if (url.pathname.endsWith("/egress-operations")) {
      await route.fulfill(ok(createEgressOperationsFixture()));
      return;
    }
    // These fixtures exercise shell and lazy-route boundaries. Feature-level
    // decoders and component tests own the remaining detailed response contracts.
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

export { expect };
