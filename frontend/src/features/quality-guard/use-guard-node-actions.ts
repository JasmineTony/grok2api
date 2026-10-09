import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { useCallback, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { formatTPS } from "@/features/quality-guard/guard-format";
import { nodeInputFromForm } from "@/features/quality-guard/guard-node-form";
import { qualityTestState } from "@/features/quality-guard/guard-quality-test";
import type { GuardNodeDialogs } from "@/features/quality-guard/use-guard-node-dialogs";
import {
  runQualityTest,
  type QualityGuardNodeState,
  type QualityGuardStatus,
} from "@/features/quality-guard/quality-guard-api";
import {
  createEgressNode,
  deleteEgressNodes,
  updateEgressNode,
  updateEgressNodesEnabled,
  type EgressNodeDTO,
} from "@/features/settings/settings-api";

// 守护节点的人工操作（探测 / 新增编辑 / 启停 / 批量启停 / 删除）。
// 每个 mutation 独立成小 hook：共用同一个 toast id 与失效语义，避免复制第二套成功/失败处理。

const NODE_ACTION_TOAST_ID = "quality-guard-node-action";

function nodeActionError(error: unknown, t: TFunction, fallbackKey: string): void {
  toast.error(error instanceof Error ? error.message : t(fallbackKey), { id: NODE_ACTION_TOAST_ID });
}

function useGuardNodeRefresh(): () => Promise<unknown> {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["quality-guard"] }),
      queryClient.invalidateQueries({ queryKey: ["quality-guard-egress-nodes"] }),
      queryClient.invalidateQueries({ queryKey: ["egress-nodes"] }),
    ]);
}

function useGuardNodeTest(statusRef: RefObject<QualityGuardStatus | undefined>) {
  const { t } = useTranslation();
  const [manualResults, setManualResults] = useState<Record<string, QualityGuardNodeState>>({});
  const { mutate, isPending, variables } = useMutation({
    mutationFn: ({ nodeId, status }: { nodeId: string; status: QualityGuardStatus }) => runQualityTest(nodeId, status),
    onMutate: () => toast.loading(t("qualityGuard.testing"), { id: NODE_ACTION_TOAST_ID }),
    onSuccess: (result, variables) => {
      setManualResults((current) => ({ ...current, [variables.nodeId]: qualityTestState(result, variables.status) }));
      toast.success(t("qualityGuard.testComplete", { speed: formatTPS(result.outputTokensPerSecond) }), {
        id: NODE_ACTION_TOAST_ID,
      });
    },
    onError: (error) => nodeActionError(error, t, "qualityGuard.testFailed"),
  });
  const testNode = useCallback(
    (nodeId: string) => {
      const currentStatus = statusRef.current;
      if (currentStatus?.config) mutate({ nodeId, status: currentStatus });
    },
    [mutate, statusRef],
  );
  return { manualResults, testNode, testingNodeID: isPending ? variables?.nodeId : undefined };
}

function useGuardNodeSave(dialogs: GuardNodeDialogs, refreshQueries: () => Promise<unknown>) {
  const { t } = useTranslation();
  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      const input = nodeInputFromForm(dialogs.nodeForm);
      return dialogs.editingNode ? updateEgressNode(dialogs.editingNode.id, input) : createEgressNode(input);
    },
    onSuccess: () => {
      dialogs.closeEditor();
      void refreshQueries();
      toast.success(t("settings.egress.saved"), { id: NODE_ACTION_TOAST_ID });
    },
    onError: (error) => nodeActionError(error, t, "settings.egress.operationFailed"),
  });
  return { saveNode: mutate, saving: isPending };
}

