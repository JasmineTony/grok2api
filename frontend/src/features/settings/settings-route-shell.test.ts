import { describe, expect, it } from "vitest";

import type { SettingsConfigDTO } from "@/features/settings/settings-api";
import { settingsSchema, toSettingsDTO, toSettingsForm } from "@/features/settings/settings-model";
import {
  isReadOnlySettingsPath,
  settingsRoutes,
  shouldBlockSettingsNavigation,
} from "@/features/settings/settings-route-navigation";

import accountMaintenancePanelSource from "./settings-account-maintenance-panel.tsx?raw";
import settingsGeneralPanelSource from "./settings-general-panel.tsx?raw";
import settingsRuntimePoliciesPanelSource from "./settings-policies-panel.tsx?raw";

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

const UPSTREAM_V3010_SETTINGS_CONTRACT = [
  "server.maxConcurrentRequests",
  "providerBuild.baseURL",
  "providerBuild.fallbackBaseURL",
  "providerBuild.clientVersion",
  "providerBuild.clientIdentifier",
  "providerBuild.tokenAuth",
  "providerBuild.tokenAuthConfigured",
  "providerBuild.userAgent",
  "providerBuild.responseHeaderTimeout",
  "providerWeb.baseURL",
  "providerWeb.quotaTimeout",
  "providerWeb.chatTimeout",
  "providerWeb.imageTimeout",
  "providerWeb.videoTimeout",
  "providerWeb.statsigMode",
  "providerWeb.statsigManualValue",
  "providerWeb.statsigSignerURL",
  "providerWeb.clearanceMode",
  "providerWeb.flareSolverrURL",
  "providerWeb.clearanceTimeout",
  "providerWeb.clearanceRefresh",
  "providerWeb.mediaConcurrency",
  "providerWeb.allowNSFW",
  "providerWeb.recoveryBackoffBase",
  "providerWeb.recoveryBackoffMax",
  "providerConsole.baseURL",
  "providerConsole.chatTimeout",
  "batch.importConcurrency",
  "batch.conversionConcurrency",
  "batch.syncConcurrency",
  "batch.refreshConcurrency",
  "batch.randomDelay",
  "media.maxImageSize",
  "media.maxTotalSize",
  "media.cleanupThresholdPercent",
  "media.cleanupInterval",
  "frontend.publicApiBaseURL",
  "routing.stickyTTL",
  "routing.cooldownBase",
  "routing.cooldownMax",
  "routing.capacityWait",
  "routing.maxAttempts",
  "routing.preferFreeBuild",
  "routing.segmentedSelector.enabled",
  "routing.segmentedSelector.minCandidates",
  "routing.segmentedSelector.windowSize",
  "audit.bufferSize",
  "audit.batchSize",
  "audit.flushInterval",
  "audit.commitDelayMS",
  "clientKeyDefaults.rpmLimit",
  "clientKeyDefaults.maxConcurrent",
  "accounts.markBuildForbiddenReauth",
  "accounts.buildForbiddenReauthCodes",
  "accounts.autoCleanReauthEnabled",
  "accounts.autoCleanReauthInterval",
  "accounts.autoCleanReauthMinAge",
  "accounts.autoCleanIncludeDisabled",
] as const;

const GENERAL_SETTINGS_ROUTE_FIELDS = [
  "server.maxConcurrentRequests",
  "batch.importConcurrency",
  "batch.conversionConcurrency",
  "batch.syncConcurrency",
  "batch.refreshConcurrency",
  "batch.randomDelay",
] as const;

const RUNTIME_POLICIES_SETTINGS_ROUTE_FIELDS = [
  "routing.stickyTTL",
  "routing.cooldownBase",
  "routing.cooldownMax",
  "routing.capacityWait",
  "routing.maxAttempts",
  "routing.preferFreeBuild",
  "routing.segmentedSelector.enabled",
  "routing.segmentedSelector.minCandidates",
  "routing.segmentedSelector.windowSize",
  "audit.bufferSize",
  "audit.batchSize",
  "audit.flushInterval",
  "audit.commitDelayMS",
  "clientKeyDefaults.rpmLimit",
  "clientKeyDefaults.maxConcurrent",
] as const;

const ACCOUNT_MAINTENANCE_SETTINGS_ROUTE_FIELDS = [
  "accounts.markBuildForbiddenReauth",
  "accounts.buildForbiddenReauthCodes",
  "accounts.autoCleanReauthEnabled",
  "accounts.autoCleanReauthInterval",
  "accounts.autoCleanReauthMinAge",
  "accounts.autoCleanIncludeDisabled",
] as const;

