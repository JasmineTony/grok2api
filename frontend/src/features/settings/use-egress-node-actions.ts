import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { egressNodeInputForSave } from "@/features/settings/egress-node-form-values";
import {
  egressNodeMutationError,
  invalidateEgressNodeDependencies,
  invalidateEgressNodes,
} from "@/features/settings/egress-node-mutations";
import { showEgressError } from "@/features/settings/egress-feedback";
import type { EgressNodeForm } from "@/features/settings/use-egress-node-form";
import type { EgressNodeList } from "@/features/settings/use-egress-node-list";
import type { EgressNodeOverlays } from "@/features/settings/use-egress-node-overlays";
import type { EgressNodeSelection } from "@/features/settings/use-egress-node-selection";
import {
  cleanupUnhealthyEgressNodes,
  createEgressNode,
  deleteEgressNode,
  deleteEgressNodes,
  previewUnhealthyEgressNodes,
  refreshEgressClearance,
  testEgressNode,
  updateEgressNode,
  updateEgressNodesEnabled,
} from "@/entities/egress/egress-api";

type EgressNodeListDeps = { list: EgressNodeList; selection: EgressNodeSelection };
type EgressNodeOverlayDeps = EgressNodeListDeps & { overlays: EgressNodeOverlays };

/** 节点保存（新增/更新）：成功后关闭弹窗并刷新节点列表与代理配置库。 */
function useEgressNodeSaveMutation(form: EgressNodeForm) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = egressNodeMutationError(t);

  return useMutation({
    mutationFn: () => {
      const input = egressNodeInputForSave(form.form, form.editing, form.revealedProxyURL);
      return form.editing ? updateEgressNode(form.editing.id, input) : createEgressNode(input);
    },
    onSuccess: () => {
      invalidateEgressNodeDependencies(queryClient);
      form.closeDialog();
      toast.success(t("settings.egress.saved"));
    },
    onError,
  });
}

/** 单行删除、批量删除与批量启停：成功后维护选择集，删空当前页时回退一页。 */
function useEgressNodeBulkMutations({ list, selection, overlays }: EgressNodeOverlayDeps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = egressNodeMutationError(t);

  const remove = useMutation({
    mutationFn: deleteEgressNode,
    onSuccess: (_, id) => {
      if (list.page > 1 && list.nodes.length === 1) list.setPage(list.page - 1);
      selection.removeFromSelection(id);
      invalidateEgressNodeDependencies(queryClient);
      toast.success(t("settings.egress.deleted"));
    },
    onError,
  });

  const removeMany = useMutation({
    mutationFn: () => deleteEgressNodes([...selection.selected.keys()]),
    onSuccess: (value) => {
      const selectedOnPage = list.nodes.filter((node) => selection.selected.has(node.id)).length;
      if (list.page > 1 && selectedOnPage > 0 && selectedOnPage === list.nodes.length) list.setPage(list.page - 1);
      selection.resetSelection();
      overlays.setBatchDeleteOpen(false);
      invalidateEgressNodeDependencies(queryClient);
      toast.success(t("settings.egress.batchDeleted", value));
    },
    onError,
  });

  const updateEnabled = useMutation({
    mutationFn: (enabled: boolean) => updateEgressNodesEnabled([...selection.selected.keys()], enabled),
    onSuccess: (value, enabled) => {
      selection.resetSelection();
      invalidateEgressNodes(queryClient);
      toast.success(t(enabled ? "settings.egress.batchEnabled" : "settings.egress.batchDisabled", value));
    },
    onError,
  });

  return { remove, removeMany, updateEnabled };
}

/** 清理不可用节点：先预览统计，确认后清理、回到第 1 页并清空选择集。 */
function useEgressNodeCleanupMutations({ list, selection, overlays }: EgressNodeOverlayDeps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = egressNodeMutationError(t);

  const preview = useMutation({ mutationFn: previewUnhealthyEgressNodes });

  const cleanup = useMutation({
    mutationFn: cleanupUnhealthyEgressNodes,
    onSuccess: (value) => {
      list.setPage(1);
      selection.resetSelection();
      overlays.setCleanupOpen(false);
      preview.reset();
      invalidateEgressNodeDependencies(queryClient);
      toast.success(t("settings.egress.cleanupUnavailableComplete", value));
    },
    onError,
  });

  function openCleanup(): void {
    preview.reset();
    overlays.setCleanupOpen(true);
    preview.mutate();
  }

  function resetCleanupPreview(): void {
    preview.reset();
  }

  return { preview, cleanup, openCleanup, resetCleanupPreview };
}

/** 单节点探测与清关刷新：探测结果在服务端错误字段里返回失败原因，按失败提示展示。 */
function useEgressNodeProbeMutations() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const onError = egressNodeMutationError(t);

  const testNode = useMutation({
    mutationFn: testEgressNode,
    onSuccess: (result) => {
      if (result.status === "healthy") toast.success(t("settings.egress.testedOne"));
      else showEgressError(result.error, t("settings.egress.operationFailed"));
    },
    onError,
    onSettled: () => {
      invalidateEgressNodes(queryClient);
    },
  });

  const refreshClearance = useMutation({
    mutationFn: (id: string) => refreshEgressClearance(id),
    onSuccess: () => {
      invalidateEgressNodes(queryClient);
      toast.success(t("settings.egress.clearanceRefreshed"));
    },
    onError,
  });

  return { testNode, refreshClearance };
}

export type EgressNodeMutationDeps = EgressNodeOverlayDeps & { form: EgressNodeForm };

/** 出口节点全部写操作：保存、批量、清理与探测，共用失效范围与失败提示语义。 */
export function useEgressNodeMutations({ list, selection, overlays, form }: EgressNodeMutationDeps) {
  const save = useEgressNodeSaveMutation(form);
  const bulk = useEgressNodeBulkMutations({ list, selection, overlays });
  const cleanup = useEgressNodeCleanupMutations({ list, selection, overlays });
  const probe = useEgressNodeProbeMutations();
  return { save, ...bulk, ...cleanup, ...probe };
}

export type EgressNodeMutations = ReturnType<typeof useEgressNodeMutations>;
