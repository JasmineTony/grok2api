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

function providerBuildForm(config: SettingsConfigDTO["providerBuild"]): SettingsForm["providerBuild"] {
  return {
    ...config,
    responseHeaderTimeout: parseDuration(config.responseHeaderTimeout),
    streamIdleTimeout: parseDuration(config.streamIdleTimeout),
  };
}

function providerWebForm(config: SettingsConfigDTO["providerWeb"]): SettingsForm["providerWeb"] {
  return {
    ...config,
    statsigManualValue: "",
    clearanceTimeout: parseDuration(config.clearanceTimeout),
    clearanceRefresh: parseDuration(config.clearanceRefresh),
    quotaTimeout: parseDuration(config.quotaTimeout),
    chatTimeout: parseDuration(config.chatTimeout),
    streamIdleTimeout: parseDuration(config.streamIdleTimeout),
    imageTimeout: parseDuration(config.imageTimeout),
    videoTimeout: parseDuration(config.videoTimeout),
    freeVideoDurationCap: config.freeVideoDurationCap || 6,
    recoveryBackoffBase: parseDuration(config.recoveryBackoffBase),
    recoveryBackoffMax: parseDuration(config.recoveryBackoffMax),
  };
}

function providerConsoleForm(config: SettingsConfigDTO["providerConsole"]): SettingsForm["providerConsole"] {
  return {
    ...config,
    chatTimeout: parseDuration(config.chatTimeout),
    streamIdleTimeout: parseDuration(config.streamIdleTimeout),
  };
}

function batchForm(config: SettingsConfigDTO["batch"]): SettingsForm["batch"] {
  return { ...config, randomDelay: parseDurationMilliseconds(config.randomDelay) };
}

function mediaForm(config: SettingsConfigDTO["media"]): SettingsForm["media"] {
  return {
    maxImageSize: parseByteSize(config.maxImageBytes),
    maxTotalSize: parseByteSize(config.maxTotalBytes),
    cleanupThresholdPercent: config.cleanupThresholdPercent,
    cleanupInterval: parseDuration(config.cleanupInterval),
  };
}

/** 视频路由次数缺失或为 0 时按 999 处理，与后端默认上限一致。 */
function videoMaxAttemptsOrDefault(value: number): number {
  return !value || value === 0 ? 999 : value;
}

function routingForm(config: SettingsConfigDTO["routing"]): SettingsForm["routing"] {
  return {
    stickyTTL: parseDuration(config.stickyTTL),
    cooldownBase: parseDuration(config.cooldownBase),
    cooldownMax: parseDuration(config.cooldownMax),
    capacityWait: parseDuration(config.capacityWait),
    maxAttempts: config.maxAttempts,
    videoMaxAttempts: videoMaxAttemptsOrDefault(config.videoMaxAttempts),
    preferFreeBuild: config.preferFreeBuild,
    markBuildChatDeniedAsReauth: config.markBuildChatDeniedAsReauth,
    accountIsolatedConnections: config.accountIsolatedConnections,
    segmentedSelector: config.segmentedSelector,
  };
}

function auditForm(config: SettingsConfigDTO["audit"]): SettingsForm["audit"] {
  return {
    bufferSize: config.bufferSize,
    batchSize: config.batchSize,
    flushInterval: parseDuration(config.flushInterval),
    commitDelayMS: config.commitDelayMS,
    retentionDays: config.retentionDays ?? 7,
  };
}

function accountsForm(config: SettingsConfigDTO["accounts"]): SettingsForm["accounts"] {
  return {
    markBuildForbiddenReauth: config.markBuildForbiddenReauth,
    buildForbiddenReauthCodes: config.buildForbiddenReauthCodes.join("\n"),
    excludeBuildBotFlaggedFromScheduling: config.excludeBuildBotFlaggedFromScheduling,
    autoCleanReauthEnabled: config.autoCleanReauthEnabled,
    autoCleanReauthInterval: parseDuration(config.autoCleanReauthInterval),
    autoCleanReauthMinAge: parseDuration(config.autoCleanReauthMinAge),
    autoCleanIncludeDisabled: config.autoCleanIncludeDisabled,
  };
}

/** 接口配置 → 表单模型：时长与字节大小换算为可编辑的 { value, unit }。 */
export function toSettingsForm(config: SettingsConfigDTO): SettingsForm {
  return {
    server: config.server,
    providerBuild: providerBuildForm(config.providerBuild),
    providerWeb: providerWebForm(config.providerWeb),
    providerConsole: providerConsoleForm(config.providerConsole),
    batch: batchForm(config.batch),
    media: mediaForm(config.media),
    frontend: { publicApiBaseURL: config.frontend.publicApiBaseURL },
    routing: routingForm(config.routing),
    audit: auditForm(config.audit),
    clientKeyDefaults: config.clientKeyDefaults,
    accounts: accountsForm(config.accounts),
  };
}

