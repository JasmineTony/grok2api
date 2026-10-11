import { describe, expect, it } from "vitest";

import type { SettingsConfigDTO } from "@/features/settings/settings-dto";
import { toSettingsDTO, toSettingsForm } from "@/features/settings/settings-model";

// 设置模型映射的纯函数测试：锁定拆分后 toSettingsForm / toSettingsDTO 的字段、
// 默认值与时长/字节换算语义（含既有用例未覆盖的 videoMaxAttempts 回落分支）。
function configPayload(): SettingsConfigDTO {
  return {
    server: { maxConcurrentRequests: 1234 },
    providerBuild: {
      baseURL: "https://build.example.com",
      fallbackBaseURL: "https://fallback.example.com",
      clientVersion: "1.0.0",
      clientIdentifier: "grok2api",
      tokenAuth: "token-auth",
      tokenAuthConfigured: true,
      userAgent: "grok2api/1.0.0",
      responseHeaderTimeout: "30s",
      streamIdleTimeout: "1m",
    },
    providerWeb: {
      baseURL: "https://web.example.com",
      quotaTimeout: "30s",
      chatTimeout: "2m",
      streamIdleTimeout: "1m30s",
      imageTimeout: "5m",
      videoTimeout: "10m",
      statsigMode: "url",
      statsigManualConfigured: false,
      statsigSignerURL: "https://signer.example.com/sign",
      clearanceMode: "manual",
      flareSolverrURL: "https://flaresolverr.example.com",
      clearanceTimeout: "1m",
      clearanceRefresh: "1h",
      mediaConcurrency: 2,
      allowNSFW: false,
      recoveryBackoffBase: "1s",
      recoveryBackoffMax: "10s",
    },
    providerConsole: { baseURL: "https://console.example.com", chatTimeout: "5m", streamIdleTimeout: "2m" },
    batch: {
      importConcurrency: 2,
      conversionConcurrency: 2,
      syncConcurrency: 2,
      refreshConcurrency: 2,
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
      accountIsolatedConnections: false,
      segmentedSelector: { enabled: true, minCandidates: 3000, windowSize: 64 },
    },
    audit: { bufferSize: 100, batchSize: 10, flushInterval: "1s", commitDelayMS: 5 },
    clientKeyDefaults: { rpmLimit: 60, maxConcurrent: 5 },
    accounts: {
      markBuildForbiddenReauth: false,
      buildForbiddenReauthCodes: ["permission-denied"],
      excludeBuildBotFlaggedFromScheduling: false,
      autoCleanReauthEnabled: false,
      autoCleanReauthInterval: "10m",
      autoCleanReauthMinAge: "1h",
      autoCleanIncludeDisabled: false,
    },
  };
}

describe("toSettingsForm", () => {
  it("把时长与字节大小换算为可编辑值", () => {
    const form = toSettingsForm(configPayload());

    expect(form.providerBuild.responseHeaderTimeout).toEqual({ value: 30, unit: "s" });
    expect(form.providerWeb.streamIdleTimeout).toEqual({ value: 90, unit: "s" });
    expect(form.providerWeb.clearanceRefresh).toEqual({ value: 1, unit: "h" });
    expect(form.providerConsole.streamIdleTimeout).toEqual({ value: 2, unit: "m" });
    expect(form.batch.randomDelay).toBe(100);
    expect(form.media.maxImageSize).toEqual({ value: 1, unit: "MiB" });
    expect(form.media.maxTotalSize).toEqual({ value: 1, unit: "GiB" });
    expect(form.accounts.buildForbiddenReauthCodes).toBe("permission-denied");
    expect(form.routing.segmentedSelector).toEqual({ enabled: true, minCandidates: 3000, windowSize: 64 });
  });

  it("缺失字段按默认值补齐：清关视频上限 6、审计保留 7 天、Statsig 手填值清空", () => {
    const form = toSettingsForm(configPayload());

    expect(form.providerWeb.freeVideoDurationCap).toBe(6);
    expect(form.providerWeb.statsigManualValue).toBe("");
    expect(form.audit.retentionDays).toBe(7);
  });

  it("视频最大尝试次数为 0 时回落 999，-1（不限）保持不变", () => {
    const base = configPayload();
    const zeroed = { ...base, routing: { ...base.routing, videoMaxAttempts: 0 } };
    const unlimited = { ...base, routing: { ...base.routing, videoMaxAttempts: -1 } };

    expect(toSettingsForm(zeroed).routing.videoMaxAttempts).toBe(999);
    expect(toSettingsForm(unlimited).routing.videoMaxAttempts).toBe(-1);
    expect(toSettingsDTO(toSettingsForm(zeroed)).routing.videoMaxAttempts).toBe(999);
    expect(toSettingsDTO(toSettingsForm(unlimited)).routing.videoMaxAttempts).toBe(-1);
  });
});

describe("toSettingsDTO", () => {
  it("把可编辑值还原为接口字符串、字节数与数组", () => {
    const dto = toSettingsDTO(toSettingsForm(configPayload()));

    expect(dto.providerBuild.responseHeaderTimeout).toBe("30s");
    expect(dto.providerWeb.streamIdleTimeout).toBe("90s");
    expect(dto.providerWeb.clearanceRefresh).toBe("1h");
    expect(dto.batch.randomDelay).toBe("100ms");
    expect(dto.media.maxImageBytes).toBe(1_048_576);
    expect(dto.media.maxTotalBytes).toBe(1_073_741_824);
    expect(dto.audit.retentionDays).toBe(7);
    expect(dto.accounts.buildForbiddenReauthCodes).toEqual(["permission-denied"]);
    expect(dto.routing.videoMaxAttempts).toBe(3);
  });

  it("天单位按 24h 输出，公开地址提交前去除首尾空白，禁用码去重并转小写", () => {
    const form = toSettingsForm(configPayload());
    const dto = toSettingsDTO({
      ...form,
      frontend: { publicApiBaseURL: "  https://api.example.com  " },
      routing: { ...form.routing, stickyTTL: { value: 2, unit: "d" } },
      accounts: { ...form.accounts, buildForbiddenReauthCodes: "Permission-Denied\n\nX.Y\npermission-denied" },
    });

    expect(dto.routing.stickyTTL).toBe("48h");
    expect(dto.frontend.publicApiBaseURL).toBe("https://api.example.com");
    expect(dto.accounts.buildForbiddenReauthCodes).toEqual(["permission-denied", "x.y"]);
  });
});
