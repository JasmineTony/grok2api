import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Gauge,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  ShieldCheck,
  ShieldX,
  TimerReset,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DegradeAccountsPanel } from "@/features/quality-guard/degrade-accounts-panel";
import {
  getQualityGuardStatus,
  type QualityGuardNodeState,
  type QualityGuardStatus,
  runQualityTest,
} from "@/features/quality-guard/quality-guard-api";
import { NodeEditor, Policy, PolicyEditor } from "@/features/quality-guard/quality-guard-editors";
import { QualityGuardNodeDeleteDialog } from "@/features/quality-guard/quality-guard-node-delete-dialog";
import {
  EventList,
  Metric,
  NodeRow,
  StatisticsPanel,
  UnavailableState,
} from "@/features/quality-guard/quality-guard-overview";
import {
  emptyNodeInput,
  formatTime,
  formatTPS,
  isFresh,
  qualityTestState,
} from "@/features/quality-guard/quality-guard-utils";
import {
  createEgressNode,
  deleteEgressNodes,
  type EgressNodeDTO,
  type EgressNodeInput,
  listAllEgressNodes,
  updateEgressNode,
  updateEgressNodesEnabled,
} from "@/features/settings";
import { useApiClient } from "@/shared/api/use-api-client";
import { ErrorState } from "@/shared/components/data-state";
import { PageHeader } from "@/shared/components/page-header";
import { cn } from "@/shared/lib/cn";

const NODE_ACTION_TOAST_ID = "quality-guard-node-action";

