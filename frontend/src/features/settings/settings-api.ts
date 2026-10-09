import { apiRequest } from "@/shared/api/client";

import { decodeSettingsSnapshot } from "@/features/settings/settings-config-decoder";
import type { SettingsConfigDTO, SettingsSnapshotDTO } from "@/features/settings/settings-dto";

// 该模块是已冻结的跨 feature 入口（accounts / quality-guard / settings/egress-*），
// 导出名与签名必须保持兼容，因此只做再导出；实现按职责拆分到下列模块：
//   settings-dto.ts / settings-config-decoder.ts  → 设置配置的 DTO 与解码
//   egress-dto.ts / egress-decoders.ts / egress-api.ts → 出口节点、代理档案、订阅与运维
export type * from "@/features/settings/settings-dto";
export type * from "@/features/settings/egress-dto";
export * from "@/features/settings/egress-api";

export function getSettings(): Promise<SettingsSnapshotDTO> {
  return apiRequest("/api/admin/v1/settings", {}, decodeSettingsSnapshot);
}

export function updateSettings(revision: string, config: SettingsConfigDTO): Promise<SettingsSnapshotDTO> {
  return apiRequest("/api/admin/v1/settings", { method: "PUT", body: { revision, config } }, decodeSettingsSnapshot);
}
