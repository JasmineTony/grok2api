/** 出口节点/订阅/运维接口的只读 DTO 契约：纯类型模块，供 decoder 与 API 层复用。 */
export type EgressNodeDTO = {
  id: string;
  name: string;
  scope: EgressScope;
  enabled: boolean;
  proxyConfigured: boolean;
  proxyDisplay?: string;
  proxyFingerprint?: string;
  userAgent: string;
  cookieConfigured: boolean;
  accountBoundProxy: boolean;
  proxyPool: boolean;
  proxyProfileId?: string;
  proxyProfileName?: string;
  sourceId?: string;
  accountCapacity: number;
  assignedAccountCount: number;
  health: number;
  failureCount: number;
  cooldownUntil?: string;
  lastError?: string;
  probeStatus: "unknown" | "healthy" | "unhealthy";
  lastProbedAt?: string;
  probeLatencyMs: number;
  exitIp?: string;
  probeError?: string;
  probeProvider?: "ipinfo" | "cloudflare";
  ipv4Probe: EgressIPProbeDTO;
  ipv6Probe: EgressIPProbeDTO;
};

export type EgressNodeInput = {
  name: string;
  scope: EgressScope;
  enabled: boolean;
  proxyPool: boolean;
  proxyURL?: string;
  proxyProfileId?: string;
  accountCapacity: number;
  clearProxyURL?: boolean;
  userAgent: string;
  cloudflareCookies?: string;
  clearCookies?: boolean;
};

export type EgressProxyProfileDTO = {
  id: string;
  name: string;
  proxyDisplay?: string;
  proxyFingerprint?: string;
  boundNodeCount: number;
  createdAt: string;
  updatedAt: string;
};

export type EgressProxyProfileInput = { name: string; proxyURL?: string };
export type EgressProxyProfileListDTO = {
  items: EgressProxyProfileDTO[];
  page: number;
  pageSize: number;
  total: number;
};

export type EgressScope = "grok_build" | "grok_web" | "grok_console" | "grok_web_asset" | "grok_console_asset";
export type EgressFallbackMode = "none" | "direct" | "fixed";
export type EgressFallbackConfigDTO = { mode: EgressFallbackMode; nodeId?: string };
export type EgressNodeListDTO = {
  items: EgressNodeDTO[];
  page: number;
  pageSize: number;
  total: number;
  defaultUserAgents: Record<EgressScope, string>;
};
export type EgressSourceDTO = {
  id: string;
  name: string;
  scope: EgressScope;
  enabled: boolean;
  urlConfigured: boolean;
  proxyConfigured: boolean;
  refreshIntervalSeconds: number;
  defaultAccountCapacity: number;
  lastSyncedAt?: string;
  nextSyncAt?: string;
  lastSyncImported: number;
  lastSyncError?: string;
};
export type EgressSourceListDTO = {
  items: EgressSourceDTO[];
  page: number;
  pageSize: number;
  total: number;
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
export type EgressOperationsConfigDTO = {
  probeProvider: "ipinfo" | "cloudflare";
  probeIntervalSeconds: number;
  autoAssignEnabled: boolean;
  autoBalanceEnabled: boolean;
  assignmentIntervalSeconds: number;
  fallbacks: Record<EgressScope, EgressFallbackConfigDTO>;
  updatedAt: string;
};
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
export type EgressRebalanceResultDTO = { assigned: number; rebalanced: number; unplaced: number };
export type EgressUnhealthyCleanupPreviewDTO = { nodes: number; boundAccounts: number; subscriptionManaged: number };
