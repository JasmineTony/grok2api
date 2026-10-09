/** 设置接口的只读 DTO 契约：纯类型模块，供 decoder、模型映射与页面复用。 */
export type SettingsConfigDTO = {
  server: { maxConcurrentRequests: number };
  providerBuild: {
    baseURL: string;
    fallbackBaseURL: string;
    clientVersion: string;
    clientIdentifier: string;
    tokenAuth: string;
    tokenAuthConfigured: boolean;
    userAgent: string;
    responseHeaderTimeout: string;
    streamIdleTimeout: string;
  };
  providerWeb: {
    baseURL: string;
    quotaTimeout: string;
    chatTimeout: string;
    streamIdleTimeout: string;
    imageTimeout: string;
    videoTimeout: string;
    statsigMode: "manual" | "url";
    statsigManualValue?: string;
    statsigManualConfigured: boolean;
    statsigSignerURL: string;
    clearanceMode: ClearanceMode;
    flareSolverrURL: string;
    clearanceTimeout: string;
    clearanceRefresh: string;
    mediaConcurrency: number;
    allowNSFW: boolean;
    freeVideoDurationCap?: number;
    recoveryBackoffBase: string;
    recoveryBackoffMax: string;
  };
  providerConsole: { baseURL: string; chatTimeout: string; streamIdleTimeout: string };
  batch: {
    importConcurrency: number;
    conversionConcurrency: number;
    syncConcurrency: number;
    refreshConcurrency: number;
    randomDelay: string;
  };
  media: {
    maxImageBytes: number;
    maxTotalBytes: number;
    cleanupThresholdPercent: number;
    cleanupInterval: string;
  };
  frontend: { publicApiBaseURL: string };
  routing: {
    stickyTTL: string;
    cooldownBase: string;
    cooldownMax: string;
    capacityWait: string;
    maxAttempts: number;
    videoMaxAttempts: number;
    preferFreeBuild: boolean;
    markBuildChatDeniedAsReauth: boolean;
    accountIsolatedConnections: boolean;
    segmentedSelector: { enabled: boolean; minCandidates: number; windowSize: number };
  };
  audit: {
    bufferSize: number;
    batchSize: number;
    flushInterval: string;
    commitDelayMS: number;
    retentionDays?: number;
  };
  clientKeyDefaults: { rpmLimit: number; maxConcurrent: number };
  accounts: {
    markBuildForbiddenReauth: boolean;
    buildForbiddenReauthCodes: string[];
    excludeBuildBotFlaggedFromScheduling: boolean;
    autoCleanReauthEnabled: boolean;
    autoCleanReauthInterval: string;
    autoCleanReauthMinAge: string;
    autoCleanIncludeDisabled: boolean;
  };
};

export type ClearanceMode = "manual" | "flaresolverr" | "on_demand";

export type SettingsSnapshotDTO = {
  config: SettingsConfigDTO;
  recommendedProviderBuild: { clientVersion: string; userAgent: string };
  updatedAt: string;
  revision: string;
  restartRequired: string[];
};
