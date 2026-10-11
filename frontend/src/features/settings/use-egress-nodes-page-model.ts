import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

import type { EgressNodeRowActions } from "@/features/settings/egress-nodes-table";
import { useEgressNodeMutations, type EgressNodeMutations } from "@/features/settings/use-egress-node-actions";
import { useEgressNodeForm, type EgressNodeForm } from "@/features/settings/use-egress-node-form";
import { useEgressNodeImport, type EgressNodeImport } from "@/features/settings/use-egress-node-import";
import { useEgressNodeList, type EgressNodeList } from "@/features/settings/use-egress-node-list";
import { useEgressNodeOverlays, type EgressNodeOverlays } from "@/features/settings/use-egress-node-overlays";
import { useEgressNodeSelection, type EgressNodeSelection } from "@/features/settings/use-egress-node-selection";
import type { EgressScope } from "@/entities/egress/egress-dto";

/** 作用域展示文案：筛选器、表格与弹窗共用同一套口径。 */
function egressScopeLabel(t: TFunction, scope: EgressScope): string {
  if (scope === "grok_build") return t("settings.egress.scopeBuild");
  if (scope === "grok_console") return t("console.name");
  if (scope === "grok_web_asset") return t("settings.egress.scopeWebAsset");
  if (scope === "grok_console_asset") return t("settings.egress.scopeConsoleAsset");
  return t("settings.egress.scopeWeb");
}

export type EgressNodesPageModel = {
  scopeLabel: (scope: EgressScope) => string;
  list: EgressNodeList;
  selection: EgressNodeSelection;
  form: EgressNodeForm;
  importFlow: EgressNodeImport;
  overlays: EgressNodeOverlays;
  mutations: EgressNodeMutations;
  rowActions: EgressNodeRowActions;
};

/**
 * 出口节点分区的页面模型：装配列表查询、勾选状态、编辑草稿、导入草稿、弹窗开关与写操作，
 * 并把行内动作收敛成表格需要的契约。
 */
export function useEgressNodesPageModel(): EgressNodesPageModel {
  const { t } = useTranslation();
  const selection = useEgressNodeSelection();
  const list = useEgressNodeList(selection.resetSelection);
  const form = useEgressNodeForm();
  const importFlow = useEgressNodeImport();
  const overlays = useEgressNodeOverlays();
  const mutations = useEgressNodeMutations({ list, selection, overlays, form });
  const scopeLabel = (scope: EgressScope) => egressScopeLabel(t, scope);

  const rowActions: EgressNodeRowActions = {
    edit: form.openDialog,
    remove: (node) => mutations.remove.mutate(node.id),
    test: (node) => mutations.testNode.mutate(node.id),
    refreshClearance: (node) => mutations.refreshClearance.mutate(node.id),
    testPending: mutations.testNode.isPending,
    clearancePending: mutations.refreshClearance.isPending,
  };

  return { scopeLabel, list, selection, form, importFlow, overlays, mutations, rowActions };
}
