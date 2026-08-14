import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EgressAutomationPanel } from "@/features/settings/egress-automation-panel";
import {
  emptyImport,
  emptySource,
  fallbackNodeCandidates,
  type ImportForm,
  type OperationsForm,
  operationsFormFrom,
  operationsInputFrom,
  type SourceForm,
  testAllEgressNodes,
} from "@/features/settings/egress-operations-model";
import {
  ActionTooltip,
  OperationSectionHeader,
  SourceError,
} from "@/features/settings/egress-operations-ui";
import { EgressImportDialog, EgressSourceDialog } from "@/features/settings/egress-source-dialogs";
import {
  createEgressSource,
  deleteEgressSource,
  type EgressFallbackConfigDTO,
  type EgressFallbackMode,
  type EgressScope,
  type EgressSourceDTO,
  type EgressSourceInput,
  getEgressOperationsConfig,
  importEgressText,
  listEgressNodes,
  listEgressSources,
  rebalanceEgressAccounts,
  syncEgressSource,
  updateEgressOperationsConfig,
  updateEgressSource,
} from "@/features/settings/settings-api";
import { validSubscriptionProxyURL } from "@/features/settings/settings-model";
import { useApiClient } from "@/shared/api/use-api-client";
import { ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { formatDateTime } from "@/shared/lib/format";

export function EgressOperations({ scopeLabel }: { scopeLabel: (scope: EgressScope) => string }) {
  const { t, i18n } = useTranslation();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [sourceEditing, setSourceEditing] = useState<EgressSourceDTO | null | undefined>(undefined);
  const [sourceForm, setSourceForm] = useState<SourceForm>(emptySource);
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState<ImportForm>(emptyImport);
  const [operationsDraft, setOperationsDraft] = useState<OperationsForm | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ["egress-sources"],
    queryFn: () => listEgressSources(apiClient),
  });
  const operationsQuery = useQuery({
    queryKey: ["egress-operations"],
    queryFn: () => getEgressOperationsConfig(apiClient),
  });
  const nodesQuery = useQuery({
    queryKey: ["egress-nodes", "fallback-options"],
    queryFn: () => listEgressNodes(apiClient),
  });
  const operationsForm = operationsDraft ?? operationsFormFrom(operationsQuery.data);
  const sourceProxyError =
    sourceForm.proxyURL.trim() && !validSubscriptionProxyURL(sourceForm.proxyURL)
      ? t("settings.egress.invalidProxy")
      : "";

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
    void queryClient.invalidateQueries({ queryKey: ["egress-sources"] });
    void queryClient.invalidateQueries({ queryKey: ["egress-operations"] });
  };
  const saveSource = useMutation({
    mutationFn: () => {
      const trimmedURL = sourceForm.url.trim();
      const trimmedProxyURL = sourceForm.proxyURL.trim();
      const input: EgressSourceInput = {
        name: sourceForm.name.trim(),
        scope: sourceForm.scope,
        enabled: sourceForm.enabled,
        refreshIntervalSeconds: sourceForm.refreshIntervalSeconds,
        defaultAccountCapacity: sourceForm.defaultAccountCapacity,
        ...(trimmedURL ? { url: trimmedURL } : {}),
        ...(sourceForm.clearUrl ? { clearUrl: true } : {}),
        ...(trimmedProxyURL ? { proxyURL: trimmedProxyURL } : {}),
        ...(sourceForm.clearProxyURL ? { clearProxyURL: true } : {}),
      };
      return sourceEditing
        ? updateEgressSource(apiClient, sourceEditing.id, input)
        : createEgressSource(apiClient, input);
    },
    onSuccess: () => {
      invalidate();
      setSourceEditing(undefined);
      toast.success(t("settings.egress.sourceSaved"));
    },
    onError: showError,
  });
  const removeSource = useMutation({
    mutationFn: (id: string) => deleteEgressSource(apiClient, id),
    onSuccess: () => {
      invalidate();
      toast.success(t("settings.egress.sourceDeleted"));
    },
    onError: showError,
  });
  const syncSource = useMutation({
    mutationFn: (id: string) => syncEgressSource(apiClient, id),
    onSuccess: (value) => {
      invalidate();
      toast.success(t("settings.egress.sourceSynced", value));
    },
    onError: showError,
  });
  const importText = useMutation({
    mutationFn: () => importEgressText(apiClient, importForm),
    onSuccess: (value) => {
      invalidate();
      setImportOpen(false);
      toast.success(t("settings.egress.imported", value));
    },
    onError: showError,
  });
  const testAll = useMutation({
    mutationFn: () => testAllEgressNodes(apiClient),
    onSuccess: (value) => {
      invalidate();
      toast.success(t("settings.egress.tested", value));
    },
    onError: showError,
  });
  const rebalance = useMutation({
    mutationFn: () => rebalanceEgressAccounts(apiClient),
    onSuccess: (value) => {
      invalidate();
      toast.success(t("settings.egress.rebalanced", value));
    },
    onError: showError,
  });
  const saveOperations = useMutation({
    mutationFn: () => updateEgressOperationsConfig(apiClient, operationsInputFrom(operationsForm)),
    onSuccess: () => {
      setOperationsDraft(null);
      invalidate();
      toast.success(t("settings.egress.automationSaved"));
    },
    onError: showError,
  });

  const openSource = (value?: EgressSourceDTO) => {
    if (!value) {
      setSourceForm(emptySource);
      setSourceEditing(null);
      return;
    }
    setSourceForm({
      name: value.name,
      scope: value.scope,
      enabled: value.enabled,
      url: "",
      clearUrl: false,
      proxyURL: "",
      clearProxyURL: false,
      refreshIntervalSeconds: value.refreshIntervalSeconds,
      defaultAccountCapacity: value.defaultAccountCapacity,
    });
    setSourceEditing(value);
  };
  const setFallback = (scope: EgressScope, fallback: EgressFallbackConfigDTO) => {
    setOperationsDraft({
      ...operationsForm,
      fallbacks: { ...operationsForm.fallbacks, [scope]: fallback },
    });
  };
  const setFallbackMode = (scope: EgressScope, mode: EgressFallbackMode) => {
    const candidates = fallbackNodeCandidates(nodesQuery.data?.items ?? [], scope);
    const current = operationsForm.fallbacks[scope];
    const currentCandidate = candidates.find((node) => node.id === current.nodeId);
    const nodeId = currentCandidate?.id ?? candidates[0]?.id;
    setFallback(scope, { mode, ...(mode === "fixed" && nodeId ? { nodeId } : {}) });
  };

  return (
    <section className="space-y-8">
      <EgressAutomationPanel
        form={operationsForm}
        nodes={nodesQuery.data?.items ?? []}
        scopeLabel={scopeLabel}
        loading={operationsQuery.isPending}
        error={operationsQuery.isError ? operationsQuery.error : null}
        dirty={operationsDraft !== null}
        saving={saveOperations.isPending}
        testing={testAll.isPending}
        rebalancing={rebalance.isPending}
        onRetry={() => void operationsQuery.refetch()}
        onChange={setOperationsDraft}
        onFallbackChange={setFallback}
        onFallbackModeChange={setFallbackMode}
        onSave={() => saveOperations.mutate()}
        onTestAll={() => testAll.mutate()}
        onRebalance={() => rebalance.mutate()}
      />

      <EgressSourcesPanel
        sources={sourcesQuery.data?.items ?? []}
        loading={sourcesQuery.isPending}
        error={sourcesQuery.isError ? sourcesQuery.error : null}
        locale={i18n.language}
        syncPending={syncSource.isPending}
        removePending={removeSource.isPending}
        scopeLabel={scopeLabel}
        onRetry={() => void sourcesQuery.refetch()}
        onImport={() => {
          setImportForm(emptyImport);
          setImportOpen(true);
        }}
        onCreate={() => openSource()}
        onSync={(id) => syncSource.mutate(id)}
        onEdit={openSource}
        onDelete={(id) => removeSource.mutate(id)}
      />

      <EgressSourceDialog
        editing={sourceEditing}
        form={sourceForm}
        pending={saveSource.isPending}
        proxyError={sourceProxyError}
        scopeLabel={scopeLabel}
        onClose={() => setSourceEditing(undefined)}
        onChange={setSourceForm}
        onSubmit={() => saveSource.mutate()}
      />
      <EgressImportDialog
        open={importOpen}
        form={importForm}
        pending={importText.isPending}
        scopeLabel={scopeLabel}
        onOpenChange={setImportOpen}
        onChange={setImportForm}
        onSubmit={() => importText.mutate()}
      />
    </section>
  );
}

