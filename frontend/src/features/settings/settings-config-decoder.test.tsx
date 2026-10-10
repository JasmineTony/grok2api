import { describe, expect, it } from "vitest";

import { decodeSettingsSnapshot } from "@/features/settings/settings-config-decoder";

// 快照解码的默认值补齐：老后端缺字段时必须回落到安全默认值（settings-config-decoder.ts:105-150）。
// 纯逻辑模块用 vitest（v8 覆盖率）运行，不经过 jsdom 渲染。
// 输入侧按「服务端 wire 原始值」构造（Record<string, unknown>），
// 输出侧的默认值断言直接用 decodeSettingsSnapshot 的返回类型，不引入类型断言。

/** 与 settingsConfigValidator 校验一致的最小完整快照（不含 accounts）。 */
function rawSnapshot(): Record<string, unknown> {
  return {
    config: {
      server: { maxConcurrentRequests: 100 },
      providerBuild: {
        baseURL: "https://build.example.com",
        fallbackBaseURL: "https://fallback.example.com",
        clientVersion: "1.0.0",
        clientIdentifier: "grok2api",
        tokenAuth: "token",
        tokenAuthConfigured: false,
        userAgent: "ua",
        responseHeaderTimeout: "30s",
        streamIdleTimeout: "1m",
      },
      providerWeb: {
        baseURL: "https://web.example.com",
        quotaTimeout: "30s",
        chatTimeout: "2m",
        imageTimeout: "5m",
        videoTimeout: "10m",
        statsigMode: "manual",
        statsigManualConfigured: false,
        statsigSignerURL: "",
        clearanceMode: "manual",
        flareSolverrURL: "",
        clearanceTimeout: "1m",
        clearanceRefresh: "1h",
        mediaConcurrency: 2,
        allowNSFW: false,
        recoveryBackoffBase: "1s",
        recoveryBackoffMax: "10s",
      },
      providerConsole: { baseURL: "https://console.example.com", chatTimeout: "5m" },
      batch: {
        importConcurrency: 1,
        conversionConcurrency: 1,
        syncConcurrency: 1,
        refreshConcurrency: 1,
        randomDelay: "100ms",
      },
      media: {
        maxImageBytes: 1_048_576,
        maxTotalBytes: 1_073_741_824,
        cleanupThresholdPercent: 90,
        cleanupInterval: "1h",
      },
      frontend: { publicApiBaseURL: "https://api.example.com" },
      routing: {
        stickyTTL: "5m",
        cooldownBase: "1m",
        cooldownMax: "10m",
        capacityWait: "5s",
        maxAttempts: 3,
        videoMaxAttempts: 3,
        preferFreeBuild: true,
        markBuildChatDeniedAsReauth: false,
      },
      audit: { bufferSize: 100, batchSize: 10, flushInterval: "1s" },
      clientKeyDefaults: { rpmLimit: 60, maxConcurrent: 5 },
    },
    recommendedProviderBuild: { clientVersion: "1.0.0", userAgent: "ua" },
    updatedAt: "2026-01-01T00:00:00Z",
    revision: "rev-1",
    restartRequired: [],
  };
}

/** 取原始快照的 config，便于按用例删除/覆盖顶层分组。 */
function rawConfig(payload: Record<string, unknown>): Record<string, unknown> {
  const config = payload.config;
  if (typeof config !== "object" || config === null) throw new Error("快照缺少 config");
  return config as Record<string, unknown>;
}

/** 取 config 下的某个分组，便于按用例删除/覆盖字段。 */
function rawGroup(payload: Record<string, unknown>, group: string): Record<string, unknown> {
  const value = rawConfig(payload)[group];
  if (typeof value !== "object" || value === null) throw new Error(`快照缺少分组：${group}`);
  return value as Record<string, unknown>;
}

describe("decodeSettingsSnapshot 缺失分组时补默认值", () => {
  it("缺失 accounts 时补默认降级规则", () => {
    const decoded = decodeSettingsSnapshot(rawSnapshot());

    expect(decoded.config.accounts).toEqual({
      markBuildForbiddenReauth: false,
      buildForbiddenReauthCodes: ["permission-denied"],
      excludeBuildBotFlaggedFromScheduling: false,
      autoCleanReauthEnabled: false,
      autoCleanReauthInterval: "10m",
      autoCleanReauthMinAge: "1h",
      autoCleanIncludeDisabled: false,
    });
  });

  it("缺失 segmentedSelector 时补默认分段选择器", () => {
    const decoded = decodeSettingsSnapshot(rawSnapshot());

    expect(decoded.config.routing.segmentedSelector).toEqual({
      enabled: true,
      minCandidates: 3000,
      windowSize: 64,
    });
  });

  it("缺失 providerConsole.streamIdleTimeout 时补 2m", () => {
    const payload = rawSnapshot();
    rawGroup(payload, "providerConsole").streamIdleTimeout = undefined;

    expect(decodeSettingsSnapshot(payload).config.providerConsole.streamIdleTimeout).toBe("2m");
  });

  it("缺失可选路由布尔与 providerWeb.streamIdleTimeout 时补默认值", () => {
    const payload = rawSnapshot();
    // 只有 accountIsolatedConnections 是 isOptional(isBoolean)；缺失时命中 ?? 右侧。
    delete rawGroup(payload, "routing").accountIsolatedConnections;
    // providerWeb.streamIdleTimeout 用空串命中 ||（?? 只对 null/undefined 生效）
    rawGroup(payload, "providerWeb").streamIdleTimeout = "";

    const decoded = decodeSettingsSnapshot(payload);

    expect(decoded.config.routing.accountIsolatedConnections).toBe(false);
    // 防御性兜底：Web 作用域缺该字段时长流会退化为不超时
    expect(decoded.config.providerWeb.streamIdleTimeout).toBe("1m30s");
  });

  it("必填路由布尔仍为 true 时原样保留", () => {
    const payload = rawSnapshot();
    rawGroup(payload, "routing").markBuildChatDeniedAsReauth = true;

    expect(decodeSettingsSnapshot(payload).config.routing.markBuildChatDeniedAsReauth).toBe(true);
  });

  it("缺失 audit 可选字段时补 commitDelayMS=5 与 retentionDays=7", () => {
    const payload = rawSnapshot();
    const audit = rawGroup(payload, "audit");
    delete audit.commitDelayMS;
    delete audit.retentionDays;

    const decoded = decodeSettingsSnapshot(payload);

    expect(decoded.config.audit.commitDelayMS).toBe(5);
    expect(decoded.config.audit.retentionDays).toBe(7);
  });
});

