import { useCallback, useState } from "react";

import { emptyNodeInput } from "@/features/quality-guard/guard-node-form";
import type { EgressNodeDTO, EgressNodeInput } from "@/features/settings/settings-api";

// 守护页的弹窗状态：策略编辑、节点新增/编辑、节点删除确认。
// editingNode 用 undefined 表示关闭、null 表示新增、DTO 表示编辑，与拆分前语义一致。

export type GuardNodeDialogs = {
  policyOpen: boolean;
  setPolicyOpen: (open: boolean) => void;
  editingNode: EgressNodeDTO | null | undefined;
  nodeForm: EgressNodeInput;
  setNodeForm: (form: EgressNodeInput) => void;
  deletingNodes: EgressNodeDTO[];
  beginCreate: () => void;
  beginEdit: (node: EgressNodeDTO) => void;
  beginDelete: (nodes: EgressNodeDTO[]) => void;
  closeEditor: () => void;
  closeDelete: () => void;
};

export function useGuardNodeDialogs(): GuardNodeDialogs {
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<EgressNodeDTO | null | undefined>(undefined);
  const [nodeForm, setNodeForm] = useState<EgressNodeInput>(emptyNodeInput);
  const [deletingNodes, setDeletingNodes] = useState<EgressNodeDTO[]>([]);

  const beginCreate = useCallback(() => {
    setNodeForm(emptyNodeInput());
    setEditingNode(null);
  }, []);
  const beginEdit = useCallback((node: EgressNodeDTO) => {
    setNodeForm({
      name: node.name,
      scope: "grok_build",
      enabled: node.enabled,
      proxyPool: node.proxyPool,
      accountCapacity: node.accountCapacity,
      proxyURL: "",
      userAgent: "",
      cloudflareCookies: "",
    });
    setEditingNode(node);
  }, []);
  const beginDelete = useCallback((nodes: EgressNodeDTO[]) => setDeletingNodes(nodes), []);
  const closeEditor = useCallback(() => setEditingNode(undefined), []);
  const closeDelete = useCallback(() => setDeletingNodes([]), []);

  return {
    policyOpen,
    setPolicyOpen,
    editingNode,
    nodeForm,
    setNodeForm,
    deletingNodes,
    beginCreate,
    beginEdit,
    beginDelete,
    closeEditor,
    closeDelete,
  };
}
