import { apiRequest } from "@/shared/api/client";
import { createObjectDecoder, decodeBooleanResult, isNumber, isString } from "@/shared/api/decoder";
import type { SortOrder } from "@/shared/lib/table-sort";

import type {
  EgressImportResultDTO,
  EgressNodeDTO,
  EgressNodeInput,
  EgressNodeListDTO,
  EgressOperationsConfigDTO,
  EgressProbeBatchResultDTO,
  EgressProbeResultDTO,
  EgressProxyProfileDTO,
  EgressProxyProfileInput,
  EgressProxyProfileListDTO,
  EgressRebalanceResultDTO,
  EgressScope,
  EgressSourceDTO,
  EgressSourceInput,
  EgressSourceListDTO,
  EgressUnhealthyCleanupPreviewDTO,
} from "@/features/settings/egress-dto";
import {
  decodeEgressImportResult,
  decodeEgressNode,
  decodeEgressNodeList,
  decodeEgressOperationsConfig,
  decodeEgressProbeBatchResult,
  decodeEgressProbeResult,
  decodeEgressProxyProfile,
  decodeEgressProxyProfiles,
  decodeEgressRebalanceResult,
  decodeEgressSource,
  decodeEgressSourceList,
} from "@/features/settings/egress-decoders";

type ListEgressNodesInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  scope?: EgressScope | "";
  enabled?: string;
  probe?: string;
  assignment?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export function listEgressNodes(input: ListEgressNodesInput = {}): Promise<EgressNodeListDTO> {
  const query = new URLSearchParams({ page: String(input.page ?? 1), pageSize: String(input.pageSize ?? 20) });
  if (input.search) query.set("search", input.search);
  if (input.scope) query.set("scope", input.scope);
  if (input.enabled) query.set("enabled", input.enabled);
  if (input.probe) query.set("probe", input.probe);
  if (input.assignment) query.set("assignment", input.assignment);
  if (input.sortBy && input.sortOrder) {
    query.set("sortBy", input.sortBy);
    query.set("sortOrder", input.sortOrder);
  }
  return apiRequest(`/api/admin/v1/egress-nodes?${query}`, {}, decodeEgressNodeList);
}

export async function listAllEgressNodes(
  input: Omit<ListEgressNodesInput, "page" | "pageSize"> = {},
): Promise<EgressNodeListDTO> {
  const pageSize = 2000;
  const first = await listEgressNodes({ ...input, page: 1, pageSize });
  const items = [...first.items];
  for (let page = 2; items.length < first.total; page += 1) {
    const next = await listEgressNodes({ ...input, page, pageSize });
    if (next.items.length === 0) break;
    items.push(...next.items);
  }
  return { ...first, items, page: 1, pageSize, total: items.length };
}

export function createEgressNode(input: EgressNodeInput): Promise<EgressNodeDTO> {
  return apiRequest("/api/admin/v1/egress-nodes", { method: "POST", body: input }, decodeEgressNode);
}

export function updateEgressNode(id: string, input: EgressNodeInput): Promise<EgressNodeDTO> {
  return apiRequest(`/api/admin/v1/egress-nodes/${id}`, { method: "PUT", body: input }, decodeEgressNode);
}

export function getEgressNodeProxyURL(id: string): Promise<{ proxyURL: string }> {
  return apiRequest(
    `/api/admin/v1/egress-nodes/${id}/proxy-url/reveal`,
    { method: "POST" },
    createObjectDecoder<{ proxyURL: string }>("egress proxy URL", { proxyURL: isString }),
  );
}

export function listEgressProxyProfiles(
  input: { page?: number; pageSize?: number; search?: string } = {},
): Promise<EgressProxyProfileListDTO> {
  const query = new URLSearchParams({ page: String(input.page ?? 1), pageSize: String(input.pageSize ?? 20) });
  if (input.search) query.set("search", input.search);
  return apiRequest(`/api/admin/v1/egress-proxy-profiles?${query}`, {}, decodeEgressProxyProfiles);
}

export function createEgressProxyProfile(input: EgressProxyProfileInput): Promise<EgressProxyProfileDTO> {
  return apiRequest("/api/admin/v1/egress-proxy-profiles", { method: "POST", body: input }, decodeEgressProxyProfile);
}

export function getEgressProxyProfile(id: string): Promise<EgressProxyProfileDTO> {
  return apiRequest(`/api/admin/v1/egress-proxy-profiles/${id}`, {}, decodeEgressProxyProfile);
}

export function updateEgressProxyProfile(id: string, input: EgressProxyProfileInput): Promise<EgressProxyProfileDTO> {
  return apiRequest(
    `/api/admin/v1/egress-proxy-profiles/${id}`,
    { method: "PUT", body: input },
    decodeEgressProxyProfile,
  );
}

