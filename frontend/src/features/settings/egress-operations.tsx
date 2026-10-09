import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network, Shuffle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EgressAutomationSettings, type EgressOperationsForm } from "@/features/settings/egress-automation-settings";
import { fallbackNodeCandidates } from "@/features/settings/egress-fallback";
import { showEgressError } from "@/features/settings/egress-feedback";
import { EgressActionTooltip, EgressSectionHeader } from "@/features/settings/egress-section-header";
import { EgressSourceDialog } from "@/features/settings/egress-source-dialog";
import { emptyEgressSource, type EgressSourceForm } from "@/features/settings/egress-source-form";
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
  type EgressFallbackConfigDTO,
  type EgressFallbackMode,
  type EgressOperationsConfigDTO,
  type EgressScope,
  type EgressSourceDTO,
  type EgressSourceInput,
} from "@/features/settings/settings-api";
import { validSubscriptionProxyURL } from "@/features/settings/settings-model";
import { ErrorState, LoadingState } from "@/shared/components/data-state";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";

// Eight nodes run concurrently; each checks IPv4 and IPv6 in parallel with a
// 15-second ceiling. Keeping a request to 32 nodes leaves enough headroom for
// the admin HTTP timeout.
const egressProbeBatchSize = 32;

function defaultFallbacks(): Record<EgressScope, EgressFallbackConfigDTO> {
  return {
    grok_build: { mode: "none" },
    grok_web: { mode: "none" },
    grok_console: { mode: "none" },
    grok_web_asset: { mode: "none" },
    grok_console_asset: { mode: "none" },
  };
}

const defaultOperationsForm: EgressOperationsForm = {
  probeProvider: "cloudflare",
  probeIntervalSeconds: 900,
  autoAssignEnabled: false,
  autoBalanceEnabled: false,
  assignmentIntervalSeconds: 300,
  fallbacks: defaultFallbacks(),
};

function operationsFormFrom(value?: EgressOperationsConfigDTO): EgressOperationsForm {
  if (!value) return { ...defaultOperationsForm, fallbacks: defaultFallbacks() };

  const defaults = defaultFallbacks();
  return {
    probeProvider: value.probeProvider,
    probeIntervalSeconds: value.probeIntervalSeconds,
    autoAssignEnabled: value.autoAssignEnabled,
    autoBalanceEnabled: value.autoBalanceEnabled,
    assignmentIntervalSeconds: value.assignmentIntervalSeconds,
    fallbacks: {
      grok_build: { ...defaults.grok_build, ...value.fallbacks.grok_build },
      grok_web: { ...defaults.grok_web, ...value.fallbacks.grok_web },
      grok_console: { ...defaults.grok_console, ...value.fallbacks.grok_console },
      grok_web_asset: { ...defaults.grok_web_asset, ...value.fallbacks.grok_web_asset },
      grok_console_asset: { ...defaults.grok_console_asset, ...value.fallbacks.grok_console_asset },
    },
  };
}

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

