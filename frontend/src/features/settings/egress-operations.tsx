import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Network, Shuffle } from "lucide-react";
import { useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EgressAutomationSettings, type EgressOperationsForm } from "@/features/settings/egress-automation-settings";
import { fallbackWithMode, operationsFormFrom } from "@/features/settings/egress-automation-model";
import { fallbackNodeCandidates } from "@/features/settings/egress-fallback";
import { showEgressError } from "@/features/settings/egress-feedback";
import { EgressActionTooltip, EgressSectionHeader } from "@/features/settings/egress-section-header";
import { EgressSourceDialog } from "@/features/settings/egress-source-dialog";
import { emptyEgressSource, type EgressSourceForm } from "@/features/settings/egress-source-form";
import { paginateSources, sourceFormFor, sourceInputFrom } from "@/features/settings/egress-source-model";
import { EgressSourcesTable, EgressSourcesToolbar } from "@/features/settings/egress-sources";
import {
  createEgressSource,
  deleteEgressSource,
  getEgressOperationsConfig,
  listAllEgressNodes,
  listEgressSources,
  rebalanceEgressAccounts,
  syncEgressSource,
  testEgressNodes,
  updateEgressOperationsConfig,
  updateEgressSource,
} from "@/entities/egress/egress-api";
import type {
  EgressFallbackConfigDTO,
  EgressFallbackMode,
  EgressScope,
  EgressSourceDTO,
  EgressSourceListDTO,
} from "@/entities/egress/egress-dto";
import { validSubscriptionProxyURL } from "@/features/settings/settings-model";
import { useEgressSourcesFilters, type EgressSourcesFilters } from "@/features/settings/use-egress-sources-filters";
import { ErrorState, LoadingState } from "@/shared/components/data-state";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";

// Eight nodes run concurrently; each checks IPv4 and IPv6 in parallel with a
// 15-second ceiling. Keeping a request to 32 nodes leaves enough headroom for
// the admin HTTP timeout.
const egressProbeBatchSize = 32;

async function testAllEgressNodes() {
  const nodes = await listAllEgressNodes();
  const ids = nodes.items.filter((node) => node.enabled && node.proxyConfigured).map((node) => node.id);
  const result = { requested: 0, healthy: 0, unhealthy: 0, failed: 0 };
  let firstError: unknown;
  for (let index = 0; index < ids.length; index += egressProbeBatchSize) {
    const batchIDs = ids.slice(index, index + egressProbeBatchSize);
    try {
      const batch = await testEgressNodes(batchIDs);
      result.requested += batch.requested;
      result.healthy += batch.healthy;
      result.unhealthy += batch.unhealthy;
    } catch (error) {
      firstError ??= error;
      result.failed += batchIDs.length;
    }
  }
  if (result.requested === 0 && result.failed > 0) {
    throw firstError;
  }
  return result;
}

/** 探测/重平衡/保存都会改写节点与自动化配置，统一失效这两个查询键。 */
function invalidateEgressAutomationQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
  void queryClient.invalidateQueries({ queryKey: ["egress-operations"] });
}

/** 订阅源写入会同时改变节点绑定，统一失效这两个查询键。 */
function invalidateEgressSourcesQueries(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
  void queryClient.invalidateQueries({ queryKey: ["egress-sources"] });
}

/** 全量探测：按批探测所有启用且已配置代理的节点，失败批次计入未完成数。 */
function EgressAutomationTestAllAction() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const testAll = useMutation({
    mutationFn: testAllEgressNodes,
    onSuccess: (value) => {
      if (value.failed > 0) toast.warning(t("settings.egress.testedPartial", value));
      else toast.success(t("settings.egress.tested", value));
    },
    onError: (error) => showEgressError(error),
    onSettled: () => invalidateEgressAutomationQueries(queryClient),
  });
  return (
    <EgressActionTooltip label={t("settings.egress.testAllHelp")}>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={testAll.isPending}
        onClick={() => testAll.mutate()}
        data-testid="egress-automation-test-all"
      >
        {testAll.isPending ? <Spinner /> : <Network />}
        {t("settings.egress.testAll")}
      </Button>
    </EgressActionTooltip>
  );
}

/** 账号重平衡：按当前容量重新分配账号并刷新节点查询。 */
function EgressAutomationRebalanceAction() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const rebalance = useMutation({
    mutationFn: rebalanceEgressAccounts,
    onSuccess: (value) => {
      invalidateEgressAutomationQueries(queryClient);
      toast.success(t("settings.egress.rebalanced", value));
    },
    onError: (error) => showEgressError(error),
  });
  return (
    <EgressActionTooltip label={t("settings.egress.rebalanceHelp")}>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={rebalance.isPending}
        onClick={() => rebalance.mutate()}
        data-testid="egress-automation-rebalance"
      >
        {rebalance.isPending ? <Spinner /> : <Shuffle />}
        {t("settings.egress.rebalance")}
      </Button>
    </EgressActionTooltip>
  );
}

