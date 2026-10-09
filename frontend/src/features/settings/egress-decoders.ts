import {
  createObjectDecoder,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOneOf,
  isOptional,
  isRecordOf,
  isString,
} from "@/shared/api/decoder";

import type {
  EgressIPProbeDTO,
  EgressImportResultDTO,
  EgressNodeDTO,
  EgressNodeListDTO,
  EgressOperationsConfigDTO,
  EgressProbeBatchResultDTO,
  EgressProbeResultDTO,
  EgressProxyProfileDTO,
  EgressProxyProfileListDTO,
  EgressRebalanceResultDTO,
  EgressScope,
  EgressSourceDTO,
  EgressSourceListDTO,
} from "@/features/settings/egress-dto";

const egressIPProbeValidator = hasShape({
  status: isOneOf("unknown", "healthy", "unhealthy"),
  testedAt: isOptional(isString),
  latencyMs: isNumber,
  exitIp: isOptional(isString),
  error: isOptional(isString),
});
type EgressNodeWireDTO = Omit<EgressNodeDTO, "ipv4Probe" | "ipv6Probe"> & {
  ipv4Probe?: EgressIPProbeDTO;
  ipv6Probe?: EgressIPProbeDTO;
};
type EgressSourceWireDTO = Omit<EgressSourceDTO, "proxyConfigured"> & { proxyConfigured?: boolean };
type EgressOperationsConfigWireDTO = Omit<EgressOperationsConfigDTO, "probeProvider"> & {
  probeProvider?: "ipinfo" | "cloudflare";
};
type EgressProbeResultWireDTO = Omit<EgressProbeResultDTO, "ipv4" | "ipv6"> & {
  ipv4?: EgressIPProbeDTO;
  ipv6?: EgressIPProbeDTO;
};
const unknownEgressIPProbe = (): EgressIPProbeDTO => ({ status: "unknown", latencyMs: 0 });
const withEgressNodeProbeDefaults = (value: EgressNodeWireDTO): EgressNodeDTO => ({
  ...value,
  ipv4Probe: value.ipv4Probe ?? unknownEgressIPProbe(),
  ipv6Probe: value.ipv6Probe ?? unknownEgressIPProbe(),
});
const withEgressSourceDefaults = (value: EgressSourceWireDTO): EgressSourceDTO => ({
  ...value,
  proxyConfigured: value.proxyConfigured ?? false,
});
const egressNodeValidator = hasShape({
  id: isString,
  name: isString,
  scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"),
  enabled: isBoolean,
  proxyConfigured: isBoolean,
  proxyDisplay: isOptional(isString),
  proxyFingerprint: isOptional(isString),
  userAgent: isString,
  cookieConfigured: isBoolean,
  accountBoundProxy: isBoolean,
  proxyPool: isBoolean,
  health: isNumber,
  failureCount: isNumber,
  sourceId: isOptional(isString),
  proxyProfileId: isOptional(isString),
  proxyProfileName: isOptional(isString),
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
  cooldownUntil: isOptional(isString),
  lastError: isOptional(isString),
});
const decodeEgressNodeRaw = createObjectDecoder<EgressNodeWireDTO>("egress node", {
  id: isString,
  name: isString,
  scope: isOneOf("grok_build", "grok_web", "grok_console", "grok_web_asset", "grok_console_asset"),
  enabled: isBoolean,
  proxyConfigured: isBoolean,
  proxyDisplay: isOptional(isString),
  proxyFingerprint: isOptional(isString),
  userAgent: isString,
  cookieConfigured: isBoolean,
  accountBoundProxy: isBoolean,
  proxyPool: isBoolean,
  health: isNumber,
  failureCount: isNumber,
  sourceId: isOptional(isString),
  proxyProfileId: isOptional(isString),
  proxyProfileName: isOptional(isString),
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
  cooldownUntil: isOptional(isString),
  lastError: isOptional(isString),
});
export const decodeEgressNode = (value: unknown): EgressNodeDTO =>
  withEgressNodeProbeDefaults(decodeEgressNodeRaw(value));
