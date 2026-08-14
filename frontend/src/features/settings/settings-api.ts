import { type ApiClient } from "@/shared/api/client";
import {
  createObjectDecoder,
  createValidatedDecoder,
  decodeBooleanResult,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
} from "@/shared/api/decoder";
import type { SortOrder } from "@/shared/lib/table-sort";

export type ClearanceMode = "manual" | "flaresolverr" | "on_demand";

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
  audit: { bufferSize: number; batchSize: number; flushInterval: string; commitDelayMS: number };
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

export type EgressNodeDTO = {
  id: string;
  name: string;
  scope: EgressScope;
  enabled: boolean;
  proxyConfigured: boolean;
  userAgent: string;
  cookieConfigured: boolean;
  accountBoundProxy: boolean;
  proxyPool: boolean;
  sourceId?: string;
  accountCapacity: number;
  assignedAccountCount: number;
  probeStatus: "unknown" | "healthy" | "unhealthy";
  lastProbedAt?: string;
  probeLatencyMs: number;
  exitIp?: string;
  probeError?: string;
  probeProvider?: "ipinfo" | "cloudflare";
  ipv4Probe?: EgressIPProbeDTO;
  ipv6Probe?: EgressIPProbeDTO;
  health: number;
  failureCount: number;
  cooldownUntil?: string;
  lastError?: string;
};

export type EgressNodeInput = {
  name: string;
  scope: EgressScope;
  enabled: boolean;
  proxyURL?: string;
  clearProxyURL?: boolean;
  proxyPool?: boolean;
  accountCapacity: number;
  userAgent: string;
  cloudflareCookies?: string;
  clearCookies?: boolean;
};

export type EgressScope =
  "grok_build" | "grok_web" | "grok_console" | "grok_web_asset" | "grok_console_asset";
export type EgressFallbackMode = "none" | "direct" | "fixed";
export type EgressFallbackConfigDTO = { mode: EgressFallbackMode; nodeId?: string };
export type EgressSourceDTO = {
  id: string;
  name: string;
  scope: EgressScope;
  enabled: boolean;
  urlConfigured: boolean;
  proxyConfigured?: boolean;
  refreshIntervalSeconds: number;
  defaultAccountCapacity: number;
  lastSyncedAt?: string;
  nextSyncAt?: string;
  lastSyncImported: number;
  lastSyncError?: string;
};
export type EgressSourceInput = {
  name: string;
  scope: EgressScope;
  enabled: boolean;
  url?: string;
  clearUrl?: boolean;
  proxyURL?: string;
  clearProxyURL?: boolean;
  refreshIntervalSeconds: number;
  defaultAccountCapacity: number;
};
export type EgressSourceListDTO = {
  items: EgressSourceDTO[];
  page?: number;
  pageSize?: number;
  total?: number;
};
export type EgressOperationsConfigDTO = {
  probeProvider: "ipinfo" | "cloudflare";
  probeIntervalSeconds: number;
  autoAssignEnabled: boolean;
  autoBalanceEnabled: boolean;
  assignmentIntervalSeconds: number;
  fallbacks: Record<EgressScope, EgressFallbackConfigDTO>;
  updatedAt: string;
};
export type EgressOperationsConfigInput = Omit<EgressOperationsConfigDTO, "updatedAt">;
export type EgressImportResultDTO = { imported: number; skipped: number };
export type EgressIPProbeDTO = {
  status: "unknown" | "healthy" | "unhealthy";
  testedAt?: string;
  latencyMs: number;
  exitIp?: string;
  error?: string;
};
export type EgressProbeResultDTO = {
  status: "unknown" | "healthy" | "unhealthy";
  testedAt: string;
  latencyMs: number;
  exitIp?: string;
  error?: string;
  probeProvider?: "ipinfo" | "cloudflare";
  ipv4: EgressIPProbeDTO;
  ipv6: EgressIPProbeDTO;
};
export type EgressProbeBatchResultDTO = { requested: number; healthy: number; unhealthy: number };
export type EgressCleanupPreviewDTO = {
  nodes: number;
  boundAccounts: number;
  subscriptionManaged: number;
};
export type EgressCleanupResultDTO = { deleted: number };
export type EgressRebalanceResultDTO = { assigned: number; rebalanced: number; unplaced: number };
export type EgressHealthCheckDTO = {
  id: string;
  nodeId: string;
  healthy: boolean;
  durationMs: number;
  errorCode?: string;
  checkedAt: string;
};
export type EgressHealthCheckListDTO = { items: EgressHealthCheckDTO[] };