type EgressAutomationSaveActionProps = {
  form: EgressOperationsForm;
  draftActive: boolean;
  onDraftChange: (form: EgressOperationsForm | null) => void;
};

/** 保存自动化配置：成功后清空草稿并失效节点与自动化查询。 */
function EgressAutomationSaveAction({ form, draftActive, onDraftChange }: EgressAutomationSaveActionProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: () => updateEgressOperationsConfig(form),
    onSuccess: () => {
      onDraftChange(null);
      invalidateEgressAutomationQueries(queryClient);
      toast.success(t("settings.egress.automationSaved"));
    },
    onError: (error) => showEgressError(error),
  });
  return (
    <EgressActionTooltip label={t("settings.egress.saveAutomationHelp")}>
      <Button
        type="button"
        size="sm"
        disabled={!draftActive || save.isPending}
        onClick={() => save.mutate()}
        data-testid="egress-automation-save"
      >
        {save.isPending ? <Spinner /> : null}
        {t("common.save")}
      </Button>
    </EgressActionTooltip>
  );
}

/** 出口自动化分区：探测/分配参数、兜底策略与全量探测、重平衡操作。 */
export function EgressAutomation({ scopeLabel }: { scopeLabel: (scope: EgressScope) => string }): ReactElement {
  const { t } = useTranslation();
  const [operationsDraft, setOperationsDraft] = useState<EgressOperationsForm | null>(null);
  const operationsQuery = useQuery({ queryKey: ["egress-operations"], queryFn: getEgressOperationsConfig });
  const nodesQuery = useQuery({ queryKey: ["egress-nodes", "fallback-options"], queryFn: () => listAllEgressNodes() });
  const operationsForm = operationsDraft ?? operationsFormFrom(operationsQuery.data);
  const nodes = nodesQuery.data?.items ?? [];

  function setFallback(scope: EgressScope, fallback: EgressFallbackConfigDTO) {
    setOperationsDraft({ ...operationsForm, fallbacks: { ...operationsForm.fallbacks, [scope]: fallback } });
  }

  function setFallbackMode(scope: EgressScope, mode: EgressFallbackMode) {
    setFallback(scope, fallbackWithMode(fallbackNodeCandidates(nodes, scope), operationsForm.fallbacks[scope], mode));
  }

  return (
    <section className="space-y-8" data-testid="egress-automation">
      <div className="space-y-3">
        <EgressSectionHeader title={t("settings.egress.automation")} help={t("settings.egress.automationHelp")}>
          <EgressAutomationTestAllAction />
          <EgressAutomationRebalanceAction />
          <EgressAutomationSaveAction
            form={operationsForm}
            draftActive={operationsDraft !== null}
            onDraftChange={setOperationsDraft}
          />
        </EgressSectionHeader>

        {operationsQuery.isError ? (
          <ErrorState message={operationsQuery.error.message} onRetry={() => void operationsQuery.refetch()} />
        ) : operationsQuery.isPending ? (
          <LoadingState />
        ) : (
          <EgressAutomationSettings
            form={operationsForm}
            nodes={nodes}
            scopeLabel={scopeLabel}
            onChange={setOperationsDraft}
            onFallback={setFallback}
            onFallbackMode={setFallbackMode}
          />
        )}
      </div>
    </section>
  );
}

type EgressSourcesRowsProps = {
  query: UseQueryResult<EgressSourceListDTO>;
  sources: EgressSourceDTO[];
  filters: EgressSourcesFilters;
  scopeLabel: (scope: EgressScope) => string;
  hasActiveFilters: boolean;
  onEdit: (source: EgressSourceDTO) => void;
};

/** 订阅源表格的数据与行内操作：同步、删除 mutation。 */
function EgressSourcesRows(props: EgressSourcesRowsProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const removeSource = useMutation({
    mutationFn: deleteEgressSource,
    onSuccess: () => {
      if (props.filters.page > 1 && props.sources.length === 1) props.filters.changePage(props.filters.page - 1);
      invalidateEgressSourcesQueries(queryClient);
      toast.success(t("settings.egress.sourceDeleted"));
    },
    onError: (error) => showEgressError(error),
  });
  const syncSource = useMutation({
    mutationFn: syncEgressSource,
    onSuccess: (value) => {
      invalidateEgressSourcesQueries(queryClient);
      toast.success(t("settings.egress.sourceSynced", value));
    },
    onError: (error) => showEgressError(error),
  });
  return (
    <EgressSourcesTable
      query={props.query}
      sources={props.sources}
      scopeLabel={props.scopeLabel}
      hasActiveFilters={props.hasActiveFilters}
      syncPending={syncSource.isPending}
      removePending={removeSource.isPending}
      onSync={(source) => syncSource.mutate(source.id)}
      onEdit={props.onEdit}
      onDelete={(source) => removeSource.mutate(source.id)}
    />
  );
}

