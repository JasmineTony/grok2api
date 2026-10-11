import type { QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { showEgressError } from "@/features/settings/egress-feedback";

/**
 * 出口节点写操作的共用语义：失效范围与失败提示。
 * 单个 mutation 的生命周期留在各自 hook 中，这里只放所有写操作共享的规则。
 */

/** 节点列表查询键：列表、批量与探测写操作都按它失效。 */
export function invalidateEgressNodes(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
}

/** 代理配置库展示节点绑定数，节点增删改后需要一并失效。 */
export function invalidateEgressNodeDependencies(queryClient: QueryClient): void {
  invalidateEgressNodes(queryClient);
  void queryClient.invalidateQueries({ queryKey: ["egress-proxy-profiles"] });
}

/** 节点写操作统一的失败提示：优先展示服务端错误信息，否则回退到操作失败文案。 */
export function egressNodeMutationError(t: TFunction): (error: unknown) => void {
  return (error) => showEgressError(error, t("settings.egress.operationFailed"));
}
