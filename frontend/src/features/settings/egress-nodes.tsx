import type { ReactElement } from "react";

import {
  EgressImportOverlay,
  EgressNodeEditorOverlay,
  EgressNodesBatchDeleteOverlay,
  EgressNodesCleanupOverlay,
  EgressProxyLibraryOverlay,
} from "@/features/settings/egress-nodes-overlays";
import { EgressNodesSection } from "@/features/settings/egress-nodes-section";
import { EgressAutomation, EgressSources } from "@/features/settings/egress-operations";
import type { ClearanceMode } from "@/features/settings/settings-dto";
import { useEgressNodesPageModel } from "@/features/settings/use-egress-nodes-page-model";

export type EgressNodesProps = { title: string; clearanceMode: ClearanceMode };

/**
 * 出口节点分区容器：装配页面模型（列表查询、勾选、编辑草稿、弹窗开关与写操作），
 * 把列表分区与各弹窗委托给各自模块；既有 data-testid、i18n key、查询 key 与取消语义保持不变。
 */
export function EgressNodes({ title, clearanceMode }: EgressNodesProps): ReactElement {
  const page = useEgressNodesPageModel();

  return (
    <div className="space-y-8">
      <EgressSources scopeLabel={page.scopeLabel} />

      <EgressNodesSection title={title} clearanceMode={clearanceMode} page={page} />

      <EgressAutomation scopeLabel={page.scopeLabel} />

      <EgressNodesBatchDeleteOverlay page={page} />

      <EgressNodesCleanupOverlay page={page} />

      <EgressNodeEditorOverlay clearanceMode={clearanceMode} page={page} />

      <EgressImportOverlay page={page} />

      <EgressProxyLibraryOverlay page={page} />
    </div>
  );
}
