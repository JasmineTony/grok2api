import type { UseQueryResult } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import { isFresh } from "@/features/quality-guard/guard-format";
import { useGuardNodeActions, type GuardNodeActions } from "@/features/quality-guard/use-guard-node-actions";
import { useGuardNodeDialogs, type GuardNodeDialogs } from "@/features/quality-guard/use-guard-node-dialogs";
import {
  useGuardNodeCountsQuery,
  useGuardNodeFilters,
  useGuardNodesListQuery,
  useGuardStatusQuery,
  type GuardNodeCounts,
  type GuardNodeFilters,
} from "@/features/quality-guard/use-guard-node-list";
import type { QualityGuardNodeState, QualityGuardStatus } from "@/features/quality-guard/quality-guard-api";
import type { EgressNodeDTO, EgressNodeListDTO } from "@/features/settings/settings-api";

// 节点 tab 的控制器：筛选/分页状态、三个查询、派生视图、行选择、弹窗状态与人工操作。
// 页面只负责 tab 组装与错误态，具体职责下沉到各自 hook，保持零行为变更。

export type GuardNodesView = {
  status?: QualityGuardStatus;
  nodes: EgressNodeDTO[];
  guardedNodes: Record<string, QualityGuardNodeState>;
  protectedNodeIDs: Set<string>;
  selectableNodes: EgressNodeDTO[];
  selectedNodes: EgressNodeDTO[];
  allNodesSelected: boolean;
  fresh: boolean;
  quarantined: number;
  quarantinedLeases: number;
  totalNodes: number;
  enabledNodes?: number;
  refreshing: boolean;
};

export type GuardNodesSelection = {
  selectedNodeIDs: Set<string>;
  toggleSelectedNode: (nodeId: string, checked: boolean) => void;
  toggleAllNodes: (checked: boolean) => void;
  clearSelection: () => void;
};

export type GuardNodesController = {
  filters: GuardNodeFilters;
  nodesQuery: UseQueryResult<EgressNodeListDTO, Error>;
  nodeCountsQuery: UseQueryResult<GuardNodeCounts, Error>;
  statusQuery: UseQueryResult<QualityGuardStatus, Error>;
  view: GuardNodesView;
  actions: GuardNodeActions;
  dialogs: GuardNodeDialogs;
  selection: GuardNodesSelection;
  refresh: () => void;
};

function deriveGuardNodes(
  statusQuery: UseQueryResult<QualityGuardStatus, Error>,
  nodesQuery: UseQueryResult<EgressNodeListDTO, Error>,
  nodeCountsQuery: UseQueryResult<GuardNodeCounts, Error>,
  selectedNodeIDs: Set<string>,
  nodesTabActive: boolean,
): GuardNodesView {
  const status = statusQuery.data;
  const nodes = nodesQuery.data?.items ?? [];
  const guardedNodes = status?.nodes ?? {};
  const protectedNodeIDs = new Set(status?.protectedNodeIds ?? []);
  const selectableNodes = nodes.filter((node) => !protectedNodeIDs.has(node.id));
  const selectedNodes = selectableNodes.filter((node) => selectedNodeIDs.has(node.id));
  const quarantined =
    status?.nodeSummary?.quarantined ?? Object.values(guardedNodes).filter((node) => node.disabled_by_guard).length;
  const quarantinedLeases =
    status?.nodeSummary?.quarantinedLeases ??
    Object.values(guardedNodes).reduce((total, node) => total + (node.quarantined_lease_count ?? 0), 0);
  return {
    status,
    nodes,
    guardedNodes,
    protectedNodeIDs,
    selectableNodes,
    selectedNodes,
    allNodesSelected: selectableNodes.length > 0 && selectedNodes.length === selectableNodes.length,
    fresh: isFresh(status),
    quarantined,
    quarantinedLeases,
    totalNodes: nodeCountsQuery.data?.total ?? nodesQuery.data?.total ?? nodes.length,
    enabledNodes: nodeCountsQuery.data?.enabled,
    refreshing: statusQuery.isFetching || (nodesTabActive && (nodesQuery.isFetching || nodeCountsQuery.isFetching)),
  };
}

export function useGuardNodes(nodesTabActive: boolean): GuardNodesController {
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<Set<string>>(() => new Set());
  const clearSelection = useCallback(() => setSelectedNodeIDs(new Set()), []);
  const filters = useGuardNodeFilters(clearSelection);
  const nodesQuery = useGuardNodesListQuery(nodesTabActive, filters);
  const nodeCountsQuery = useGuardNodeCountsQuery(nodesTabActive);
  const nodeIDs = nodesTabActive ? (nodesQuery.data?.items.map((node) => node.id) ?? []) : [];
  const { statusQuery, statusRef } = useGuardStatusQuery(nodeIDs);
  const dialogs = useGuardNodeDialogs();
  const actions = useGuardNodeActions({ statusRef, dialogs, clearSelection });
  const view = deriveGuardNodes(statusQuery, nodesQuery, nodeCountsQuery, selectedNodeIDs, nodesTabActive);

  const toggleSelectedNode = useCallback(
    (nodeId: string, checked: boolean) =>
      setSelectedNodeIDs((current) => {
        const next = new Set(current);
        if (checked) next.add(nodeId);
        else next.delete(nodeId);
        return next;
      }),
    [],
  );
  const toggleAllNodes = (checked: boolean) =>
    setSelectedNodeIDs(checked ? new Set(view.selectableNodes.map((node) => node.id)) : new Set());
  const refresh = () =>
    void (nodesTabActive
      ? Promise.all([statusQuery.refetch(), nodesQuery.refetch(), nodeCountsQuery.refetch()])
      : statusQuery.refetch());

  return {
    filters,
    nodesQuery,
    nodeCountsQuery,
    statusQuery,
    view,
    actions,
    dialogs,
    selection: { selectedNodeIDs, toggleSelectedNode, toggleAllNodes, clearSelection },
    refresh,
  };
}