type EgressSourcesListProps = {
  query: UseQueryResult<EgressSourceListDTO>;
  sources: EgressSourceDTO[];
  filters: EgressSourcesFilters;
  scopeLabel: (scope: EgressScope) => string;
  onAdd: () => void;
  onEdit: (source: EgressSourceDTO) => void;
};

/** 订阅源列表：筛选工具栏、分页与表格装配。 */
function EgressSourcesList(props: EgressSourcesListProps) {
  const { filtered, currentPage, items, hasActiveFilters } = paginateSources(props.sources, props.filters);
  return (
    <DataTableShell
      toolbar={
        <EgressSourcesToolbar
          search={props.filters.search}
          onSearchChange={props.filters.changeSearch}
          scopeFilter={props.filters.scopeFilter}
          onScopeFilterChange={props.filters.changeScopeFilter}
          scopeLabel={props.scopeLabel}
          onAdd={props.onAdd}
        />
      }
      footer={
        filtered.length > 0 ? (
          <Pagination
            page={currentPage}
            pageSize={props.filters.pageSize}
            total={filtered.length}
            onPageChange={props.filters.changePage}
            onPageSizeChange={props.filters.changePageSize}
          />
        ) : undefined
      }
    >
      <EgressSourcesRows
        query={props.query}
        sources={items}
        filters={props.filters}
        scopeLabel={props.scopeLabel}
        hasActiveFilters={hasActiveFilters}
        onEdit={props.onEdit}
      />
    </DataTableShell>
  );
}

type EgressSourceEditorProps = {
  editing: EgressSourceDTO | null | undefined;
  form: EgressSourceForm;
  scopeLabel: (scope: EgressScope) => string;
  onFormChange: (changes: Partial<EgressSourceForm>) => void;
  onClose: () => void;
  onCreated: () => void;
};

/** 订阅源新增/编辑弹窗：保存成功后清空编辑态并失效节点与订阅源查询。 */
function EgressSourceEditor({ editing, form, scopeLabel, onFormChange, onClose, onCreated }: EgressSourceEditorProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const saveSource = useMutation({
    mutationFn: () => {
      const input = sourceInputFrom(form, editing ?? null);
      return editing ? updateEgressSource(editing.id, input) : createEgressSource(input);
    },
    onSuccess: () => {
      if (!editing) onCreated();
      invalidateEgressSourcesQueries(queryClient);
      onClose();
      toast.success(t("settings.egress.sourceSaved"));
    },
    onError: (error) => showEgressError(error),
  });
  const invalidProxy = form.proxyEnabled && Boolean(form.proxyURL.trim()) && !validSubscriptionProxyURL(form.proxyURL);
  return (
    <EgressSourceDialog
      editing={editing}
      form={form}
      invalidProxy={invalidProxy}
      pending={saveSource.isPending}
      scopeLabel={scopeLabel}
      onFormChange={onFormChange}
      onClose={onClose}
      onSubmit={() => saveSource.mutate()}
    />
  );
}

/** 订阅源分区：列表筛选分页与新增/编辑/同步/删除操作。 */
export function EgressSources({ scopeLabel }: { scopeLabel: (scope: EgressScope) => string }): ReactElement {
  const { t } = useTranslation();
  const [sourceEditing, setSourceEditing] = useState<EgressSourceDTO | null | undefined>(undefined);
  const [sourceForm, setSourceForm] = useState<EgressSourceForm>(emptyEgressSource);
  const filters = useEgressSourcesFilters();
  const sourcesQuery = useQuery({ queryKey: ["egress-sources"], queryFn: () => listEgressSources() });

  function openSource(value?: EgressSourceDTO) {
    setSourceForm(sourceFormFor(value));
    setSourceEditing(value ?? null);
  }

  return (
    <section className="space-y-3">
      <EgressSectionHeader title={t("settings.egress.subscriptions")} help={t("settings.egress.subscriptionsHelp")} />
      <EgressSourcesList
        query={sourcesQuery}
        sources={sourcesQuery.data?.items ?? []}
        filters={filters}
        scopeLabel={scopeLabel}
        onAdd={() => openSource()}
        onEdit={openSource}
      />

      <EgressSourceEditor
        editing={sourceEditing}
        form={sourceForm}
        scopeLabel={scopeLabel}
        onFormChange={(changes) => setSourceForm((current) => ({ ...current, ...changes }))}
        onClose={() => setSourceEditing(undefined)}
        onCreated={filters.resetPage}
      />
    </section>
  );
}
