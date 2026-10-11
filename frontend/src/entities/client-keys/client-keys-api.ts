import type { ClientKeyDTO } from "@/entities/client-keys/types";
import { apiRequest, type PaginatedDTO } from "@/shared/api/client";
import {
  createObjectDecoder,
  createPaginatedDecoder,
  hasShape,
  isArrayOf,
  isBoolean,
  isNumber,
  isOneOf,
  isOptional,
  isString,
} from "@/shared/api/decoder";
import type { SortOrder } from "@/shared/lib/table-sort";

// 客户端密钥读取契约：跨 feature 共用的名单查询与密钥读取。创建/更新/删除等写操作仍归 features/client-keys。

export const clientKeyValidator = hasShape({
  id: isString,
  name: isString,
  prefix: isString,
  enabled: isBoolean,
  expiresAt: isOptional(isString),
  rpmLimit: isNumber,
  maxConcurrent: isNumber,
  billingLimitUsdTicks: isNumber,
  billedUsageUsdTicks: isNumber,
  allowModelAliases: isBoolean,
  allowedModelIds: isArrayOf(isString),
  providerScope: isOptional(isArrayOf(isOneOf("all", "grok_build", "grok_web", "grok_console"))),
  tierScope: isOptional(isArrayOf(isOneOf("all", "free", "super"))),
  lastUsedAt: isOptional(isString),
});
export const decodeClientKey = createObjectDecoder<ClientKeyDTO>("client key", {
  id: isString,
  name: isString,
  prefix: isString,
  enabled: isBoolean,
  expiresAt: isOptional(isString),
  rpmLimit: isNumber,
  maxConcurrent: isNumber,
  billingLimitUsdTicks: isNumber,
  billedUsageUsdTicks: isNumber,
  allowModelAliases: isBoolean,
  allowedModelIds: isArrayOf(isString),
  providerScope: isOptional(isArrayOf(isOneOf("all", "grok_build", "grok_web", "grok_console"))),
  tierScope: isOptional(isArrayOf(isOneOf("all", "free", "super"))),
  lastUsedAt: isOptional(isString),
});
const decodeClientKeyPage = createPaginatedDecoder<ClientKeyDTO>(clientKeyValidator);
const decodeSecret = createObjectDecoder<{ secret: string }>("client key secret", { secret: isString });

type ListClientKeysInput = {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
  modelScope?: string;
  sortBy?: string;
  sortOrder?: SortOrder;
};

export function listClientKeys(input: ListClientKeysInput): Promise<PaginatedDTO<ClientKeyDTO>> {
  const query = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.search) query.set("search", input.search);
  if (input.status) query.set("status", input.status);
  if (input.modelScope) query.set("modelScope", input.modelScope);
  if (input.sortBy && input.sortOrder) {
    query.set("sortBy", input.sortBy);
    query.set("sortOrder", input.sortOrder);
  }
  return apiRequest(`/api/admin/v1/client-keys?${query}`, {}, decodeClientKeyPage);
}

export function getClientKeySecret(id: string): Promise<{ secret: string }> {
  return apiRequest(`/api/admin/v1/client-keys/${id}/secret`, {}, decodeSecret);
}