export type EgressNodeListDTO = {
  items: EgressNodeDTO[];
  page?: number;
  pageSize?: number;
  total?: number;
  defaultUserAgents: Omit<Record<EgressScope, string>, "grok_console_asset"> & {
    grok_console_asset?: string;
  };
};

export type SettingsSnapshotDTO = {
  config: SettingsConfigDTO;
  recommendedProviderBuild: { clientVersion: string; userAgent: string };
  updatedAt: string;
  revision: string;
  restartRequired: string[];
};

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
    recoveryBackoffBase: isString,
    recoveryBackoffMax: isString,
  }),
  providerConsole: hasShape({
    baseURL: isString,
    chatTimeout: isString,
    streamIdleTimeout: isOptional(isString),
  }),
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
    videoMaxAttempts: isOptional(isNumber),
    preferFreeBuild: isBoolean,
    markBuildChatDeniedAsReauth: isOptional(isBoolean),
    accountIsolatedConnections: isOptional(isBoolean),
    segmentedSelector: isOptional(
      hasShape({
        enabled: isBoolean,
        minCandidates: isNumber,
        windowSize: isNumber,
      }),
    ),
  }),
  audit: hasShape({
    bufferSize: isNumber,
    batchSize: isNumber,
    flushInterval: isString,
    commitDelayMS: isNumber,
  }),
  clientKeyDefaults: hasShape({ rpmLimit: isNumber, maxConcurrent: isNumber }),
  accounts: isOptional(
    hasShape({
      markBuildForbiddenReauth: isBoolean,
      buildForbiddenReauthCodes: isArrayOf(isString),
      excludeBuildBotFlaggedFromScheduling: isOptional(isBoolean),
      autoCleanReauthEnabled: isBoolean,
      autoCleanReauthInterval: isString,
      autoCleanReauthMinAge: isString,
      autoCleanIncludeDisabled: isBoolean,
    }),
  ),
});
const decodeSettingsSnapshotRaw = createObjectDecoder<SettingsSnapshotDTO>("settings", {
  config: settingsConfigValidator,
  recommendedProviderBuild: hasShape({ clientVersion: isString, userAgent: isString }),
  updatedAt: isString,
  revision: isString,
  restartRequired: isArrayOf(isString),
});
const defaultAccountsConfig = (): SettingsConfigDTO["accounts"] => ({
  markBuildForbiddenReauth: false,
  buildForbiddenReauthCodes: [],
  excludeBuildBotFlaggedFromScheduling: false,
  autoCleanReauthEnabled: false,
  autoCleanReauthInterval: "10m",
  autoCleanReauthMinAge: "1h",
  autoCleanIncludeDisabled: false,
});
const decodeSettingsSnapshot = (value: unknown): SettingsSnapshotDTO => {
  const snapshot = decodeSettingsSnapshotRaw(value);
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
      routing: {
        ...snapshot.config.routing,
        videoMaxAttempts:
          snapshot.config.routing.videoMaxAttempts == null ||
          snapshot.config.routing.videoMaxAttempts === 0
            ? 999
            : snapshot.config.routing.videoMaxAttempts,
        markBuildChatDeniedAsReauth: snapshot.config.routing.markBuildChatDeniedAsReauth ?? false,
        accountIsolatedConnections: snapshot.config.routing.accountIsolatedConnections ?? false,
        segmentedSelector: {
          enabled: segmentedSelector.enabled ?? true,
          minCandidates: segmentedSelector.minCandidates || 3000,
          windowSize: segmentedSelector.windowSize || 64,
        },
      },
      accounts: {
        ...accounts,
        excludeBuildBotFlaggedFromScheduling:
          accounts.excludeBuildBotFlaggedFromScheduling ?? false,
      },
    },
  };
};
const egressIPProbeValidator = hasShape({
  status: isOneOf("unknown", "healthy", "unhealthy"),
  testedAt: isOptional(isString),
  latencyMs: isNumber,
  exitIp: isOptional(isString),
  error: isOptional(isString),
});
const egressNodeValidator = hasShape({
  id: isString,
  name: isString,
  scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"),
  enabled: isBoolean,
  proxyConfigured: isBoolean,
  userAgent: isString,
  cookieConfigured: isBoolean,
  accountBoundProxy: isBoolean,
  proxyPool: isBoolean,
  sourceId: isOptional(isString),
  accountCapacity: isNumber,
  assignedAccountCount: isNumber,
  probeStatus: isOneOf("unknown", "healthy", "unhealthy"),
  lastProbedAt: isOptional(isString),
  probeLatencyMs: isNumber,
  exitIp: isOptional(isString),
  probeError: isOptional(isString),
  probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
  ipv4Probe: isOptional(egressIPProbeValidator),
  ipv6Probe: isOptional(egressIPProbeValidator),
  health: isNumber,
  failureCount: isNumber,
  cooldownUntil: isOptional(isString),
  lastError: isOptional(isString),
});
const decodeEgressNode = createValidatedDecoder<EgressNodeDTO>("egress node", egressNodeValidator);
const egressHealthCheckValidator = hasShape({
  id: isString,
  nodeId: isString,
  healthy: isBoolean,
  durationMs: isNumber,
  errorCode: isOptional(isString),
  checkedAt: isString,
});
const decodeEgressHealthCheck = createValidatedDecoder<EgressHealthCheckDTO>(
  "egress health check",
  egressHealthCheckValidator,
);
const decodeEgressHealthCheckList = createObjectDecoder<EgressHealthCheckListDTO>(
  "egress health check list",
  { items: isArrayOf(egressHealthCheckValidator) },
);
const decodeEgressNodeList = createObjectDecoder<EgressNodeListDTO>("egress node list", {
  items: isArrayOf(egressNodeValidator),
  page: isOptional(isNumber),
  pageSize: isOptional(isNumber),
  total: isOptional(isNumber),
  defaultUserAgents: hasShape({
    grok_build: isString,
    grok_web: isString,
    grok_console: isString,
    grok_web_asset: isString,
  }),
});