function getSettingsPanelFieldPaths(source: string): string[] {
  return Array.from(source.matchAll(/(?:form\.register\("([^"\n]+)"|name="([^"\n]+)")/g))
    .map((match) => match[1] ?? match[2])
    .filter((path): path is string => path !== undefined);
}

function hasPath(value: unknown, path: string): boolean {
  let current: unknown = value;
  for (const key of path.split(".")) {
    if (typeof current !== "object" || current === null || !(key in current)) return false;
    current = (current as Record<string, unknown>)[key];
  }
  return true;
}

describe("settings route shell boundaries", () => {
  it("keeps dirty form state when moving between settings child routes", () => {
    expect(shouldBlockSettingsNavigation(true, "/settings", "/settings/policies")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/policies", "/settings/accounts")).toBe(
      false,
    );
    expect(shouldBlockSettingsNavigation(true, "/settings/accounts", "/settings/media")).toBe(
      false,
    );
    expect(shouldBlockSettingsNavigation(true, "/settings/media", "/settings/network")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/network", "/dashboard")).toBe(true);
    expect(shouldBlockSettingsNavigation(false, "/settings/network", "/dashboard")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/network", "/settings/about")).toBe(false);
    expect(isReadOnlySettingsPath("/settings/about")).toBe(true);
    expect(isReadOnlySettingsPath("/settings/changelog")).toBe(true);
    expect(isReadOnlySettingsPath("/settings/network")).toBe(false);
  });

  it("matches the upstream hierarchy while keeping media, network, about, and changelog split", () => {
    const paths = settingsRoutes.map((route) => route.to);
    expect(paths).toEqual([
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
    expect(settingsRoutes.map((route) => route.group)).toEqual([
      "providers",
      "providers",
      "providers",
      "delivery",
      "delivery",
      "operations",
      "operations",
      "system",
      "system",
    ]);
    expect(new Set<string>(paths).has("/settings")).toBe(false);
    const readOnly = settingsRoutes.filter((route) => route.readOnly).map((route) => route.to);
    expect(readOnly).toEqual(["/settings/about", "/settings/changelog"]);
  });

  it("keeps the shared form alive when moving between the split provider routes", () => {
    expect(shouldBlockSettingsNavigation(true, "/settings/build", "/settings/web")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/web", "/settings/policies")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/policies", "/settings/accounts")).toBe(
      false,
    );
    expect(shouldBlockSettingsNavigation(true, "/settings/web", "/settings/console")).toBe(false);
    expect(shouldBlockSettingsNavigation(true, "/settings/console", "/settings/network")).toBe(
      false,
    );
    expect(shouldBlockSettingsNavigation(true, "/settings/build", "/dashboard")).toBe(true);
    expect(isReadOnlySettingsPath("/settings/build")).toBe(false);
    expect(isReadOnlySettingsPath("/settings/web")).toBe(false);
    expect(isReadOnlySettingsPath("/settings/console")).toBe(false);
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

  it("covers the 58-field upstream v3.0.10 settings contract without duplicates", () => {
    expect(UPSTREAM_V3010_SETTINGS_CONTRACT).toHaveLength(58);
    expect(new Set(UPSTREAM_V3010_SETTINGS_CONTRACT).size).toBe(58);
    const form = toSettingsForm(settingsConfigFixture());
    const contractView = {
      ...form,
      providerBuild: { ...form.providerBuild, tokenAuthConfigured: true },
    };
    expect(UPSTREAM_V3010_SETTINGS_CONTRACT.filter((path) => !hasPath(contractView, path))).toEqual(
      [],
    );
  });

  it("partitions the legacy general surface without a field omission or duplicate", () => {
    const editableGeneralFields = UPSTREAM_V3010_SETTINGS_CONTRACT.filter((path) =>
      /^(server|batch|routing|audit|clientKeyDefaults|accounts)\./.test(path),
    );
    const generalPanelFields = getSettingsPanelFieldPaths(settingsGeneralPanelSource);
    const runtimePoliciesPanelFields = getSettingsPanelFieldPaths(
      settingsRuntimePoliciesPanelSource,
    );
    const accountMaintenancePanelFields = getSettingsPanelFieldPaths(accountMaintenancePanelSource);
    const partitionedFields = [
      ...generalPanelFields,
      ...runtimePoliciesPanelFields,
      ...accountMaintenancePanelFields,
    ];

    expect(generalPanelFields).toEqual(GENERAL_SETTINGS_ROUTE_FIELDS);
    expect(runtimePoliciesPanelFields).toEqual(RUNTIME_POLICIES_SETTINGS_ROUTE_FIELDS);
    expect(accountMaintenancePanelFields).toEqual(ACCOUNT_MAINTENANCE_SETTINGS_ROUTE_FIELDS);
    expect(new Set(partitionedFields).size).toBe(partitionedFields.length);
    expect(partitionedFields).toEqual(editableGeneralFields);
  });

  it("accepts finite attempts up to 200 and the explicit unlimited sentinel", () => {
    const form = toSettingsForm(settingsConfigFixture());
    expect(
      settingsSchema.safeParse({ ...form, routing: { ...form.routing, maxAttempts: -1 } }).success,
    ).toBe(true);
    expect(
      settingsSchema.safeParse({ ...form, routing: { ...form.routing, maxAttempts: 200 } }).success,
    ).toBe(true);
    expect(
      settingsSchema.safeParse({ ...form, routing: { ...form.routing, maxAttempts: 0 } }).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse({ ...form, routing: { ...form.routing, maxAttempts: 201 } }).success,
    ).toBe(false);
  });

  it("applies one trusted-service URL policy to Statsig and FlareSolverr endpoints", () => {
    const form = toSettingsForm(settingsConfigFixture());
    const withURLs = (statsigSignerURL: string, flareSolverrURL: string) => ({
      ...form,
      providerWeb: {
        ...form.providerWeb,
        statsigMode: "url" as const,
        statsigSignerURL,
        clearanceMode: "flaresolverr" as const,
        flareSolverrURL,
      },
    });

    expect(
      settingsSchema.safeParse(
        withURLs("http://statsig.internal/sign", "http://flaresolverr.local/v1"),
      ).success,
    ).toBe(true);
    expect(
      settingsSchema.safeParse(
        withURLs("https://statsig.example.com/sign", "https://solver.example.com/v1"),
      ).success,
    ).toBe(true);
    expect(
      settingsSchema.safeParse(
        withURLs("http://statsig.example.com/sign", "https://solver.example.com/v1"),
      ).success,
    ).toBe(false);
    expect(
      settingsSchema.safeParse(
        withURLs("https://statsig.example.com/sign", "https://solver.example.com:8443/v1"),
      ).success,
    ).toBe(false);
  });
});
