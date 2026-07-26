import {
  type EgressFallbackConfigDTO,
  type EgressNodeDTO,
  type EgressOperationsConfigDTO,
  type EgressScope,
  type EgressSourceInput,
  listEgressNodes,
  testEgressNodes,
} from "@/features/settings/settings-api";
import type { ApiClient } from "@/shared/api/client";

export type SourceForm = EgressSourceInput & { url: string };
export type ImportForm = {
  name: string;
  scope: EgressScope;
  accountCapacity: number;
  content: string;
};

export const emptySource: SourceForm = {
  name: "",
  scope: "grok_build",
  enabled: true,
  url: "",
  refreshIntervalSeconds: 900,
  defaultAccountCapacity: 0,
};
export const emptyImport: ImportForm = {
  name: "",
  scope: "grok_build",
  accountCapacity: 0,
  content: "",
};
export const fallbackScopes: EgressScope[] = [
  "grok_build",
  "grok_web",
  "grok_console",
  "grok_web_asset",
];
export const fallbackDescriptionKeys: Record<EgressScope, string> = {
  grok_build: "settings.egress.fallbackBuildHelp",
  grok_web: "settings.egress.fallbackWebHelp",
  grok_console: "settings.egress.fallbackConsoleHelp",
  grok_web_asset: "settings.egress.fallbackWebAssetHelp",
};

export function defaultFallbacks(): Record<EgressScope, EgressFallbackConfigDTO> {
  return {
    grok_build: { mode: "none" },
    grok_web: { mode: "none" },
    grok_console: { mode: "none" },
    grok_web_asset: { mode: "none" },
  };
}

export const defaultOperationsForm: Omit<EgressOperationsConfigDTO, "updatedAt"> = {
  probeIntervalSeconds: 900,
  autoAssignEnabled: false,
  autoBalanceEnabled: false,
  assignmentIntervalSeconds: 300,
  fallbacks: defaultFallbacks(),
};

export function operationsFormFrom(
  value?: EgressOperationsConfigDTO,
): Omit<EgressOperationsConfigDTO, "updatedAt"> {
  if (!value) return { ...defaultOperationsForm, fallbacks: defaultFallbacks() };
  const defaults = defaultFallbacks();
  return {
    probeIntervalSeconds: value.probeIntervalSeconds,
    autoAssignEnabled: value.autoAssignEnabled,
    autoBalanceEnabled: value.autoBalanceEnabled,
    assignmentIntervalSeconds: value.assignmentIntervalSeconds,
    fallbacks: {
      grok_build: { ...defaults.grok_build, ...value.fallbacks.grok_build },
      grok_web: { ...defaults.grok_web, ...value.fallbacks.grok_web },
      grok_console: { ...defaults.grok_console, ...value.fallbacks.grok_console },
      grok_web_asset: { ...defaults.grok_web_asset, ...value.fallbacks.grok_web_asset },
    },
  };
}

export async function testAllEgressNodes(client: ApiClient) {
  const nodes = await listEgressNodes(client);
  const ids = nodes.items
    .filter((node) => node.enabled && node.proxyConfigured)
    .map((node) => node.id);
  const result = { requested: 0, healthy: 0, unhealthy: 0 };
  const batchSize = 32;
  for (let index = 0; index < ids.length; index += batchSize) {
    const batch = await testEgressNodes(client, ids.slice(index, index + batchSize));
    result.requested += batch.requested;
    result.healthy += batch.healthy;
    result.unhealthy += batch.unhealthy;
  }
  return result;
}

export function fallbackNodeCandidates(
  nodes: EgressNodeDTO[],
  scope: EgressScope,
): EgressNodeDTO[] {
  return nodes.filter(
    (node) =>
      node.enabled &&
      node.proxyConfigured &&
      !node.proxyPool &&
      !node.accountBoundProxy &&
      !nodeCooling(node) &&
      supportsFallbackScope(node.scope, scope),
  );
}
function nodeCooling(node: EgressNodeDTO): boolean {
  return node.cooldownUntil !== undefined && Date.parse(node.cooldownUntil) > Date.now();
}
function supportsFallbackScope(nodeScope: EgressScope, requestScope: EgressScope): boolean {
  return (
    nodeScope === requestScope ||
    ((requestScope === "grok_console" || requestScope === "grok_web_asset") &&
      nodeScope === "grok_web")
  );
}
