import { clientKeyValidator, decodeClientKey } from "@/entities/client-keys/client-keys-api";
import type { ClientKeyDTO, ProviderScopeValue, TierScopeValue } from "@/entities/client-keys/types";
import { apiRequest } from "@/shared/api/client";
import { createObjectDecoder, decodeBooleanResult, decodeCountResult, isString } from "@/shared/api/decoder";

// 客户端密钥 feature 专属的写操作/表单契约：创建、更新、删除与批量启停。
// 跨 feature 共用的读取契约（ClientKeyDTO / ProviderScopeValue / TierScopeValue、clientKeyValidator、
// decodeClientKey、listClientKeys、getClientKeySecret）已下沉到 @/entities/client-keys（SSOT），此处不再重复定义。

export type ClientKeyInput = {
  name: string;
  enabled: boolean;
  expiresAt: string;
  rpmLimit: number;
  maxConcurrent: number;
  billingLimitUsdTicks: number;
  allowModelAliases: boolean;
  allowedModelIds: string[];
  providerScope: ProviderScopeValue[];
  tierScope: TierScopeValue[];
};

export type CreateKeyResponseDTO = { key: ClientKeyDTO; secret: string };

const decodeCreatedClientKey = createObjectDecoder<CreateKeyResponseDTO>("created client key", {
  key: clientKeyValidator,
  secret: isString,
});

export function createClientKey(input: ClientKeyInput): Promise<CreateKeyResponseDTO> {
  return apiRequest("/api/admin/v1/client-keys", { method: "POST", body: input }, decodeCreatedClientKey);
}

export function updateClientKey(id: string, input: ClientKeyInput): Promise<ClientKeyDTO> {
  return apiRequest(`/api/admin/v1/client-keys/${id}`, { method: "PATCH", body: input }, decodeClientKey);
}

export function deleteClientKey(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(
    `/api/admin/v1/client-keys/${id}`,
    { method: "DELETE" },
    decodeBooleanResult<{ deleted: boolean }>("deleted"),
  );
}

export function updateClientKeysEnabled(ids: string[], enabled: boolean): Promise<{ updated: number }> {
  return apiRequest(
    "/api/admin/v1/client-keys/batch",
    { method: "PATCH", body: { ids, enabled } },
    decodeCountResult<{ updated: number }>("updated"),
  );
}

export function deleteClientKeys(ids: string[]): Promise<{ deleted: number }> {
  return apiRequest(
    "/api/admin/v1/client-keys",
    { method: "DELETE", body: { ids } },
    decodeCountResult<{ deleted: number }>("deleted"),
  );
}