type EgressSourcesPanelProps = {
  sources: EgressSourceDTO[];
  loading: boolean;
  error: Error | null;
  locale: string;
  syncPending: boolean;
  removePending: boolean;
  scopeLabel: (scope: EgressScope) => string;
  onRetry: () => void;
  onImport: () => void;
  onCreate: () => void;
  onSync: (id: string) => void;
  onEdit: (source: EgressSourceDTO) => void;
  onDelete: (id: string) => void;
};

function EgressSourcesPanel({
  sources,
  loading,
  error,
  locale,
  syncPending,
  removePending,
  scopeLabel,
  onRetry,
  onImport,
  onCreate,
  onSync,
  onEdit,
  onDelete,
}: EgressSourcesPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <OperationSectionHeader
        title={t("settings.egress.subscriptions")}
        help={t("settings.egress.subscriptionsHelp")}
      >
        <ActionTooltip label={t("settings.egress.importTextHelp")}>
          <Button type="button" size="sm" variant="secondary" onClick={onImport}>
            <Upload />
            {t("settings.egress.importText")}
          </Button>
        </ActionTooltip>
        <ActionTooltip label={t("settings.egress.addSourceHelp")}>
          <Button type="button" size="sm" variant="secondary" onClick={onCreate}>
            <Plus />
            {t("settings.egress.addSource")}
          </Button>
        </ActionTooltip>
      </OperationSectionHeader>
      {error ? (
        <ErrorState message={error.message} onRetry={onRetry} />
      ) : (
        <div className="overflow-hidden rounded-md border">
          <Table className="min-w-0">
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-40">{t("settings.egress.source")}</TableHead>
                <TableHead className="w-32 text-center">{t("settings.egress.scope")}</TableHead>
                <TableHead className="min-w-40">{t("settings.egress.lastSync")}</TableHead>
                <TableHead className="w-28 text-center">{t("settings.egress.capacity")}</TableHead>
                <TableActionHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? <TableLoadingRow colSpan={5} /> : null}
              {!loading && sources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-xs text-muted-foreground">
                    {t("settings.egress.noSources")}
                  </TableCell>
                </TableRow>
              ) : null}
              {sources.map((source) => (
                <EgressSourceRow
                  key={source.id}
                  source={source}
                  locale={locale}
                  syncPending={syncPending}
                  removePending={removePending}
                  scopeLabel={scopeLabel}
                  onSync={onSync}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function EgressSourceRow({
  source,
  locale,
  syncPending,
  removePending,
  scopeLabel,
  onSync,
  onEdit,
  onDelete,
}: {
  source: EgressSourceDTO;
  locale: string;
  syncPending: boolean;
  removePending: boolean;
  scopeLabel: (scope: EgressScope) => string;
  onSync: (id: string) => void;
  onEdit: (source: EgressSourceDTO) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableRow className="group h-12">
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={
              source.enabled
                ? "size-1.5 shrink-0 rounded-full bg-emerald-500"
                : "size-1.5 shrink-0 rounded-full bg-muted-foreground/35"
            }
          />
          <span className="min-w-0 break-words text-xs font-medium">{source.name}</span>
          {source.proxyConfigured ? (
            <Badge variant="outline" className="text-[10px]">
              {t("settings.egress.proxy")}
            </Badge>
          ) : null}
          {source.lastSyncError ? <SourceError message={source.lastSyncError} /> : null}
        </div>
      </TableCell>
      <TableCell className="text-center">
        <Badge variant="secondary" className="text-[10px]">
          {scopeLabel(source.scope)}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        <div className="space-y-0.5">
          <div>
            {t("settings.egress.lastSync")}:{" "}
            {source.lastSyncedAt
              ? formatDateTime(source.lastSyncedAt, locale)
              : t("settings.egress.never")}
          </div>
          <div>
            {t("settings.egress.nextSync")}:{" "}
            {source.nextSyncAt
              ? formatDateTime(source.nextSyncAt, locale)
              : t("settings.egress.notScheduled")}
          </div>
          <div>{t("settings.egress.lastSyncImported", { count: source.lastSyncImported })}</div>
        </div>
      </TableCell>
      <TableCell className="text-center text-xs tabular-nums">
        {source.defaultAccountCapacity || t("settings.egress.unlimited")}
      </TableCell>
      <TableActionCell>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={t("common.actions")}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={syncPending} onClick={() => onSync(source.id)}>
              <RefreshCw />
              {t("settings.egress.sync")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onEdit(source)}>
              <Pencil />
              {t("common.edit")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={removePending}
              onClick={() => onDelete(source.id)}
            >
              <Trash2 />
              {t("common.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableActionCell>
    </TableRow>
  );
}

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : "Operation failed");
}