function useGuardNodeToggle(clearSelection: () => void, refreshQueries: () => Promise<unknown>) {
  const { t } = useTranslation();
  const toggle = useMutation({
    mutationFn: ({ node, enabled }: { node: EgressNodeDTO; enabled: boolean }) =>
      updateEgressNodesEnabled([node.id], enabled),
    onSuccess: (_, { enabled }) => {
      void refreshQueries();
      toast.success(t(enabled ? "qualityGuard.nodeEnabled" : "qualityGuard.nodeDisabled"), {
        id: NODE_ACTION_TOAST_ID,
      });
    },
    onError: (error) => nodeActionError(error, t, "settings.egress.operationFailed"),
  });
  const batch = useMutation({
    mutationFn: ({ nodes, enabled }: { nodes: EgressNodeDTO[]; enabled: boolean }) =>
      updateEgressNodesEnabled(
        nodes.map((node) => node.id),
        enabled,
      ),
    onSuccess: (_, { enabled }) => {
      clearSelection();
      void refreshQueries();
      toast.success(t(enabled ? "qualityGuard.nodesEnabled" : "qualityGuard.nodesDisabled"), {
        id: NODE_ACTION_TOAST_ID,
      });
    },
    onError: (error) => nodeActionError(error, t, "settings.egress.operationFailed"),
  });
  const { mutate: mutateToggle, isPending: togglePending, variables: toggleVariables } = toggle;
  const { mutate: mutateBatch, isPending: batchPending } = batch;
  const toggleNode = useCallback(
    (node: EgressNodeDTO, enabled: boolean) => mutateToggle({ node, enabled }),
    [mutateToggle],
  );
  const batchToggleNodes = useCallback(
    (nodes: EgressNodeDTO[], enabled: boolean) => mutateBatch({ nodes, enabled }),
    [mutateBatch],
  );
  return {
    toggleNode,
    togglingNodeID: togglePending ? toggleVariables?.node.id : undefined,
    batchToggleNodes,
    batchPending,
  };
}

function useGuardNodeDelete(
  dialogs: GuardNodeDialogs,
  clearSelection: () => void,
  refreshQueries: () => Promise<unknown>,
) {
  const { t } = useTranslation();
  const { mutate, isPending } = useMutation({
    mutationFn: (nodes: EgressNodeDTO[]) => deleteEgressNodes(nodes.map((node) => node.id)),
    onSuccess: () => {
      dialogs.closeDelete();
      clearSelection();
      void refreshQueries();
      toast.success(t("settings.egress.deleted"), { id: NODE_ACTION_TOAST_ID });
    },
    onError: (error) => nodeActionError(error, t, "settings.egress.operationFailed"),
  });
  return { deleteNodes: mutate, deleting: isPending };
}

export type GuardNodeActions = {
  manualResults: Record<string, QualityGuardNodeState>;
  testingNodeID?: string;
  togglingNodeID?: string;
  saving: boolean;
  deleting: boolean;
  batchPending: boolean;
  testNode: (nodeId: string) => void;
  toggleNode: (node: EgressNodeDTO, enabled: boolean) => void;
  batchToggleNodes: (nodes: EgressNodeDTO[], enabled: boolean) => void;
  deleteNodes: (nodes: EgressNodeDTO[]) => void;
  saveNode: () => void;
};

export type GuardNodeActionDeps = {
  statusRef: RefObject<QualityGuardStatus | undefined>;
  dialogs: GuardNodeDialogs;
  clearSelection: () => void;
};

export function useGuardNodeActions({ statusRef, dialogs, clearSelection }: GuardNodeActionDeps): GuardNodeActions {
  const refreshQueries = useGuardNodeRefresh();
  const test = useGuardNodeTest(statusRef);
  const save = useGuardNodeSave(dialogs, refreshQueries);
  const toggle = useGuardNodeToggle(clearSelection, refreshQueries);
  const remove = useGuardNodeDelete(dialogs, clearSelection, refreshQueries);
  return {
    manualResults: test.manualResults,
    testingNodeID: test.testingNodeID,
    togglingNodeID: toggle.togglingNodeID,
    saving: save.saving,
    deleting: remove.deleting,
    batchPending: toggle.batchPending,
    testNode: test.testNode,
    toggleNode: toggle.toggleNode,
    batchToggleNodes: toggle.batchToggleNodes,
    deleteNodes: remove.deleteNodes,
    saveNode: save.saveNode,
  };
}