export function deleteEgressProxyProfile(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(
    `/api/admin/v1/egress-proxy-profiles/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function getEgressProxyProfileURL(id: string): Promise<{ proxyURL: string }> {
  return apiRequest(
    `/api/admin/v1/egress-proxy-profiles/${id}/proxy-url/reveal`,
    { method: "POST" },
    createObjectDecoder<{ proxyURL: string }>("egress proxy profile URL", { proxyURL: isString }),
  );
}

export function deleteEgressNode(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(
    `/api/admin/v1/egress-nodes/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function deleteEgressNodes(ids: string[]): Promise<{ deleted: number }> {
  return apiRequest(
    "/api/admin/v1/egress-nodes",
    { method: "DELETE", body: { ids } },
    createObjectDecoder<{ deleted: number }>("egress node batch delete", { deleted: isNumber }),
  );
}

export function updateEgressNodesEnabled(ids: string[], enabled: boolean): Promise<{ updated: number }> {
  return apiRequest(
    "/api/admin/v1/egress-nodes/batch",
    { method: "PATCH", body: { ids, enabled } },
    createObjectDecoder<{ updated: number }>("egress node batch update", { updated: isNumber }),
  );
}

export function previewUnhealthyEgressNodes(): Promise<EgressUnhealthyCleanupPreviewDTO> {
  return apiRequest(
    "/api/admin/v1/egress-nodes/cleanup-preview",
    {},
    createObjectDecoder<EgressUnhealthyCleanupPreviewDTO>("egress node cleanup preview", {
      nodes: isNumber,
      boundAccounts: isNumber,
      subscriptionManaged: isNumber,
    }),
  );
}

export function cleanupUnhealthyEgressNodes(): Promise<{ deleted: number }> {
  return apiRequest(
    "/api/admin/v1/egress-nodes/cleanup",
    { method: "POST" },
    createObjectDecoder<{ deleted: number }>("egress node cleanup", { deleted: isNumber }),
  );
}

export function refreshEgressClearance(id: string): Promise<{ refreshed: boolean }> {
  return apiRequest(
    `/api/admin/v1/egress-nodes/${id}/refresh-clearance`,
    { method: "POST" },
    decodeBooleanResult<{ refreshed: boolean }>("refreshed"),
  );
}

export function testEgressNode(id: string): Promise<EgressProbeResultDTO> {
  return apiRequest(`/api/admin/v1/egress-nodes/${id}/test`, { method: "POST" }, decodeEgressProbeResult);
}

export function testEgressNodes(ids?: string[]): Promise<EgressProbeBatchResultDTO> {
  return apiRequest(
    "/api/admin/v1/egress-nodes/test",
    { method: "POST", body: { ids: ids ?? [] } },
    decodeEgressProbeBatchResult,
  );
}

type ListEgressSourcesInput = {
  page?: number;
  pageSize?: number;
  search?: string;
  scope?: EgressScope;
};

export function listEgressSources(input?: ListEgressSourcesInput): Promise<EgressSourceListDTO> {
  if (!input) return apiRequest("/api/admin/v1/egress-sources", {}, decodeEgressSourceList);
  const query = new URLSearchParams({ page: String(input.page ?? 1), pageSize: String(input.pageSize ?? 20) });
  if (input.search) query.set("search", input.search);
  if (input.scope) query.set("scope", input.scope);
  return apiRequest(`/api/admin/v1/egress-sources?${query}`, {}, decodeEgressSourceList);
}

export function createEgressSource(input: EgressSourceInput): Promise<EgressSourceDTO> {
  return apiRequest("/api/admin/v1/egress-sources", { method: "POST", body: input }, decodeEgressSource);
}

export function updateEgressSource(id: string, input: EgressSourceInput): Promise<EgressSourceDTO> {
  return apiRequest(`/api/admin/v1/egress-sources/${id}`, { method: "PUT", body: input }, decodeEgressSource);
}

export function deleteEgressSource(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(
    `/api/admin/v1/egress-sources/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function syncEgressSource(id: string): Promise<EgressImportResultDTO> {
  return apiRequest(`/api/admin/v1/egress-sources/${id}/sync`, { method: "POST" }, decodeEgressImportResult);
}

export function importEgressText(input: {
  name: string;
  scope: EgressScope;
  accountCapacity: number;
  content: string;
}): Promise<EgressImportResultDTO> {
  return apiRequest("/api/admin/v1/egress-imports", { method: "POST", body: input }, decodeEgressImportResult);
}

export function getEgressOperationsConfig(): Promise<EgressOperationsConfigDTO> {
  return apiRequest("/api/admin/v1/egress-operations", {}, decodeEgressOperationsConfig);
}

export function updateEgressOperationsConfig(
  input: Omit<EgressOperationsConfigDTO, "updatedAt">,
): Promise<EgressOperationsConfigDTO> {
  return apiRequest("/api/admin/v1/egress-operations", { method: "PUT", body: input }, decodeEgressOperationsConfig);
}

export function rebalanceEgressAccounts(): Promise<EgressRebalanceResultDTO> {
  return apiRequest("/api/admin/v1/egress-operations/rebalance", { method: "POST" }, decodeEgressRebalanceResult);
}

export function assignEgressAccounts(
  nodeID: string,
  provider: "grok_build" | "grok_web" | "grok_console",
  ids: string[],
  mode: "manual" | "auto" = "manual",
): Promise<{ assigned: number }> {
  return apiRequest(
    `/api/admin/v1/egress-nodes/${nodeID}/accounts`,
    { method: "POST", body: { provider, ids, mode } },
    createObjectDecoder<{ assigned: number }>("egress account assignment", { assigned: isNumber }),
  );
}

export function unassignEgressAccounts(
  provider: "grok_build" | "grok_web" | "grok_console",
  ids: string[],
): Promise<{ assigned: number }> {
  return apiRequest(
    "/api/admin/v1/egress-nodes/accounts",
    { method: "DELETE", body: { provider, ids } },
    createObjectDecoder<{ assigned: number }>("egress account assignment", { assigned: isNumber }),
  );
}
