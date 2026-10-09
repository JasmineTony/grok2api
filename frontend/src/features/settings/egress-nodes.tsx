import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { showEgressError } from "@/features/settings/egress-feedback";
import {
  EgressNodesBatchDeleteDialog,
  EgressNodesCleanupDialog,
} from "@/features/settings/egress-node-confirm-dialogs";
import { EgressImportDialog, EgressNodeDialog } from "@/features/settings/egress-node-dialogs";
import { emptyEgressImport, type EgressImportForm } from "@/features/settings/egress-import-form";
import { EgressNodesTable, type EgressNodeRowActions } from "@/features/settings/egress-nodes-table";
import { EgressNodesToolbar } from "@/features/settings/egress-nodes-toolbar";
import { EgressAutomation, EgressSources } from "@/features/settings/egress-operations";
import { EgressProxyProfiles } from "@/features/settings/egress-proxy-profiles";
import {
  cleanupUnhealthyEgressNodes,
  createEgressNode,
  deleteEgressNode,
  deleteEgressNodes,
  getEgressNodeProxyURL,
  importEgressText,
  listEgressNodes,
  previewUnhealthyEgressNodes,
  refreshEgressClearance,
  testEgressNode,
  updateEgressNode,
  updateEgressNodesEnabled,
  type ClearanceMode,
  type EgressNodeDTO,
  type EgressNodeInput,
  type EgressScope,
} from "@/features/settings/settings-api";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

const emptyInput: EgressNodeInput = {
  name: "",
  scope: "grok_build",
  enabled: true,
  proxyPool: false,
  accountCapacity: 0,
  proxyURL: "",
  userAgent: "",
  cloudflareCookies: "",
};

/**
 * 出口节点分区容器：持有查询、变更与表单状态，把工具栏、表格、弹窗、订阅源与自动化分区
 * 委托给各自模块；既有 data-testid、i18n key、查询 key 与取消语义保持不变。
 */