const egressSourceValidator = hasShape({
  id: isString,
  name: isString,
  scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"),
  enabled: isBoolean,
  urlConfigured: isBoolean,
  proxyConfigured: isOptional(isBoolean),
  refreshIntervalSeconds: isNumber,
  defaultAccountCapacity: isNumber,
  lastSyncedAt: isOptional(isString),
  nextSyncAt: isOptional(isString),
  lastSyncImported: isNumber,
  lastSyncError: isOptional(isString),
});
const decodeEgressSource = createValidatedDecoder<EgressSourceDTO>(
  "egress source",
  egressSourceValidator,
);
const decodeEgressSourceList = createObjectDecoder<EgressSourceListDTO>("egress source list", {
  items: isArrayOf(egressSourceValidator),
  page: isOptional(isNumber),
  pageSize: isOptional(isNumber),
  total: isOptional(isNumber),
});
const decodeEgressImportResult = createObjectDecoder<EgressImportResultDTO>(
  "egress import result",
  { imported: isNumber, skipped: isNumber },
);
const decodeEgressProbeResult = createObjectDecoder<EgressProbeResultDTO>("egress probe", {
  status: isOneOf("unknown", "healthy", "unhealthy"),
  testedAt: isString,
  latencyMs: isNumber,
  exitIp: isOptional(isString),
  error: isOptional(isString),
  probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
  ipv4: egressIPProbeValidator,
  ipv6: egressIPProbeValidator,
});
const decodeEgressProbeBatchResult = createObjectDecoder<EgressProbeBatchResultDTO>(
  "egress probe result",
  { requested: isNumber, healthy: isNumber, unhealthy: isNumber },
);
const decodeEgressCleanupPreview = createObjectDecoder<EgressCleanupPreviewDTO>(
  "egress cleanup preview",
  { nodes: isNumber, boundAccounts: isNumber, subscriptionManaged: isNumber },
);
const decodeEgressCleanupResult = createObjectDecoder<EgressCleanupResultDTO>(
  "egress cleanup result",
  { deleted: isNumber },
);
const decodeEgressRebalanceResult = createObjectDecoder<EgressRebalanceResultDTO>(
  "egress rebalance result",
  { assigned: isNumber, rebalanced: isNumber, unplaced: isNumber },
);
const egressFallbackConfigValidator = hasShape({
  mode: isOneOf("none", "direct", "fixed"),
  nodeId: isOptional(isString),
});
type EgressOperationsConfigWireDTO = Omit<EgressOperationsConfigDTO, "probeProvider"> & {
  probeProvider?: "ipinfo" | "cloudflare";
};
const decodeEgressOperationsConfigWire = createObjectDecoder<EgressOperationsConfigWireDTO>(
  "egress operations config",
  {
    probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
    probeIntervalSeconds: isNumber,
    autoAssignEnabled: isBoolean,
    autoBalanceEnabled: isBoolean,
    assignmentIntervalSeconds: isNumber,
    fallbacks: isRecordOf(egressFallbackConfigValidator),
    updatedAt: isString,
  },
);
const decodeEgressOperationsConfig = (value: unknown): EgressOperationsConfigDTO => {
  const decoded = decodeEgressOperationsConfigWire(value);
  return {
    ...decoded,
    probeProvider: decoded.probeProvider ?? "cloudflare",
  };
};