describe("decodeSettingsSnapshot 已提供值时不被默认值覆盖", () => {
  it("accounts 可选字段缺失时逐字段补默认值，已提供字段保留", () => {
    const payload = rawSnapshot();
    // 只提供必填字段：可选字段的 ?? 右侧分支全部命中
    rawConfig(payload).accounts = {
      autoCleanReauthEnabled: true,
      autoCleanReauthInterval: "30m",
      autoCleanReauthMinAge: "2h",
      autoCleanIncludeDisabled: true,
    };

    expect(decodeSettingsSnapshot(payload).config.accounts).toEqual({
      markBuildForbiddenReauth: false,
      buildForbiddenReauthCodes: ["permission-denied"],
      excludeBuildBotFlaggedFromScheduling: false,
      autoCleanReauthEnabled: true,
      autoCleanReauthInterval: "30m",
      autoCleanReauthMinAge: "2h",
      autoCleanIncludeDisabled: true,
    });
  });

  it("accounts 全部字段显式提供时原样保留", () => {
    const payload = rawSnapshot();
    rawConfig(payload).accounts = {
      markBuildForbiddenReauth: true,
      buildForbiddenReauthCodes: ["custom-code"],
      excludeBuildBotFlaggedFromScheduling: true,
      autoCleanReauthEnabled: false,
      autoCleanReauthInterval: "15m",
      autoCleanReauthMinAge: "3h",
      autoCleanIncludeDisabled: true,
    };

    const accounts = decodeSettingsSnapshot(payload).config.accounts;

    expect(accounts.markBuildForbiddenReauth).toBe(true);
    expect(accounts.buildForbiddenReauthCodes).toEqual(["custom-code"]);
    expect(accounts.excludeBuildBotFlaggedFromScheduling).toBe(true);
  });

  it("segmentedSelector 部分字段缺失时逐字段回填", () => {
    const payload = rawSnapshot();
    // enabled 为 false、其余为 0：0 是假值，命中 || 右侧的回填分支
    rawGroup(payload, "routing").segmentedSelector = { enabled: false, minCandidates: 0, windowSize: 0 };

    expect(decodeSettingsSnapshot(payload).config.routing.segmentedSelector).toEqual({
      enabled: false,
      minCandidates: 3000,
      windowSize: 64,
    });
  });

  it("audit.commitDelayMS=0 属于已提供值，?? 不覆盖", () => {
    const payload = rawSnapshot();
    rawGroup(payload, "audit").commitDelayMS = 0;

    expect(decodeSettingsSnapshot(payload).config.audit.commitDelayMS).toBe(0);
  });

  it("已提供的路由布尔、作用域超时与既有 retentionDays 原样保留", () => {
    const payload = rawSnapshot();
    const routing = rawGroup(payload, "routing");
    routing.markBuildChatDeniedAsReauth = true;
    routing.accountIsolatedConnections = true;
    rawGroup(payload, "providerWeb").streamIdleTimeout = "3m";
    rawGroup(payload, "providerConsole").streamIdleTimeout = "4m";
    rawGroup(payload, "audit").retentionDays = 30;

    const decoded = decodeSettingsSnapshot(payload);

    expect(decoded.config.routing.markBuildChatDeniedAsReauth).toBe(true);
    expect(decoded.config.routing.accountIsolatedConnections).toBe(true);
    expect(decoded.config.providerWeb.streamIdleTimeout).toBe("3m");
    expect(decoded.config.providerConsole.streamIdleTimeout).toBe("4m");
    expect(decoded.config.audit.retentionDays).toBe(30);
  });

  it("分段选择器已启用且非零时原样保留", () => {
    const payload = rawSnapshot();
    rawGroup(payload, "routing").segmentedSelector = { enabled: true, minCandidates: 500, windowSize: 32 };

    expect(decodeSettingsSnapshot(payload).config.routing.segmentedSelector).toEqual({
      enabled: true,
      minCandidates: 500,
      windowSize: 32,
    });
  });
});

describe("decodeSettingsSnapshot 校验失败", () => {
  it("必填字段类型不符时按解码失败抛出", () => {
    const payload = rawSnapshot();
    rawConfig(payload).server = { maxConcurrentRequests: "not-a-number" };

    expect(() => decodeSettingsSnapshot(payload)).toThrow();
  });

  it("缺失顶层 revision 时按解码失败抛出", () => {
    const payload = rawSnapshot();
    delete payload.revision;

    expect(() => decodeSettingsSnapshot(payload)).toThrow();
  });
});