/** 出口自动化分区：探测/分配参数、兜底策略与全量探测、重平衡操作。 */
export function EgressAutomation({ scopeLabel }: { scopeLabel: (scope: EgressScope) => string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [operationsDraft, setOperationsDraft] = useState<EgressOperationsForm | null>(null);
  const operationsQuery = useQuery({ queryKey: ["egress-operations"], queryFn: getEgressOperationsConfig });
  const nodesQuery = useQuery({ queryKey: ["egress-nodes", "fallback-options"], queryFn: () => listAllEgressNodes() });
  const operationsForm = operationsDraft ?? operationsFormFrom(operationsQuery.data);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
    void queryClient.invalidateQueries({ queryKey: ["egress-operations"] });
  };
  const testAll = useMutation({
    mutationFn: testAllEgressNodes,
    onSuccess: (value) => {
      if (value.failed > 0) toast.warning(t("settings.egress.testedPartial", value));
      else toast.success(t("settings.egress.tested", value));
    },
    onError: (error) => showEgressError(error),
    onSettled: invalidate,
  });
  const rebalance = useMutation({
    mutationFn: rebalanceEgressAccounts,
    onSuccess: (value) => {
      invalidate();
      toast.success(t("settings.egress.rebalanced", value));
    },
    onError: (error) => showEgressError(error),
  });
  const saveOperations = useMutation({
    mutationFn: () => updateEgressOperationsConfig(operationsForm),
    onSuccess: () => {
      setOperationsDraft(null);
      invalidate();
      toast.success(t("settings.egress.automationSaved"));
    },
    onError: (error) => showEgressError(error),
  });

  function setFallback(scope: EgressScope, fallback: EgressFallbackConfigDTO) {
    setOperationsDraft({ ...operationsForm, fallbacks: { ...operationsForm.fallbacks, [scope]: fallback } });
  }

  function setFallbackMode(scope: EgressScope, mode: EgressFallbackMode) {
    const candidates = fallbackNodeCandidates(nodesQuery.data?.items ?? [], scope);
    const current = operationsForm.fallbacks[scope];
    const currentCandidate = candidates.find((node) => node.id === current.nodeId);
    setFallback(scope, {
      mode,
      nodeId: mode === "fixed" ? (currentCandidate?.id ?? candidates[0]?.id) : undefined,
    });
  }

  return (
    <section className="space-y-8" data-testid="egress-automation">
      <div className="space-y-3">
        <EgressSectionHeader title={t("settings.egress.automation")} help={t("settings.egress.automationHelp")}>
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
          <EgressActionTooltip label={t("settings.egress.saveAutomationHelp")}>
            <Button
              type="button"
              size="sm"
              disabled={operationsDraft === null || saveOperations.isPending}
              onClick={() => saveOperations.mutate()}
              data-testid="egress-automation-save"
            >
              {saveOperations.isPending ? <Spinner /> : null}
              {t("common.save")}
            </Button>
          </EgressActionTooltip>
        </EgressSectionHeader>

        {operationsQuery.isError ? (
          <ErrorState message={operationsQuery.error.message} onRetry={() => void operationsQuery.refetch()} />
        ) : operationsQuery.isPending ? (
          <LoadingState />
        ) : (
          <EgressAutomationSettings
            form={operationsForm}
            nodes={nodesQuery.data?.items ?? []}
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

/** 订阅源分区：列表筛选分页与新增/编辑/同步/删除操作。 */
export function EgressSources({ scopeLabel }: { scopeLabel: (scope: EgressScope) => string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [sourceEditing, setSourceEditing] = useState<EgressSourceDTO | null | undefined>(undefined);
  const [sourceForm, setSourceForm] = useState<EgressSourceForm>(emptyEgressSource);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const sourcesQuery = useQuery({ queryKey: ["egress-sources"], queryFn: () => listEgressSources() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
    void queryClient.invalidateQueries({ queryKey: ["egress-sources"] });
  };
  const saveSource = useMutation({
    mutationFn: () => {
      const input: EgressSourceInput = {
        name: sourceForm.name,
        scope: sourceForm.scope,
        enabled: sourceForm.enabled,
        url: sourceForm.url.trim() || undefined,
        proxyURL: sourceForm.proxyEnabled ? sourceForm.proxyURL.trim() || undefined : undefined,
        clearProxyURL: Boolean(sourceEditing?.proxyConfigured && !sourceForm.proxyEnabled),
        refreshIntervalSeconds: sourceForm.refreshIntervalSeconds,
        defaultAccountCapacity: sourceForm.defaultAccountCapacity,
      };
      return sourceEditing ? updateEgressSource(sourceEditing.id, input) : createEgressSource(input);
    },
    onSuccess: () => {
      if (!sourceEditing) setPage(1);
      invalidate();
      setSourceEditing(undefined);
      toast.success(t("settings.egress.sourceSaved"));
    },
    onError: (error) => showEgressError(error),
  });
  const removeSource = useMutation({
    mutationFn: deleteEgressSource,
    onSuccess: () => {
      if (page > 1 && pagedSources.length === 1) setPage(page - 1);
      invalidate();
      toast.success(t("settings.egress.sourceDeleted"));
    },
    onError: (error) => showEgressError(error),
  });
  const syncSource = useMutation({
    mutationFn: syncEgressSource,
    onSuccess: (value) => {
      invalidate();
      toast.success(t("settings.egress.sourceSynced", value));
    },
    onError: (error) => showEgressError(error),
  });

  function openSource(value?: EgressSourceDTO) {
    if (!value) {
      setSourceForm(emptyEgressSource);
      setSourceEditing(null);
      return;
    }
    setSourceForm({
      name: value.name,
      scope: value.scope,
      enabled: value.enabled,
      url: "",
      refreshIntervalSeconds: value.refreshIntervalSeconds,
      proxyEnabled: value.proxyConfigured,
      proxyURL: "",
      defaultAccountCapacity: value.defaultAccountCapacity,
    });
    setSourceEditing(value);
  }

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const sources = sourcesQuery.data?.items ?? [];
  const filteredSources = sources.filter((source) => {
    if (normalizedSearch && !source.name.toLocaleLowerCase().includes(normalizedSearch)) return false;
    return !scopeFilter || source.scope === scopeFilter;
  });
  const pageCount = Math.max(1, Math.ceil(filteredSources.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedSources = filteredSources.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const hasActiveFilters = Boolean(normalizedSearch || scopeFilter);
  const sourceProxyInvalid =
    sourceForm.proxyEnabled && Boolean(sourceForm.proxyURL.trim()) && !validSubscriptionProxyURL(sourceForm.proxyURL);

  return (
    <section className="space-y-3">
      <EgressSectionHeader title={t("settings.egress.subscriptions")} help={t("settings.egress.subscriptionsHelp")} />
      <DataTableShell
        toolbar={
          <EgressSourcesToolbar
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            scopeFilter={scopeFilter}
            onScopeFilterChange={(value) => {
              setScopeFilter(value);
              setPage(1);
            }}
            scopeLabel={scopeLabel}
            onAdd={() => openSource()}
          />
        }
        footer={
          filteredSources.length > 0 ? (
            <Pagination
              page={currentPage}
              pageSize={pageSize}
              total={filteredSources.length}
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
            />
          ) : undefined
        }
      >
        <EgressSourcesTable
          query={sourcesQuery}
          sources={pagedSources}
          scopeLabel={scopeLabel}
          hasActiveFilters={hasActiveFilters}
          syncPending={syncSource.isPending}
          removePending={removeSource.isPending}
          onSync={(source) => syncSource.mutate(source.id)}
          onEdit={(source) => openSource(source)}
          onDelete={(source) => removeSource.mutate(source.id)}
        />
      </DataTableShell>

      <EgressSourceDialog
        editing={sourceEditing}
        form={sourceForm}
        invalidProxy={sourceProxyInvalid}
        pending={saveSource.isPending}
        scopeLabel={scopeLabel}
        onFormChange={(changes) => setSourceForm((current) => ({ ...current, ...changes }))}
        onClose={() => setSourceEditing(undefined)}
        onSubmit={() => saveSource.mutate()}
      />
    </section>
  );
}
