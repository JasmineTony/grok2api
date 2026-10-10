import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { scopeSupportsAccountProvider } from "@/features/accounts/accounts-egress-filter";
import type { AccountsFlowContext } from "@/features/accounts/accounts-flow-context";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import {
  assignEgressAccounts,
  listAllEgressNodes,
  unassignEgressAccounts,
  type EgressScope,
} from "@/features/settings/settings-api";
import type { BindableEgressNode } from "@/features/accounts/account-batch-dialogs";

type EgressTask = "bind" | "unbind";

export type AccountsEgressFlow = {
  open: boolean;
  selectedCount: number;
  task: EgressTask;
  onTaskChange: (value: EgressTask) => void;
  nodeId: string;
  onNodeIdChange: (value: string) => void;
  nodes: BindableEgressNode[];
  nodesPending: boolean;
  nodesError: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  openDialog: () => void;
  busy: boolean;
};

/** 绑定出口需要全部兼容节点，且只在弹窗打开时才查询。 */
function useBindableEgressNodes(open: boolean, task: EgressTask, provider: AccountProvider) {
  const query = useQuery({
    queryKey: ["egress-nodes", "account-binding"],
    queryFn: () => listAllEgressNodes(),
    enabled: open && task === "bind",
    staleTime: 60_000,
  });
  const nodes = (query.data?.items ?? []).filter(
    (node: { enabled: boolean; proxyConfigured: boolean; scope: EgressScope }) =>
      node.enabled && node.proxyConfigured && scopeSupportsAccountProvider(node.scope, provider),
  );
  return { nodes, pending: query.isPending, error: query.isError ? query.error.message : null };
}

function useEgressAssignmentMutations(input: { ctx: AccountsFlowContext; nodeId: string; onDone: () => void }) {
  const { ctx, nodeId, onDone } = input;
  const { provider, selectedIds, clearSelection, invalidate, invalidateEgressNodes, showError, t } = ctx;
  const bind = useMutation({
    mutationFn: () => {
      if (!nodeId) throw new Error(t("accounts.bindEgressEmpty"));
      return assignEgressAccounts(nodeId, provider, selectedIds);
    },
    onSuccess: () => {
      clearSelection();
      onDone();
      invalidate();
      invalidateEgressNodes();
      toast.success(t("accounts.egressBound"));
    },
    onError: showError,
  });
  const unbind = useMutation({
    mutationFn: () => unassignEgressAccounts(provider, selectedIds),
    onSuccess: () => {
      clearSelection();
      onDone();
      invalidate();
      invalidateEgressNodes();
      toast.success(t("accounts.egressUnbound"));
    },
    onError: showError,
  });
  return { bind, unbind };
}

export function useAccountsEgressFlow(ctx: AccountsFlowContext): AccountsEgressFlow {
  const [open, setOpen] = useState(false);
  const [task, setTask] = useState<EgressTask>("bind");
  const [nodeId, setNodeId] = useState("");
  const nodesQuery = useBindableEgressNodes(open, task, ctx.provider);
  const mutations = useEgressAssignmentMutations({ ctx, nodeId, onDone: () => setOpen(false) });
  const close = (): void => {
    setOpen(false);
    setTask("bind");
    setNodeId("");
  };
  return {
    open,
    selectedCount: ctx.selectedCount,
    task,
    onTaskChange: setTask,
    nodeId,
    onNodeIdChange: setNodeId,
    nodes: nodesQuery.nodes,
    nodesPending: nodesQuery.pending,
    nodesError: nodesQuery.error,
    pending: mutations.bind.isPending || mutations.unbind.isPending,
    onOpenChange: (next) => {
      if (next) setOpen(true);
      else close();
    },
    onConfirm: () => {
      if (task === "bind") mutations.bind.mutate();
      else mutations.unbind.mutate();
    },
    openDialog: () => {
      setTask("bind");
      setNodeId("");
      setOpen(true);
    },
    busy: mutations.bind.isPending || mutations.unbind.isPending,
  };
}