export function getSettings(client: ApiClient): Promise<SettingsSnapshotDTO> {
  return client.request("/api/admin/v1/settings", {}, decodeSettingsSnapshot);
}

export function updateSettings(
  client: ApiClient,
  revision: string,
  config: SettingsConfigDTO,
): Promise<SettingsSnapshotDTO> {
  return client.request(
    "/api/admin/v1/settings",
    { method: "PUT", body: { revision, config } },
    decodeSettingsSnapshot,
  );
}

export function listEgressNodes(
  client: ApiClient,
  input?: {
    sortBy?: string;
    sortOrder?: SortOrder;
    scope?: EgressScope;
    probe?: "healthy" | "unhealthy" | "unknown" | "";
    page?: number;
    pageSize?: number;
  },
): Promise<EgressNodeListDTO> {
  const query = new URLSearchParams();
  if (input?.scope) query.set("scope", input.scope);
  if (input?.probe) query.set("probe", input.probe);
  if (input?.page) query.set("page", String(input.page));
  if (input?.pageSize) query.set("pageSize", String(input.pageSize));
  if (input?.sortBy && input.sortOrder) {
    query.set("sortBy", input.sortBy);
    query.set("sortOrder", input.sortOrder);
  }
  const suffix = query.size > 0 ? `?${query}` : "";
  return client.request(`/api/admin/v1/egress-nodes${suffix}`, {}, decodeEgressNodeList);
}

export function listAllEgressNodes(
  client: ApiClient,
  input?: {
    sortBy?: string;
    sortOrder?: SortOrder;
    scope?: EgressScope;
    probe?: "healthy" | "unhealthy" | "unknown" | "";
    page?: number;
    pageSize?: number;
  },
): Promise<EgressNodeListDTO> {
  return listEgressNodes(client, input);
}

export function createEgressNode(
  client: ApiClient,
  input: EgressNodeInput,
): Promise<EgressNodeDTO> {
  return client.request(
    "/api/admin/v1/egress-nodes",
    { method: "POST", body: input },
    decodeEgressNode,
  );
}

export function updateEgressNode(
  client: ApiClient,
  id: string,
  input: EgressNodeInput,
): Promise<EgressNodeDTO> {
  return client.request(
    `/api/admin/v1/egress-nodes/${id}`,
    { method: "PUT", body: input },
    decodeEgressNode,
  );
}

