import type { EgressNodeDTO, EgressScope } from "@/features/settings/settings-api";

/** 可作为兜底出口的节点：启用、已配置代理、非代理池、未被账号绑定且未冷却。 */
export function fallbackNodeCandidates(nodes: EgressNodeDTO[], scope: EgressScope): EgressNodeDTO[] {
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
  if (nodeScope === requestScope) return true;
  if (requestScope === "grok_console" || requestScope === "grok_web_asset") return nodeScope === "grok_web";
  return requestScope === "grok_console_asset" && (nodeScope === "grok_console" || nodeScope === "grok_web");
}
