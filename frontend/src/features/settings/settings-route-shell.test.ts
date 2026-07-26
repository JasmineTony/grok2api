import { describe, expect, it } from "vitest";

import type { SettingsConfigDTO } from "@/features/settings/settings-api";
import { toSettingsDTO, toSettingsForm } from "@/features/settings/settings-model";
import { shouldBlockSettingsNavigation } from "@/features/settings/settings-route-navigation";

const settingsConfigFixture = (): SettingsConfigDTO => ({
  server: { maxConcurrentRequests: 100 },
  providerBuild: {
    baseURL: "https://build.example.com",
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
    maxImageBytes: 8 * 2 ** 20,
    maxTotalBytes: 8 * 2 ** 30,
    cleanupThresholdPercent: 80,
    cleanupInterval: "1h",
  },
  frontend: { publicApiBaseURL: "https://api.example.com" },
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
});

describe("settings route shell boundaries", () => {
  it("keeps dirty form state when moving between settings child routes", () => {
    expect(shouldBlockSettingsNavigation(true, "/settings", "/settings/media")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/media", "/settings/network")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/network", "/dashboard")).toBe(true);
    expect(shouldBlockSettingsNavigation(false, "/settings/network", "/dashboard")).toBe(false);
  });

  it("submits a full settings DTO so media edits do not erase network settings", () => {
    const config = settingsConfigFixture();
    const form = toSettingsForm(config);
    form.media.cleanupThresholdPercent = 85;
    const dto = toSettingsDTO(form);

    expect(dto.media.cleanupThresholdPercent).toBe(85);
    expect(dto.providerBuild).toEqual(config.providerBuild);
    expect(dto.providerWeb.baseURL).toBe(config.providerWeb.baseURL);
    expect(dto.providerWeb.clearanceMode).toBe(config.providerWeb.clearanceMode);
    expect(dto.providerConsole).toEqual(config.providerConsole);
  });
});