export function EgressNodes({ title, clearanceMode }: { title: string; clearanceMode: ClearanceMode }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<EgressNodeDTO | null | undefined>(undefined);
  const [proxyVisible, setProxyVisible] = useState(false);
  const [revealedProxyURL, setRevealedProxyURL] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importForm, setImportForm] = useState<EgressImportForm>(emptyEgressImport);
  const [form, setForm] = useState<EgressNodeInput>(emptyInput);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<TableSort>({ field: "", order: "asc" });
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [probeFilter, setProbeFilter] = useState("");
  const [assignmentFilter, setAssignmentFilter] = useState("");
  const [selected, setSelected] = useState<Map<string, EgressNodeDTO>>(() => new Map());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [profileLibraryOpen, setProfileLibraryOpen] = useState(false);
  const [profileLibraryCreate, setProfileLibraryCreate] = useState(false);
  const debouncedSearch = useDebouncedValue(search);
  const query = useQuery({
    queryKey: [
      "egress-nodes",
      "page",
      page,
      pageSize,
      debouncedSearch,
      scopeFilter,
      enabledFilter,
      probeFilter,
      assignmentFilter,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      listEgressNodes({
        page,
        pageSize,
        search: debouncedSearch,
        scope: scopeFilter as EgressScope | "",
        enabled: enabledFilter,
        probe: probeFilter,
        assignment: assignmentFilter,
        sortBy: sort.field || undefined,
        sortOrder: sort.field ? sort.order : undefined,
      }),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const resetSelection = () => setSelected(new Map());
  const invalidateNodes = () => {
    void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
    void queryClient.invalidateQueries({ queryKey: ["egress-proxy-profiles"] });
  };
  const save = useMutation({
    mutationFn: () => {
      const normalizedProxyURL = form.proxyURL?.trim() || "";
      const input = {
        ...form,
        proxyURL:
          normalizedProxyURL && (!editing || normalizedProxyURL !== revealedProxyURL) ? normalizedProxyURL : undefined,
        userAgent: form.scope === "grok_build" ? "" : form.userAgent,
        cloudflareCookies: form.scope === "grok_build" ? undefined : form.cloudflareCookies?.trim() || undefined,
      };
      return editing ? updateEgressNode(editing.id, input) : createEgressNode(input);
    },
    onSuccess: () => {
      invalidateNodes();
      setEditing(undefined);
      toast.success(t("settings.egress.saved"));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const revealProxy = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error(t("egressProxyProfiles.revealUnavailable"));
      return getEgressNodeProxyURL(editing.id);
    },
    onSuccess: ({ proxyURL }) => {
      setRevealedProxyURL(proxyURL);
      setProxyVisible(true);
      setForm((current) => ({ ...current, proxyURL }));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const importText = useMutation({
    mutationFn: () => importEgressText(importForm),
    onSuccess: (value) => {
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
      setImportOpen(false);
      toast.success(t("settings.egress.imported", value));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const remove = useMutation({
    mutationFn: deleteEgressNode,
    onSuccess: (_, id) => {
      if (page > 1 && query.data?.items.length === 1) setPage(page - 1);
      setSelected((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      });
      invalidateNodes();
      toast.success(t("settings.egress.deleted"));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const removeMany = useMutation({
    mutationFn: () => deleteEgressNodes([...selected.keys()]),
    onSuccess: (value) => {
      const selectedOnCurrentPage = query.data?.items.filter((node) => selected.has(node.id)).length ?? 0;
      if (page > 1 && query.data && query.data.items.length > 0 && selectedOnCurrentPage === query.data.items.length)
        setPage(page - 1);
      resetSelection();
      setBatchDeleteOpen(false);
      invalidateNodes();
      toast.success(t("settings.egress.batchDeleted", value));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const updateManyEnabled = useMutation({
    mutationFn: (enabled: boolean) => updateEgressNodesEnabled([...selected.keys()], enabled),
    onSuccess: (value, enabled) => {
      resetSelection();
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
      toast.success(t(enabled ? "settings.egress.batchEnabled" : "settings.egress.batchDisabled", value));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const cleanupPreview = useMutation({
    mutationFn: previewUnhealthyEgressNodes,
  });
  const cleanupUnhealthy = useMutation({
    mutationFn: cleanupUnhealthyEgressNodes,
    onSuccess: (value) => {
      setPage(1);
      resetSelection();
      setCleanupOpen(false);
      cleanupPreview.reset();
      invalidateNodes();
      toast.success(t("settings.egress.cleanupUnavailableComplete", value));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const refreshClearance = useMutation({
    mutationFn: (id: string) => refreshEgressClearance(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
      toast.success(t("settings.egress.clearanceRefreshed"));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
  });
  const testNode = useMutation({
    mutationFn: testEgressNode,
    onSuccess: (result) => {
      if (result.status === "healthy") toast.success(t("settings.egress.testedOne"));
      else showEgressError(result.error, t("settings.egress.operationFailed"));
    },
    onError: (error) => showEgressError(error, t("settings.egress.operationFailed")),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["egress-nodes"] });
    },
  });

  function openCreate() {
    setForm(emptyInput);
    setProxyVisible(false);
    setRevealedProxyURL("");
    setEditing(null);
  }

  function openCleanup() {
    cleanupPreview.reset();
    setCleanupOpen(true);
    cleanupPreview.mutate();
  }

  function openEdit(node: EgressNodeDTO) {
    setForm({
      name: node.name,
      scope: node.scope,
      enabled: node.enabled,
      proxyPool: node.proxyPool,
      accountCapacity: node.accountCapacity,
      proxyProfileId: node.proxyProfileId,
      userAgent: node.scope === "grok_build" ? "" : node.userAgent,
      proxyURL: "",
      cloudflareCookies: "",
    });
    setProxyVisible(false);
    setRevealedProxyURL("");
    setEditing(node);
  }

  function changeScope(scope: EgressScope) {
    const previousDefault = query.data?.defaultUserAgents[form.scope] ?? "";
    const nextDefault = query.data?.defaultUserAgents[scope] ?? "";
    setForm({
      ...form,
      scope,
      userAgent:
        scope === "grok_build"
          ? ""
          : form.userAgent === "" || form.userAgent === previousDefault
            ? nextDefault
            : form.userAgent,
      cloudflareCookies: scope === "grok_build" || scope === "grok_console_asset" ? "" : form.cloudflareCookies,
    });
  }

  function changeFilter(value: string, setter: (value: string) => void) {
    setter(value);
    setPage(1);
    resetSelection();
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  }

  function scopeLabel(scope: EgressScope) {
    if (scope === "grok_build") return t("settings.egress.scopeBuild");
    if (scope === "grok_console") return t("console.name");
    if (scope === "grok_web_asset") return t("settings.egress.scopeWebAsset");
    if (scope === "grok_console_asset") return t("settings.egress.scopeConsoleAsset");
    return t("settings.egress.scopeWeb");
  }

  function togglePage(checked: boolean): void {
    setSelected((current) => {
      const next = new Map(current);
      for (const node of nodes) {
        if (checked) next.set(node.id, node);
        else next.delete(node.id);
      }
      return next;
    });
  }

  function toggleNode(node: EgressNodeDTO, checked: boolean): void {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(node.id, node);
      else next.delete(node.id);
      return next;
    });
  }

  function chooseProxyProfile(value: string) {
    setProxyVisible(false);
    setRevealedProxyURL("");
    setForm((current) => ({
      ...current,
      proxyProfileId: value === "manual" ? (editing?.proxyProfileId ? "0" : undefined) : value,
      proxyURL: "",
    }));
  }

  const nodes = query.data?.items ?? [];
  const selectedOnPage = nodes.filter((node) => selected.has(node.id));
  const allPageSelected = nodes.length > 0 && selectedOnPage.length === nodes.length;
  const selectedNodes = [...selected.values()];
  const selectedAssignedAccounts = selectedNodes.reduce((total, node) => total + node.assignedAccountCount, 0);
  const selectedSourceNodes = selectedNodes.filter((node) => node.sourceId).length;
  const nodeActions: EgressNodeRowActions = {
    edit: openEdit,
    remove: (node) => remove.mutate(node.id),
    test: (node) => testNode.mutate(node.id),
    refreshClearance: (node) => refreshClearance.mutate(node.id),
    testPending: testNode.isPending,
    clearancePending: refreshClearance.isPending,
  };

  return (
    <div className="space-y-8">
      <EgressSources scopeLabel={scopeLabel} />

      <section className="space-y-3">
        <div className="flex min-h-8 items-center px-1">
          <h2 className="text-sm font-medium tracking-tight">{title}</h2>
        </div>
        <DataTableShell
          toolbar={
            <EgressNodesToolbar
              search={search}
              onSearchChange={(value) => changeFilter(value, setSearch)}
              scopeFilter={scopeFilter}
              onScopeFilterChange={(value) => changeFilter(value, setScopeFilter)}
              enabledFilter={enabledFilter}
              onEnabledFilterChange={(value) => changeFilter(value, setEnabledFilter)}
              probeFilter={probeFilter}
              onProbeFilterChange={(value) => changeFilter(value, setProbeFilter)}
              assignmentFilter={assignmentFilter}
              onAssignmentFilterChange={(value) => changeFilter(value, setAssignmentFilter)}
              scopeLabel={scopeLabel}
              selectedCount={selected.size}
              selectedNodes={selectedNodes}
              batchPending={removeMany.isPending || updateManyEnabled.isPending}
              refreshing={query.isFetching}
              cleanupPending={cleanupUnhealthy.isPending}
              onBatchEnable={() => updateManyEnabled.mutate(true)}
              onBatchDisable={() => updateManyEnabled.mutate(false)}
              onBatchDelete={() => setBatchDeleteOpen(true)}
              onOpenProfileLibrary={() => {
                setProfileLibraryCreate(false);
                setProfileLibraryOpen(true);
              }}
              onRefresh={() => void query.refetch()}
              onCleanup={openCleanup}
              onCreate={openCreate}
              onImport={() => {
                setImportForm(emptyEgressImport);
                setImportOpen(true);
              }}
            />
          }
          footer={
            query.data && query.data.total > 0 ? (
              <Pagination
                page={query.data.page}
                pageSize={query.data.pageSize}
                total={query.data.total}
                onPageChange={setPage}
                onPageSizeChange={(value) => {
                  setPageSize(value);
                  setPage(1);
                }}
              />
            ) : undefined
          }
        >
          <EgressNodesTable
            query={query}
            nodes={nodes}
            selected={selected}
            allPageSelected={allPageSelected}
            selectedOnPage={selectedOnPage}
            hasActiveFilters={Boolean(
              debouncedSearch || scopeFilter || enabledFilter || probeFilter || assignmentFilter,
            )}
            sort={sort}
            clearanceMode={clearanceMode}
            scopeLabel={scopeLabel}
            actions={nodeActions}
            onSort={changeSort}
            onTogglePage={togglePage}
            onToggleNode={toggleNode}
          />
        </DataTableShell>
      </section>

      <EgressAutomation scopeLabel={scopeLabel} />

      <EgressNodesBatchDeleteDialog
        open={batchDeleteOpen}
        selectedCount={selected.size}
        assignedAccounts={selectedAssignedAccounts}
        sourceNodes={selectedSourceNodes}
        pending={removeMany.isPending}
        onOpenChange={setBatchDeleteOpen}
        onConfirm={() => removeMany.mutate()}
      />

      <EgressNodesCleanupDialog
        open={cleanupOpen}
        preview={cleanupPreview}
        pending={cleanupUnhealthy.isPending}
        onOpenChange={(open) => {
          if (!open && cleanupUnhealthy.isPending) return;
          if (!open) cleanupPreview.reset();
          setCleanupOpen(open);
        }}
        onConfirm={() => cleanupUnhealthy.mutate()}
      />

      <EgressNodeDialog
        open={editing !== undefined}
        editing={editing}
        form={form}
        clearanceMode={clearanceMode}
        proxyVisible={proxyVisible}
        revealPending={revealProxy.isPending}
        savePending={save.isPending}
        scopeLabel={scopeLabel}
        onFormChange={(changes) => setForm((current) => ({ ...current, ...changes }))}
        onScopeChange={changeScope}
        onProfileChange={chooseProxyProfile}
        onOpenProfileLibrary={() => {
          setProfileLibraryCreate(true);
          setProfileLibraryOpen(true);
        }}
        onToggleProxyVisible={() => {
          if (revealedProxyURL) setProxyVisible((visible) => !visible);
          else revealProxy.mutate();
        }}
        onClose={() => setEditing(undefined)}
        onSubmit={() => save.mutate()}
      />

      <EgressImportDialog
        open={importOpen}
        form={importForm}
        pending={importText.isPending}
        scopeLabel={scopeLabel}
        onFormChange={(changes) => setImportForm((current) => ({ ...current, ...changes }))}
        onClose={() => setImportOpen(false)}
        onSubmit={() => importText.mutate()}
      />

      {profileLibraryOpen ? (
        <EgressProxyProfiles
          key={profileLibraryCreate ? "create" : "manage"}
          open={profileLibraryOpen}
          startCreating={profileLibraryCreate}
          onOpenChange={(open) => {
            setProfileLibraryOpen(open);
            if (!open) setProfileLibraryCreate(false);
          }}
          onCreated={(profile) => {
            if (!profileLibraryCreate || editing === undefined) return;
            setProxyVisible(false);
            setRevealedProxyURL("");
            setForm((current) => ({ ...current, proxyProfileId: profile.id, proxyURL: "" }));
            setProfileLibraryOpen(false);
            setProfileLibraryCreate(false);
          }}
        />
      ) : null}
    </div>
  );
}
