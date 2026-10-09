import type { SettingsConfigDTO } from "@/features/settings/settings-dto";
import { parseForbiddenCodes, type SettingsForm } from "@/features/settings/settings-schema";
import {
  byteSizeBytes,
  formatDuration,
  parseByteSize,
  parseDuration,
  parseDurationMilliseconds,
} from "@/features/settings/settings-units";

// 该模块是设置模型已冻结的对外入口（use-settings.ts / settings/egress-* 等既有调用方），
// 导出名与签名保持兼容，因此保留再导出；实现按职责拆分到：
//   settings-units.ts            → 时长/字节大小换算
//   settings-url-validation.ts   → URL 与 Statsig 校验
//   settings-proxy-validation.ts → 代理/隧道链接校验
//   settings-schema.ts           → zod 校验模式与 SettingsForm
export {
  MAX_ROUTING_ATTEMPTS,
  settingsSchema,
  UNLIMITED_ROUTING_ATTEMPTS,
  type SettingsForm,
} from "@/features/settings/settings-schema";
export {
  isByteSizeUnit,
  isDurationUnit,
  type ByteSizeUnit,
  type ByteSizeValue,
  type DurationUnit,
  type DurationValue,
} from "@/features/settings/settings-units";
export { validSubscriptionProxyURL } from "@/features/settings/settings-proxy-validation";

export function toSettingsForm(config: SettingsConfigDTO): SettingsForm {
  return {
    server: config.server,
    providerBuild: {
      ...config.providerBuild,
      responseHeaderTimeout: parseDuration(config.providerBuild.responseHeaderTimeout),
      streamIdleTimeout: parseDuration(config.providerBuild.streamIdleTimeout),
    },
    providerWeb: {
      ...config.providerWeb,
      statsigManualValue: "",
      clearanceTimeout: parseDuration(config.providerWeb.clearanceTimeout),
      clearanceRefresh: parseDuration(config.providerWeb.clearanceRefresh),
      quotaTimeout: parseDuration(config.providerWeb.quotaTimeout),
      chatTimeout: parseDuration(config.providerWeb.chatTimeout),
      streamIdleTimeout: parseDuration(config.providerWeb.streamIdleTimeout),
      imageTimeout: parseDuration(config.providerWeb.imageTimeout),
      videoTimeout: parseDuration(config.providerWeb.videoTimeout),
      freeVideoDurationCap: config.providerWeb.freeVideoDurationCap || 6,
      recoveryBackoffBase: parseDuration(config.providerWeb.recoveryBackoffBase),
      recoveryBackoffMax: parseDuration(config.providerWeb.recoveryBackoffMax),
    },
    providerConsole: {
      ...config.providerConsole,
      chatTimeout: parseDuration(config.providerConsole.chatTimeout),
      streamIdleTimeout: parseDuration(config.providerConsole.streamIdleTimeout),
    },
    batch: { ...config.batch, randomDelay: parseDurationMilliseconds(config.batch.randomDelay) },
    media: {
      maxImageSize: parseByteSize(config.media.maxImageBytes),
      maxTotalSize: parseByteSize(config.media.maxTotalBytes),
      cleanupThresholdPercent: config.media.cleanupThresholdPercent,
      cleanupInterval: parseDuration(config.media.cleanupInterval),
    },
    frontend: {
      publicApiBaseURL: config.frontend.publicApiBaseURL,
    },
    routing: {
      stickyTTL: parseDuration(config.routing.stickyTTL),
      cooldownBase: parseDuration(config.routing.cooldownBase),
      cooldownMax: parseDuration(config.routing.cooldownMax),
      capacityWait: parseDuration(config.routing.capacityWait),
      maxAttempts: config.routing.maxAttempts,
      videoMaxAttempts:
        !config.routing.videoMaxAttempts || config.routing.videoMaxAttempts === 0
          ? 999
          : config.routing.videoMaxAttempts,
      preferFreeBuild: config.routing.preferFreeBuild,
      markBuildChatDeniedAsReauth: config.routing.markBuildChatDeniedAsReauth,
      accountIsolatedConnections: config.routing.accountIsolatedConnections,
      segmentedSelector: config.routing.segmentedSelector,
    },
    audit: {
      bufferSize: config.audit.bufferSize,
      batchSize: config.audit.batchSize,
      flushInterval: parseDuration(config.audit.flushInterval),
      commitDelayMS: config.audit.commitDelayMS,
      retentionDays: config.audit.retentionDays ?? 7,
    },
    clientKeyDefaults: config.clientKeyDefaults,
    accounts: {
      markBuildForbiddenReauth: config.accounts.markBuildForbiddenReauth,
      buildForbiddenReauthCodes: config.accounts.buildForbiddenReauthCodes.join("\n"),
      excludeBuildBotFlaggedFromScheduling: config.accounts.excludeBuildBotFlaggedFromScheduling,
      autoCleanReauthEnabled: config.accounts.autoCleanReauthEnabled,
      autoCleanReauthInterval: parseDuration(config.accounts.autoCleanReauthInterval),
      autoCleanReauthMinAge: parseDuration(config.accounts.autoCleanReauthMinAge),
      autoCleanIncludeDisabled: config.accounts.autoCleanIncludeDisabled,
    },
  };
}

