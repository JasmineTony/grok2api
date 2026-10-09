import {
  createObjectDecoder,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOneOf,
  isOptional,
  isString,
} from "@/shared/api/decoder";

import type { SettingsConfigDTO, SettingsSnapshotDTO } from "@/features/settings/settings-dto";

const settingsConfigValidator = hasShape({
  server: hasShape({ maxConcurrentRequests: isNumber }),
  providerBuild: hasShape({
    baseURL: isString,
    fallbackBaseURL: isString,
    clientVersion: isString,
    clientIdentifier: isString,
    tokenAuth: isString,
    tokenAuthConfigured: isBoolean,
    userAgent: isString,
    responseHeaderTimeout: isString,
    streamIdleTimeout: isString,
  }),
  providerWeb: hasShape({
    baseURL: isString,
    quotaTimeout: isString,
    chatTimeout: isString,
    streamIdleTimeout: isOptional(isString),
    imageTimeout: isString,
    videoTimeout: isString,
    statsigMode: isOneOf("manual", "url"),
    statsigManualValue: isOptional(isString),
    statsigManualConfigured: isBoolean,
    statsigSignerURL: isString,
    clearanceMode: isOneOf("manual", "flaresolverr", "on_demand"),
    flareSolverrURL: isString,
    clearanceTimeout: isString,
    clearanceRefresh: isString,
    mediaConcurrency: isNumber,
    allowNSFW: isBoolean,
    freeVideoDurationCap: isOptional(isNumber),
    recoveryBackoffBase: isString,
    recoveryBackoffMax: isString,
  }),
  providerConsole: hasShape({ baseURL: isString, chatTimeout: isString, streamIdleTimeout: isOptional(isString) }),
  batch: hasShape({
    importConcurrency: isNumber,
    conversionConcurrency: isNumber,
    syncConcurrency: isNumber,
    refreshConcurrency: isNumber,
    randomDelay: isString,
  }),
  media: hasShape({
    maxImageBytes: isNumber,
    maxTotalBytes: isNumber,
    cleanupThresholdPercent: isNumber,
    cleanupInterval: isString,
  }),
  frontend: hasShape({ publicApiBaseURL: isString }),
  routing: hasShape({
    stickyTTL: isString,
    cooldownBase: isString,
    cooldownMax: isString,
    capacityWait: isString,
    maxAttempts: isNumber,
    videoMaxAttempts: isNumber,
    preferFreeBuild: isBoolean,
    markBuildChatDeniedAsReauth: isBoolean,
    accountIsolatedConnections: isOptional(isBoolean),
    segmentedSelector: isOptional(hasShape({ enabled: isBoolean, minCandidates: isNumber, windowSize: isNumber })),
  }),
  audit: hasShape({
    bufferSize: isNumber,
    batchSize: isNumber,
    flushInterval: isString,
    commitDelayMS: isOptional(isNumber),
    retentionDays: isOptional(isNumber),
  }),
  clientKeyDefaults: hasShape({ rpmLimit: isNumber, maxConcurrent: isNumber }),
  // Older backends may omit accounts; withSettingsDefaults supplies a safe local default.
  accounts: isOptional(
    hasShape({
      markBuildForbiddenReauth: isOptional(isBoolean),
      buildForbiddenReauthCodes: isOptional(isArrayOf(isString)),
      excludeBuildBotFlaggedFromScheduling: isOptional(isBoolean),
      autoCleanReauthEnabled: isBoolean,
      autoCleanReauthInterval: isString,
      autoCleanReauthMinAge: isString,
      autoCleanIncludeDisabled: isBoolean,
    }),
  ),
});
const defaultAccountsConfig = (): SettingsConfigDTO["accounts"] => ({
  markBuildForbiddenReauth: false,
  buildForbiddenReauthCodes: ["permission-denied"],
  excludeBuildBotFlaggedFromScheduling: false,
  autoCleanReauthEnabled: false,
  autoCleanReauthInterval: "10m",
  autoCleanReauthMinAge: "1h",
  autoCleanIncludeDisabled: false,
});
function withSettingsDefaults(snapshot: SettingsSnapshotDTO): SettingsSnapshotDTO {
  const accounts = snapshot.config.accounts ?? defaultAccountsConfig();
  const segmentedSelector = snapshot.config.routing.segmentedSelector ?? {
    enabled: true,
    minCandidates: 3000,
    windowSize: 64,
  };
  return {
    ...snapshot,
    config: {
      ...snapshot.config,
      providerWeb: {
        ...snapshot.config.providerWeb,
        streamIdleTimeout: snapshot.config.providerWeb.streamIdleTimeout || "1m30s",
      },
      providerConsole: {
        ...snapshot.config.providerConsole,
        streamIdleTimeout: snapshot.config.providerConsole.streamIdleTimeout || "2m",
      },
      audit: {
        ...snapshot.config.audit,
        commitDelayMS: snapshot.config.audit.commitDelayMS ?? 5,
        retentionDays: snapshot.config.audit.retentionDays ?? 7,
      },
      routing: {
        ...snapshot.config.routing,
        markBuildChatDeniedAsReauth: snapshot.config.routing.markBuildChatDeniedAsReauth ?? false,
        accountIsolatedConnections: snapshot.config.routing.accountIsolatedConnections ?? false,
        segmentedSelector: {
          enabled: segmentedSelector.enabled ?? true,
          minCandidates: segmentedSelector.minCandidates || 3000,
          windowSize: segmentedSelector.windowSize || 64,
        },
      },
      accounts: {
        markBuildForbiddenReauth: accounts.markBuildForbiddenReauth ?? false,
        buildForbiddenReauthCodes: accounts.buildForbiddenReauthCodes ?? ["permission-denied"],
        excludeBuildBotFlaggedFromScheduling: accounts.excludeBuildBotFlaggedFromScheduling ?? false,
        autoCleanReauthEnabled: accounts.autoCleanReauthEnabled ?? false,
        autoCleanReauthInterval: accounts.autoCleanReauthInterval || "10m",
        autoCleanReauthMinAge: accounts.autoCleanReauthMinAge || "1h",
        autoCleanIncludeDisabled: accounts.autoCleanIncludeDisabled ?? false,
      },
    },
  };
}
const decodeSettingsSnapshotRaw = createObjectDecoder<SettingsSnapshotDTO>("settings", {
  config: settingsConfigValidator,
  recommendedProviderBuild: hasShape({ clientVersion: isString, userAgent: isString }),
  updatedAt: isString,
  revision: isString,
  restartRequired: isArrayOf(isString),
});
export const decodeSettingsSnapshot = (value: unknown): SettingsSnapshotDTO =>
  withSettingsDefaults(decodeSettingsSnapshotRaw(value));