export function deleteEgressNode(client: ApiClient, id: string): Promise<{ deleted: boolean }> {
  return client.request(
    `/api/admin/v1/egress-nodes/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function deleteEgressNodes(client: ApiClient, ids: string[]): Promise<{ deleted: number }> {
  return client.request(
    "/api/admin/v1/egress-nodes",
    { method: "DELETE", body: { ids } },
    createObjectDecoder<{ deleted: number }>("egress node batch delete", { deleted: isNumber }),
  );
}

export function updateEgressNodesEnabled(
  client: ApiClient,
  ids: string[],
  enabled: boolean,
): Promise<{ updated: number }> {
  return client.request(
    "/api/admin/v1/egress-nodes/batch",
    { method: "PATCH", body: { ids, enabled } },
    createObjectDecoder<{ updated: number }>("egress node batch update", { updated: isNumber }),
  );
}

export function refreshEgressClearance(
  client: ApiClient,
  id: string,
): Promise<{ refreshed: boolean }> {
  return client.request(
    `/api/admin/v1/egress-nodes/${id}/refresh-clearance`,
    { method: "POST" },
    decodeBooleanResult<{ refreshed: boolean }>("refreshed"),
  );
}

export function checkEgressNode(client: ApiClient, id: string): Promise<EgressHealthCheckDTO> {
  return client.request(
    `/api/admin/v1/egress-nodes/${id}/check`,
    { method: "POST" },
    decodeEgressHealthCheck,
  );
}

export function listEgressHealthChecks(
  client: ApiClient,
  id: string,
  limit = 20,
): Promise<EgressHealthCheckListDTO> {
  return client.request(
    `/api/admin/v1/egress-nodes/${id}/health-checks?limit=${Math.min(Math.max(limit, 1), 100)}`,
    {},
    decodeEgressHealthCheckList,
  );
}

export function testEgressNode(client: ApiClient, id: string): Promise<EgressProbeResultDTO> {
  return client.request(
    `/api/admin/v1/egress-nodes/${id}/test`,
    { method: "POST" },
    decodeEgressProbeResult,
  );
}

export function testEgressNodes(
  client: ApiClient,
  ids?: string[],
): Promise<EgressProbeBatchResultDTO> {
  return client.request(
    "/api/admin/v1/egress-nodes/test",
    { method: "POST", body: { ids: ids ?? [] } },
    decodeEgressProbeBatchResult,
  );
}

export function previewUnhealthyEgressNodes(client: ApiClient): Promise<EgressCleanupPreviewDTO> {
  return client.request(
    "/api/admin/v1/egress-nodes/cleanup-preview",
    {},
    decodeEgressCleanupPreview,
  );
}

export function cleanupUnhealthyEgressNodes(client: ApiClient): Promise<EgressCleanupResultDTO> {
  return client.request(
    "/api/admin/v1/egress-nodes/cleanup",
    { method: "POST" },
    decodeEgressCleanupResult,
  );
}

export function listEgressSources(client: ApiClient): Promise<EgressSourceListDTO> {
  return client.request("/api/admin/v1/egress-sources", {}, decodeEgressSourceList);
}
export function createEgressSource(
  client: ApiClient,
  input: EgressSourceInput,
): Promise<EgressSourceDTO> {
  return client.request(
    "/api/admin/v1/egress-sources",
    { method: "POST", body: input },
    decodeEgressSource,
  );
}
export function updateEgressSource(
  client: ApiClient,
  id: string,
  input: EgressSourceInput,
): Promise<EgressSourceDTO> {
  return client.request(
    `/api/admin/v1/egress-sources/${id}`,
    { method: "PUT", body: input },
    decodeEgressSource,
  );
}
export function deleteEgressSource(client: ApiClient, id: string): Promise<{ deleted: boolean }> {
  return client.request(
    `/api/admin/v1/egress-sources/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}
export function syncEgressSource(client: ApiClient, id: string): Promise<EgressImportResultDTO> {
  return client.request(
    `/api/admin/v1/egress-sources/${id}/sync`,
    { method: "POST" },
    decodeEgressImportResult,
  );
}
export function importEgressText(
  client: ApiClient,
  input: { name: string; scope: EgressScope; accountCapacity: number; content: string },
): Promise<EgressImportResultDTO> {
  return client.request(
    "/api/admin/v1/egress-imports",
    { method: "POST", body: input },
    decodeEgressImportResult,
  );
}
export function getEgressOperationsConfig(client: ApiClient): Promise<EgressOperationsConfigDTO> {
  return client.request("/api/admin/v1/egress-operations", {}, decodeEgressOperationsConfig);
}
export function updateEgressOperationsConfig(
  client: ApiClient,
  input: EgressOperationsConfigInput,
): Promise<EgressOperationsConfigDTO> {
  return client.request(
    "/api/admin/v1/egress-operations",
    { method: "PUT", body: input },
    decodeEgressOperationsConfig,
  );
}
export function assignEgressAccounts(
  client: ApiClient,
  nodeID: string,
  provider: "grok_build" | "grok_web" | "grok_console",
  ids: string[],
  mode: "manual" | "auto" = "manual",
): Promise<{ assigned: number }> {
  return client.request(
    `/api/admin/v1/egress-nodes/${nodeID}/accounts`,
    { method: "POST", body: { provider, ids, mode } },
    createObjectDecoder<{ assigned: number }>("egress account assignment", { assigned: isNumber }),
  );
}

export function unassignEgressAccounts(
  client: ApiClient,
  provider: "grok_build" | "grok_web" | "grok_console",
  ids: string[],
): Promise<{ assigned: number }> {
  return client.request(
    "/api/admin/v1/egress-nodes/accounts",
    { method: "DELETE", body: { provider, ids } },
    createObjectDecoder<{ assigned: number }>("egress account assignment", { assigned: isNumber }),
  );
}

export function rebalanceEgressAccounts(client: ApiClient): Promise<EgressRebalanceResultDTO> {
  return client.request(
    "/api/admin/v1/egress-operations/rebalance",
    { method: "POST" },
    decodeEgressRebalanceResult,
  );
}