export function QualityGuardPage() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const [manualResults, setManualResults] = useState<Record<string, QualityGuardNodeState>>({});
  const [policyOpen, setPolicyOpen] = useState(false);
  const [editingNode, setEditingNode] = useState<EgressNodeDTO | null | undefined>(undefined);
  const [nodeForm, setNodeForm] = useState<EgressNodeInput>(() => emptyNodeInput());
  const [deletingNodes, setDeletingNodes] = useState<EgressNodeDTO[]>([]);
  const [selectedNodeIDs, setSelectedNodeIDs] = useState<Set<string>>(() => new Set());
  const statusQuery = useQuery({
    queryKey: ["quality-guard"],
    queryFn: () => getQualityGuardStatus(apiClient),
    refetchInterval: 5_000,
  });
  const nodesQuery = useQuery({
    queryKey: ["quality-guard-egress-nodes"],
    queryFn: () => listAllEgressNodes(apiClient, { scope: "grok_build" }),
    refetchInterval: 15_000,
  });
  const testMutation = useMutation({
    mutationFn: ({ nodeId, status }: { nodeId: string; status: QualityGuardStatus }) =>
      runQualityTest(apiClient, nodeId, status),
    onMutate: () => toast.loading(t("qualityGuard.testing"), { id: NODE_ACTION_TOAST_ID }),
    onSuccess: (result, variables) => {
      setManualResults((current) => ({
        ...current,
        [variables.nodeId]: qualityTestState(result, variables.status),
      }));
      toast.success(
        t("qualityGuard.testComplete", { speed: formatTPS(result.outputTokensPerSecond) }),
        { id: NODE_ACTION_TOAST_ID },
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("qualityGuard.testFailed"), {
        id: NODE_ACTION_TOAST_ID,
      }),
  });

  const refreshNodeQueries = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["quality-guard"] }),
      queryClient.invalidateQueries({ queryKey: ["quality-guard-egress-nodes"] }),
      queryClient.invalidateQueries({ queryKey: ["egress-nodes"] }),
    ]);
  const saveNodeMutation = useMutation({
    mutationFn: () => {
      const proxyURL = nodeForm.proxyURL?.trim();
      const input: EgressNodeInput = {
        name: nodeForm.name.trim(),
        scope: "grok_build",
        enabled: nodeForm.enabled,
        accountCapacity: nodeForm.accountCapacity,
        userAgent: "",
        proxyPool: nodeForm.proxyPool ?? false,
        ...(proxyURL ? { proxyURL } : {}),
      };
      return editingNode
        ? updateEgressNode(apiClient, editingNode.id, input)
        : createEgressNode(apiClient, input);
    },
    onSuccess: () => {
      setEditingNode(undefined);
      void refreshNodeQueries();
      toast.success(t("settings.egress.saved"), { id: NODE_ACTION_TOAST_ID });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("settings.egress.operationFailed"), {
        id: NODE_ACTION_TOAST_ID,
      }),
  });
  const toggleNodeMutation = useMutation({
    mutationFn: ({ node, enabled }: { node: EgressNodeDTO; enabled: boolean }) =>
      updateEgressNodesEnabled(apiClient, [node.id], enabled),
    onSuccess: (_, { enabled }) => {
      void refreshNodeQueries();
      toast.success(t(enabled ? "qualityGuard.nodeEnabled" : "qualityGuard.nodeDisabled"), {
        id: NODE_ACTION_TOAST_ID,
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("settings.egress.operationFailed"), {
        id: NODE_ACTION_TOAST_ID,
      }),
  });
  const batchToggleMutation = useMutation({
    mutationFn: ({ nodes, enabled }: { nodes: EgressNodeDTO[]; enabled: boolean }) =>
      updateEgressNodesEnabled(
        apiClient,
        nodes.map((node) => node.id),
        enabled,
      ),
    onSuccess: (_, { enabled }) => {
      setSelectedNodeIDs(new Set());
      void refreshNodeQueries();
      toast.success(t(enabled ? "qualityGuard.nodesEnabled" : "qualityGuard.nodesDisabled"), {
        id: NODE_ACTION_TOAST_ID,
      });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("settings.egress.operationFailed"), {
        id: NODE_ACTION_TOAST_ID,
      }),
  });
  const deleteNodeMutation = useMutation({
    mutationFn: (nodes: EgressNodeDTO[]) =>
      deleteEgressNodes(
        apiClient,
        nodes.map((node) => node.id),
      ),
    onSuccess: () => {
      setDeletingNodes([]);
      setSelectedNodeIDs(new Set());
      void refreshNodeQueries();
      toast.success(t("settings.egress.deleted"), { id: NODE_ACTION_TOAST_ID });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : t("settings.egress.operationFailed"), {
        id: NODE_ACTION_TOAST_ID,
      }),
  });

  const openCreateNode = () => {
    setNodeForm(emptyNodeInput());
    setEditingNode(null);
  };
  const openEditNode = (node: EgressNodeDTO) => {
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
  };

  const refresh = () => void Promise.all([statusQuery.refetch(), nodesQuery.refetch()]);
  if (statusQuery.isError && !statusQuery.data)
    return <ErrorState message={statusQuery.error.message} onRetry={refresh} />;

  const status = statusQuery.data;
  const nodes = nodesQuery.data?.items ?? [];
  const protectedNodeIDs = new Set(status?.protectedNodeIds ?? []);
  const selectableNodes = nodes.filter((node) => !protectedNodeIDs.has(node.id));
  const selectedNodes = selectableNodes.filter((node) => selectedNodeIDs.has(node.id));
  const allNodesSelected =
    selectableNodes.length > 0 && selectedNodes.length === selectableNodes.length;
  const toggleAllNodes = (checked: boolean) =>
    setSelectedNodeIDs(checked ? new Set(selectableNodes.map((node) => node.id)) : new Set());
  const toggleSelectedNode = (node: EgressNodeDTO, checked: boolean) =>
    setSelectedNodeIDs((current) => {
      const next = new Set(current);
      if (checked) next.add(node.id);
      else next.delete(node.id);
      return next;
    });
  const fresh = isFresh(status);
  const guardedNodes = status?.nodes ?? {};
  const quarantined = Object.values(guardedNodes).filter((node) => node.disabled_by_guard).length;
  const enabled = nodes.filter((node) => node.enabled).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("qualityGuard.title")}
        description={t("qualityGuard.description")}
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={refresh}
            disabled={statusQuery.isFetching || nodesQuery.isFetching}
          >
            <RefreshCw
              className={cn((statusQuery.isFetching || nodesQuery.isFetching) && "animate-spin")}
            />
            {t("common.refresh")}
          </Button>
        }
      />

      <Tabs defaultValue="nodes">
        <TabsList>
          <TabsTrigger value="nodes">{t("qualityGuard.nodesTab")}</TabsTrigger>
          <TabsTrigger value="accounts">{t("qualityGuard.degrade.tab")}</TabsTrigger>
        </TabsList>
        <TabsContent value="accounts" className="mt-6">
          <DegradeAccountsPanel
            {...(status?.config?.soft_tps === undefined ? {} : { softTPS: status.config.soft_tps })}
            {...(status?.config?.hard_tps === undefined ? {} : { hardTPS: status.config.hard_tps })}
            {...(status?.config?.fail_closed === undefined
              ? {}
              : { failClosed: status.config.fail_closed })}
            {...(status?.config?.min_generation_ms === undefined
              ? {}
              : { minGenMs: status.config.min_generation_ms })}
          />
        </TabsContent>
        <TabsContent value="nodes" className="mt-6 space-y-6">
          {!status?.available ? (
            <UnavailableState />
          ) : (
            <>
              <section
                className="grid overflow-hidden rounded-lg bg-card sm:grid-cols-2 xl:grid-cols-4"
                aria-label={t("qualityGuard.overview")}
              >
                <Metric
                  icon={fresh ? ShieldCheck : ShieldX}
                  label={t("qualityGuard.serviceStatus")}
                  value={fresh ? t("qualityGuard.running") : t("qualityGuard.stale")}
                  tone={fresh ? "good" : "bad"}
                />
                <Metric
                  icon={Activity}
                  label={t("qualityGuard.mode")}
                  value={t(`qualityGuard.modes.${status.config?.mode ?? "hybrid"}`)}
                />
                <Metric
                  icon={Gauge}
                  label={t("qualityGuard.availableNodes")}
                  value={`${enabled} / ${nodes.length}`}
                />
                <Metric
                  icon={TimerReset}
                  label={t("qualityGuard.quarantinedNodes")}
                  value={String(quarantined)}
                  tone={quarantined ? "bad" : "good"}
                />
              </section>

              {status.statistics ? (
                <StatisticsPanel statistics={status.statistics} locale={i18n.language} />
              ) : null}

              <section
                className="overflow-hidden rounded-lg bg-card"
                aria-labelledby="guard-nodes-title"
              >
                <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div>
                    <h2 id="guard-nodes-title" className="text-sm font-medium">
                      {t("qualityGuard.nodes")}
                    </h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("qualityGuard.nodesHelp")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto sm:justify-end">
                    <span className="mr-1 hidden text-xs text-muted-foreground lg:inline">
                      {t("qualityGuard.updatedAt", {
                        time: formatTime(status.updatedAt, i18n.language),
                      })}
                    </span>
                    {selectedNodes.length > 0 ? (
                      <>
                        <span className="mr-1 text-xs text-muted-foreground">
                          {t("common.selectedCount", { count: selectedNodes.length })}
                        </span>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={
                            batchToggleMutation.isPending ||
                            selectedNodes.every((node) => node.enabled)
                          }
                          onClick={() =>
                            batchToggleMutation.mutate({ nodes: selectedNodes, enabled: true })
                          }
                        >
                          <Power />
                          {t("common.enable")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          disabled={
                            batchToggleMutation.isPending ||
                            selectedNodes.every((node) => !node.enabled)
                          }
                          onClick={() =>
                            batchToggleMutation.mutate({ nodes: selectedNodes, enabled: false })
                          }
                        >
                          <PowerOff />
                          {t("common.disable")}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                          disabled={deleteNodeMutation.isPending}
                          onClick={() => setDeletingNodes(selectedNodes)}
                        >
                          <Trash2 />
                          {t("common.delete")}
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      onClick={() => void nodesQuery.refetch()}
                      disabled={nodesQuery.isFetching}
                      aria-label={t("qualityGuard.refreshNodes")}
                      title={t("qualityGuard.refreshNodes")}
                    >
                      <RefreshCw
                        className={cn("size-4", nodesQuery.isFetching && "animate-spin")}
                      />
                    </Button>
                    <Button type="button" size="sm" onClick={openCreateNode}>
                      <Plus />
                      {t("settings.egress.add")}
                    </Button>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <Table className="min-w-[1040px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10 px-3">
                          <Checkbox
                            checked={
                              allNodesSelected
                                ? true
                                : selectedNodes.length > 0
                                  ? "indeterminate"
                                  : false
                            }
                            disabled={selectableNodes.length === 0}
                            onCheckedChange={(checked) => toggleAllNodes(checked === true)}
                            aria-label={t("common.selectPage")}
                          />
                        </TableHead>
                        <TableHead>{t("qualityGuard.node")}</TableHead>
                        <TableHead>{t("qualityGuard.state")}</TableHead>
                        <TableHead className="text-right">
                          {t("settings.egress.accounts")}
                        </TableHead>
                        <TableHead className="text-right">{t("qualityGuard.outputTPS")}</TableHead>
                        <TableHead className="text-right">{t("qualityGuard.firstToken")}</TableHead>
                        <TableHead>{t("qualityGuard.source")}</TableHead>
                        <TableHead>{t("qualityGuard.strikes")}</TableHead>
                        <TableHead>{t("qualityGuard.lastObserved")}</TableHead>
                        <TableHead className="w-48 text-right">{t("common.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {nodes.map((node) => (
                        <NodeRow
                          key={node.id}
                          node={node}
                          protectedNode={protectedNodeIDs.has(node.id)}
                          selected={selectedNodeIDs.has(node.id)}
                          onSelect={(checked) => toggleSelectedNode(node, checked)}
                          {...((manualResults[node.id] ?? guardedNodes[node.id])
                            ? { state: manualResults[node.id] ?? guardedNodes[node.id] }
                            : {})}
                          locale={i18n.language}
                          status={status}
                          testMutation={testMutation}
                          toggleMutation={toggleNodeMutation}
                          onEdit={openEditNode}
                          onDelete={(value) => setDeletingNodes([value])}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </section>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,3fr)_minmax(300px,2fr)]">
                <EventList events={status.recentEvents ?? []} locale={i18n.language} />
                <Policy status={status} onEdit={() => setPolicyOpen(true)} />
              </div>
              {policyOpen ? (
                <PolicyEditor open onOpenChange={setPolicyOpen} status={status} />
              ) : null}
              <NodeEditor
                open={editingNode !== undefined}
                editingNode={editingNode}
                form={nodeForm}
                onFormChange={setNodeForm}
                onOpenChange={(open) => {
                  if (!open && !saveNodeMutation.isPending) setEditingNode(undefined);
                }}
                onSave={() => saveNodeMutation.mutate()}
                saving={saveNodeMutation.isPending}
              />
              <QualityGuardNodeDeleteDialog
                nodes={deletingNodes}
                busy={deleteNodeMutation.isPending}
                onOpenChange={(open) => {
                  if (!open && !deleteNodeMutation.isPending) setDeletingNodes([]);
                }}
                onConfirm={() => {
                  if (deletingNodes.length > 0) deleteNodeMutation.mutate(deletingNodes);
                }}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
