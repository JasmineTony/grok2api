import { useTranslation } from "react-i18next";

import { EventList } from "@/features/quality-guard/guard-events-panel";
import { GuardOverview } from "@/features/quality-guard/guard-metrics";
import { NodeDeleteDialog } from "@/features/quality-guard/guard-node-delete-dialog";
import { NodeEditor } from "@/features/quality-guard/guard-node-editor";
import { GuardNodesCard } from "@/features/quality-guard/guard-nodes-card";
import { PolicyEditor } from "@/features/quality-guard/guard-policy-editor";
import { Policy } from "@/features/quality-guard/guard-policy-panel";
import { StatisticsPanel } from "@/features/quality-guard/guard-statistics-panel";
import type { QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import type { GuardNodesController } from "@/features/quality-guard/use-guard-nodes";

// 节点 tab 的内容组装：总览、统计、节点表格、事件与策略、两个弹窗。
// 数据与动作来自 useGuardNodes 控制器，本组件只负责结构与把 status 传给需要它的子面板。

export function GuardNodesTab({
  controller,
  status,
}: {
  controller: GuardNodesController;
  status: QualityGuardStatus;
}) {
  const { i18n } = useTranslation();
  const { view, actions, dialogs } = controller;
  return (
    <>
      <GuardOverview status={status} view={view} />
      {status.statistics ? <StatisticsPanel statistics={status.statistics} locale={i18n.language} /> : null}
      <GuardNodesCard controller={controller} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
        <EventList events={status.recentEvents ?? []} locale={i18n.language} />
        <Policy status={status} onEdit={() => dialogs.setPolicyOpen(true)} />
      </div>
      {dialogs.policyOpen ? <PolicyEditor open onOpenChange={dialogs.setPolicyOpen} status={status} /> : null}
      <NodeEditor
        open={dialogs.editingNode !== undefined}
        editingNode={dialogs.editingNode}
        form={dialogs.nodeForm}
        onFormChange={dialogs.setNodeForm}
        onOpenChange={(open) => {
          if (!open && !actions.saving) dialogs.closeEditor();
        }}
        onSave={actions.saveNode}
        saving={actions.saving}
      />
      <NodeDeleteDialog
        nodes={dialogs.deletingNodes}
        pending={actions.deleting}
        onOpenChange={(open) => {
          if (!open && !actions.deleting) dialogs.closeDelete();
        }}
        onConfirm={actions.deleteNodes}
      />
    </>
  );
}