function providerBuildDTO(config: SettingsForm["providerBuild"]): SettingsConfigDTO["providerBuild"] {
  return {
    ...config,
    responseHeaderTimeout: formatDuration(config.responseHeaderTimeout),
    streamIdleTimeout: formatDuration(config.streamIdleTimeout),
  };
}

function providerWebDTO(config: SettingsForm["providerWeb"]): SettingsConfigDTO["providerWeb"] {
  return {
    ...config,
    quotaTimeout: formatDuration(config.quotaTimeout),
    chatTimeout: formatDuration(config.chatTimeout),
    streamIdleTimeout: formatDuration(config.streamIdleTimeout),
    imageTimeout: formatDuration(config.imageTimeout),
    videoTimeout: formatDuration(config.videoTimeout),
    clearanceTimeout: formatDuration(config.clearanceTimeout),
    clearanceRefresh: formatDuration(config.clearanceRefresh),
    recoveryBackoffBase: formatDuration(config.recoveryBackoffBase),
    recoveryBackoffMax: formatDuration(config.recoveryBackoffMax),
  };
}

function providerConsoleDTO(config: SettingsForm["providerConsole"]): SettingsConfigDTO["providerConsole"] {
  return {
    ...config,
    chatTimeout: formatDuration(config.chatTimeout),
    streamIdleTimeout: formatDuration(config.streamIdleTimeout),
  };
}

function batchDTO(config: SettingsForm["batch"]): SettingsConfigDTO["batch"] {
  return { ...config, randomDelay: `${config.randomDelay}ms` };
}

function mediaDTO(config: SettingsForm["media"]): SettingsConfigDTO["media"] {
  return {
    maxImageBytes: byteSizeBytes(config.maxImageSize),
    maxTotalBytes: byteSizeBytes(config.maxTotalSize),
    cleanupThresholdPercent: config.cleanupThresholdPercent,
    cleanupInterval: formatDuration(config.cleanupInterval),
  };
}

function routingDTO(config: SettingsForm["routing"]): SettingsConfigDTO["routing"] {
  return {
    stickyTTL: formatDuration(config.stickyTTL),
    cooldownBase: formatDuration(config.cooldownBase),
    cooldownMax: formatDuration(config.cooldownMax),
    capacityWait: formatDuration(config.capacityWait),
    maxAttempts: config.maxAttempts,
    videoMaxAttempts: videoMaxAttemptsOrDefault(config.videoMaxAttempts),
    preferFreeBuild: config.preferFreeBuild,
    markBuildChatDeniedAsReauth: config.markBuildChatDeniedAsReauth,
    accountIsolatedConnections: config.accountIsolatedConnections,
    segmentedSelector: config.segmentedSelector,
  };
}

function auditDTO(config: SettingsForm["audit"]): SettingsConfigDTO["audit"] {
  return {
    bufferSize: config.bufferSize,
    batchSize: config.batchSize,
    flushInterval: formatDuration(config.flushInterval),
    commitDelayMS: config.commitDelayMS,
    retentionDays: config.retentionDays,
  };
}

function accountsDTO(config: SettingsForm["accounts"]): SettingsConfigDTO["accounts"] {
  return {
    markBuildForbiddenReauth: config.markBuildForbiddenReauth,
    buildForbiddenReauthCodes: parseForbiddenCodes(config.buildForbiddenReauthCodes),
    excludeBuildBotFlaggedFromScheduling: config.excludeBuildBotFlaggedFromScheduling,
    autoCleanReauthEnabled: config.autoCleanReauthEnabled,
    autoCleanReauthInterval: formatDuration(config.autoCleanReauthInterval),
    autoCleanReauthMinAge: formatDuration(config.autoCleanReauthMinAge),
    autoCleanIncludeDisabled: config.autoCleanIncludeDisabled,
  };
}

/** 表单模型 → 接口配置：{ value, unit } 换算回时长字符串与字节数。 */
export function toSettingsDTO(config: SettingsForm): SettingsConfigDTO {
  return {
    server: config.server,
    providerBuild: providerBuildDTO(config.providerBuild),
    providerWeb: providerWebDTO(config.providerWeb),
    providerConsole: providerConsoleDTO(config.providerConsole),
    batch: batchDTO(config.batch),
    media: mediaDTO(config.media),
    frontend: { publicApiBaseURL: config.frontend.publicApiBaseURL.trim() },
    routing: routingDTO(config.routing),
    audit: auditDTO(config.audit),
    clientKeyDefaults: config.clientKeyDefaults,
    accounts: accountsDTO(config.accounts),
  };
}
