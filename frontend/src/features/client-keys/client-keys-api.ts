import { type ApiClient, type PaginatedDTO } from "@/shared/api/client";
import {
  createObjectDecoder,
  createPaginatedDecoder,
  decodeBooleanResult,
  decodeCountResult,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOptional,
  isString,
} from "@/shared/api/decoder";
import type { SortOrder } from "@/shared/lib/table-sort";

export type ClientKeyDTO = {
  id: string;
  name: string;
  prefix: string;
  enabled: boolean;
  expiresAt?: string;
  rpmLimit: number;
  maxConcurrent: number;
  billingLimitUsdTicks: number;
  billedUsageUsdTicks: number;
  allowedModelIds: string[];
  lastUsedAt?: string;
};

export type ClientKeyInput = {
  name: string;
  enabled: boolean;
  expiresAt: string;
  rpmLimit: number;
  maxConcurrent: number;
  billingLimitUsdTicks: number;
  allowedModelIds: string[];
};

export type CreateKeyResponseDTO = { key: ClientKeyDTO; secret: string };

const clientKeyValidator = hasShape({
  id: isString,
  name: isString,
  prefix: isString,
  enabled: isBoolean,
  expiresAt: isOptional(isString),
  rpmLimit: isNumber,
  maxConcurrent: isNumber,
  billingLimitUsdTicks: isNumber,
  billedUsageUsdTicks: isNumber,
  allowedModelIds: isArrayOf(isString),
  lastUsedAt: isOptional(isString),
});
const decodeClientKey = createObjectDecoder<ClientKeyDTO>("client key", {
  id: isString,
  name: isString,
  prefix: isString,
  enabled: isBoolean,
  expiresAt: isOptional(isString),
  rpmLimit: isNumber,
  maxConcurrent: isNumber,
  billingLimitUsdTicks: isNumber,
  billedUsageUsdTicks: isNumber,
  allowedModelIds: isArrayOf(isString),
  lastUsedAt: isOptional(isString),
});
const decodeClientKeyPage = createPaginatedDecoder<ClientKeyDTO>(clientKeyValidator);
const decodeCreatedClientKey = createObjectDecoder<CreateKeyResponseDTO>("created client key", {
  key: clientKeyValidator,
  secret: isString,
});
const decodeSecret = createObjectDecoder<{ secret: string }>("client key secret", {
  secret: isString,
});

type ListClientKeysInput = {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  modelScope?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export function listClientKeys(
  client: ApiClient,
  input: ListClientKeysInput,
): Promise<PaginatedDTO<ClientKeyDTO>> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  if (input.modelScope) query.set("modelScope", input.modelScope);
  if (input.sortBy && input.sortOrder) {
    query.set("sortBy", input.sortBy);
    query.set("sortOrder", input.sortOrder);
  }
  return client.request(`/api/admin/v1/client-keys?${query}`, {}, decodeClientKeyPage);
}

export function createClientKey(
  client: ApiClient,
  input: ClientKeyInput,
): Promise<CreateKeyResponseDTO> {
  return client.request(
    "/api/admin/v1/client-keys",
    { method: "POST", body: input },
    decodeCreatedClientKey,
  );
}

export function getClientKeySecret(client: ApiClient, id: string): Promise<{ secret: string }> {
  return client.request(`/api/admin/v1/client-keys/${id}/secret`, {}, decodeSecret);
}

export function updateClientKey(
  client: ApiClient,
  id: string,
  input: ClientKeyInput,
): Promise<ClientKeyDTO> {
  return client.request(
    `/api/admin/v1/client-keys/${id}`,
    { method: "PATCH", body: input },
    decodeClientKey,
  );
}

export function deleteClientKey(client: ApiClient, id: string): Promise<{ deleted: boolean }> {
  return client.request(
    `/api/admin/v1/client-keys/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function updateClientKeysEnabled(
  client: ApiClient,
  ids: string[],
  enabled: boolean,
): Promise<{ updated: number }> {
  return client.request(
    "/api/admin/v1/client-keys/batch",
    { method: "PATCH", body: { ids, enabled } },
    decodeCountResult<{ updated: number }>("updated"),
  );
}

export function deleteClientKeys(client: ApiClient, ids: string[]): Promise<{ deleted: number }> {
  return client.request(
    "/api/admin/v1/client-keys",
    { method: "DELETE", body: { ids } },
    decodeCountResult<{ deleted: number }>("deleted"),
  );
}
