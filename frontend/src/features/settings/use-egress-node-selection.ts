import { useState } from "react";

import type { EgressNodeDTO } from "@/entities/egress/egress-dto";

/** 勾选集合的更新规则：按 checked 写入或移除这批节点，跨页保留其余选择。 */
function withCheckedNodes(
  current: Map<string, EgressNodeDTO>,
  nodes: EgressNodeDTO[],
  checked: boolean,
): Map<string, EgressNodeDTO> {
  const next = new Map(current);
  for (const node of nodes) {
    if (checked) next.set(node.id, node);
    else next.delete(node.id);
  }
  return next;
}

export type EgressNodeSelection = {
  selected: Map<string, EgressNodeDTO>;
  selectedNodes: EgressNodeDTO[];
  selectedAssignedAccounts: number;
  selectedSourceNodes: number;
  toggleNode: (node: EgressNodeDTO, checked: boolean) => void;
  togglePage: (nodes: EgressNodeDTO[], checked: boolean) => void;
  removeFromSelection: (id: string) => void;
  resetSelection: () => void;
};

/** 出口节点列表的勾选状态：跨页保留选择，并汇总受影响账号数与订阅源托管节点数。 */
export function useEgressNodeSelection(): EgressNodeSelection {
  const [selected, setSelected] = useState<Map<string, EgressNodeDTO>>(() => new Map());

  function resetSelection(): void {
    setSelected(new Map());
  }

  function toggleNode(node: EgressNodeDTO, checked: boolean): void {
    setSelected((current) => withCheckedNodes(current, [node], checked));
  }

  function togglePage(nodes: EgressNodeDTO[], checked: boolean): void {
    setSelected((current) => withCheckedNodes(current, nodes, checked));
  }

  function removeFromSelection(id: string): void {
    setSelected((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  }

  const selectedNodes = [...selected.values()];
  const selectedAssignedAccounts = selectedNodes.reduce((total, node) => total + node.assignedAccountCount, 0);
  const selectedSourceNodes = selectedNodes.filter((node) => node.sourceId).length;

  return {
    selected,
    selectedNodes,
    selectedAssignedAccounts,
    selectedSourceNodes,
    toggleNode,
    togglePage,
    removeFromSelection,
    resetSelection,
  };
}