export const decodeEgressProxyProfile = createObjectDecoder<EgressProxyProfileDTO>("egress proxy profile", {
  id: isString,
  name: isString,
  proxyDisplay: isOptional(isString),
  proxyFingerprint: isOptional(isString),
  boundNodeCount: isNumber,
  createdAt: isString,
  updatedAt: isString,
});
export const decodeEgressProxyProfiles = createObjectDecoder<EgressProxyProfileListDTO>("egress proxy profiles", {
  items: isArrayOf(
    hasShape({
      id: isString,
      name: isString,
      proxyDisplay: isOptional(isString),
      proxyFingerprint: isOptional(isString),
      boundNodeCount: isNumber,
      createdAt: isString,
      updatedAt: isString,
    }),
  ),
  page: isNumber,
  pageSize: isNumber,
  total: isNumber,
});
type EgressNodeListWireDTO = {
  items: EgressNodeWireDTO[];
  page?: number;
  pageSize?: number;
  total?: number;
  defaultUserAgents: Omit<Record<EgressScope, string>, "grok_console_asset"> & { grok_console_asset?: string };
};
const decodeEgressNodeListRaw = createObjectDecoder<EgressNodeListWireDTO>("egress node list", {
  items: isArrayOf(egressNodeValidator),
  page: isOptional(isNumber),
  pageSize: isOptional(isNumber),
  total: isOptional(isNumber),
  defaultUserAgents: hasShape({
    grok_build: isString,
    grok_web: isString,
    grok_console: isString,
    grok_web_asset: isString,
    grok_console_asset: isOptional(isString),
  }),
});
export const decodeEgressNodeList = (value: unknown): EgressNodeListDTO => {
  const decoded = decodeEgressNodeListRaw(value);
  return {
    ...decoded,
    items: decoded.items.map(withEgressNodeProbeDefaults),
    page: decoded.page ?? 1,
    pageSize: decoded.pageSize ?? Math.max(20, decoded.items.length),
    total: decoded.total ?? decoded.items.length,
    defaultUserAgents: {
      ...decoded.defaultUserAgents,
      grok_console_asset: decoded.defaultUserAgents.grok_console_asset ?? decoded.defaultUserAgents.grok_console,
    },
  };
};
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
const decodeEgressSourceRaw = createObjectDecoder<EgressSourceWireDTO>("egress source", {
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
export const decodeEgressSource = (value: unknown): EgressSourceDTO =>
  withEgressSourceDefaults(decodeEgressSourceRaw(value));
type EgressSourceListWireDTO = {
  items: EgressSourceWireDTO[];
  page?: number;
  pageSize?: number;
  total?: number;
};
const decodeEgressSourceListRaw = createObjectDecoder<EgressSourceListWireDTO>("egress source list", {
  items: isArrayOf(egressSourceValidator),
  page: isOptional(isNumber),
  pageSize: isOptional(isNumber),
  total: isOptional(isNumber),
});
export const decodeEgressSourceList = (value: unknown): EgressSourceListDTO => {
  const decoded = decodeEgressSourceListRaw(value);
  return {
    ...decoded,
    items: decoded.items.map(withEgressSourceDefaults),
    page: decoded.page ?? 1,
    pageSize: decoded.pageSize ?? Math.max(20, decoded.items.length),
    total: decoded.total ?? decoded.items.length,
  };
};
export const decodeEgressImportResult = createObjectDecoder<EgressImportResultDTO>("egress import result", {
  imported: isNumber,
  skipped: isNumber,
});
export const decodeEgressProbeBatchResult = createObjectDecoder<EgressProbeBatchResultDTO>("egress probe result", {
  requested: isNumber,
  healthy: isNumber,
  unhealthy: isNumber,
});
export const decodeEgressRebalanceResult = createObjectDecoder<EgressRebalanceResultDTO>("egress rebalance result", {
  assigned: isNumber,
  rebalanced: isNumber,
  unplaced: isNumber,
});
const egressFallbackConfigValidator = hasShape({
  mode: isOneOf("none", "direct", "fixed"),
  nodeId: isOptional(isString),
});
const decodeEgressOperationsConfigRaw = createObjectDecoder<EgressOperationsConfigWireDTO>("egress operations config", {
  probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
  probeIntervalSeconds: isNumber,
  autoAssignEnabled: isBoolean,
  autoBalanceEnabled: isBoolean,
  assignmentIntervalSeconds: isNumber,
  fallbacks: isRecordOf(egressFallbackConfigValidator),
  updatedAt: isString,
});
export const decodeEgressOperationsConfig = (value: unknown): EgressOperationsConfigDTO => {
  const decoded = decodeEgressOperationsConfigRaw(value);
  return { ...decoded, probeProvider: decoded.probeProvider ?? "cloudflare" };
};
const decodeEgressProbeResultRaw = createObjectDecoder<EgressProbeResultWireDTO>("egress probe", {
  status: isOneOf("unknown", "healthy", "unhealthy"),
  testedAt: isString,
  latencyMs: isNumber,
  exitIp: isOptional(isString),
  error: isOptional(isString),
  probeProvider: isOptional(isOneOf("ipinfo", "cloudflare")),
  ipv4: isOptional(egressIPProbeValidator),
  ipv6: isOptional(egressIPProbeValidator),
});
export const decodeEgressProbeResult = (value: unknown): EgressProbeResultDTO => {
  const decoded = decodeEgressProbeResultRaw(value);
  return { ...decoded, ipv4: decoded.ipv4 ?? unknownEgressIPProbe(), ipv6: decoded.ipv6 ?? unknownEgressIPProbe() };
};