export function toSettingsDTO(config: SettingsForm): SettingsConfigDTO {
  return {
    server: config.server,
    providerBuild: {
      ...config.providerBuild,
      responseHeaderTimeout: formatDuration(config.providerBuild.responseHeaderTimeout),
      streamIdleTimeout: formatDuration(config.providerBuild.streamIdleTimeout),
    },
    providerWeb: {
      ...config.providerWeb,
      quotaTimeout: formatDuration(config.providerWeb.quotaTimeout),
      chatTimeout: formatDuration(config.providerWeb.chatTimeout),
      streamIdleTimeout: formatDuration(config.providerWeb.streamIdleTimeout),
      imageTimeout: formatDuration(config.providerWeb.imageTimeout),
      videoTimeout: formatDuration(config.providerWeb.videoTimeout),
      clearanceTimeout: formatDuration(config.providerWeb.clearanceTimeout),
      clearanceRefresh: formatDuration(config.providerWeb.clearanceRefresh),
      recoveryBackoffBase: formatDuration(config.providerWeb.recoveryBackoffBase),
      recoveryBackoffMax: formatDuration(config.providerWeb.recoveryBackoffMax),
    },
    providerConsole: {
      ...config.providerConsole,
      chatTimeout: formatDuration(config.providerConsole.chatTimeout),
      streamIdleTimeout: formatDuration(config.providerConsole.streamIdleTimeout),
    },
    batch: { ...config.batch, randomDelay: `${config.batch.randomDelay}ms` },
    media: {
      maxImageBytes: byteSizeBytes(config.media.maxImageSize),
      maxTotalBytes: byteSizeBytes(config.media.maxTotalSize),
      cleanupThresholdPercent: config.media.cleanupThresholdPercent,
      cleanupInterval: formatDuration(config.media.cleanupInterval),
    },
    frontend: {
      publicApiBaseURL: config.frontend.publicApiBaseURL.trim(),
    },
    routing: {
      stickyTTL: formatDuration(config.routing.stickyTTL),
      cooldownBase: formatDuration(config.routing.cooldownBase),
      cooldownMax: formatDuration(config.routing.cooldownMax),
      capacityWait: formatDuration(config.routing.capacityWait),
      maxAttempts: config.routing.maxAttempts,
      videoMaxAttempts:
        !config.routing.videoMaxAttempts || config.routing.videoMaxAttempts === 0
          ? 999
          : config.routing.videoMaxAttempts,
      preferFreeBuild: config.routing.preferFreeBuild,
      markBuildChatDeniedAsReauth: config.routing.markBuildChatDeniedAsReauth,
      accountIsolatedConnections: config.routing.accountIsolatedConnections,
      segmentedSelector: config.routing.segmentedSelector,
    },
    audit: {
      bufferSize: config.audit.bufferSize,
      batchSize: config.audit.batchSize,
      flushInterval: formatDuration(config.audit.flushInterval),
      commitDelayMS: config.audit.commitDelayMS,
      retentionDays: config.audit.retentionDays,
    },
    clientKeyDefaults: config.clientKeyDefaults,
    accounts: {
      markBuildForbiddenReauth: config.accounts.markBuildForbiddenReauth,
      buildForbiddenReauthCodes: parseForbiddenCodes(config.accounts.buildForbiddenReauthCodes),
      excludeBuildBotFlaggedFromScheduling: config.accounts.excludeBuildBotFlaggedFromScheduling,
      autoCleanReauthEnabled: config.accounts.autoCleanReauthEnabled,
      autoCleanReauthInterval: formatDuration(config.accounts.autoCleanReauthInterval),
      autoCleanReauthMinAge: formatDuration(config.accounts.autoCleanReauthMinAge),
      autoCleanIncludeDisabled: config.accounts.autoCleanIncludeDisabled,
    },
  };
}
