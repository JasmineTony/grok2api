import { apiRequest } from "@/shared/api/client";

import { decodeSettingsSnapshot } from "@/features/settings/settings-config-decoder";
import type { SettingsConfigDTO, SettingsSnapshotDTO } from "@/features/settings/settings-dto";

// 设置页入口：设置配置的 DTO 与解码在 settings 内维护，本模块只导出设置自身的契约。
// 出口节点、代理档案、订阅与运维的 DTO / 解码 / API 契约定义在 entities/egress，由使用方直接 import。
export type * from "@/features/settings/settings-dto";

export function getSettings(): Promise<SettingsSnapshotDTO> {
  return apiRequest("/api/admin/v1/settings", {}, decodeSettingsSnapshot);
}

export function updateSettings(revision: string, config: SettingsConfigDTO): Promise<SettingsSnapshotDTO> {
  return apiRequest("/api/admin/v1/settings", { method: "PUT", body: { revision, config } }, decodeSettingsSnapshot);
}
