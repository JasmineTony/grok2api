import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  createModel,
  deleteModel,
  deleteModels,
  listModelAccountOptions,
  listModelGroups,
  syncModels,
  updateModel,
  updateModelsEnabled,
} from "@/entities/model/model-api";
import type { ModelRouteDTO } from "@/entities/model/types";
import { ModelDeleteDialogs } from "@/features/models/model-delete-dialogs";
import { ModelEditorDialog } from "@/features/models/model-editor-dialog";
import { createModelSchema, type ModelForm } from "@/features/models/model-form";
import { type ModelRouteGroup, newModelRouteGroup } from "@/features/models/model-group-utils";
import { ModelsTable } from "@/features/models/models-table";
import { useApiClient } from "@/shared/api/use-api-client";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

export function ModelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [providerFilter, setProviderFilter] = useState<ModelRouteDTO["provider"] | "">("");
  const [sort, setSort] = useState<TableSort>({ field: "", order: "asc" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<ModelRouteDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<ModelRouteGroup | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const schema = useMemo(() => createModelSchema(t), [t]);
  const form = useForm<ModelForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      publicId: "",
      provider: "grok_build",
      upstreamModel: "",
      capability: "responses",
      enabled: true,
      bindingMode: false,
      accountIds: [],
    },
  });
  const modelEnabled = useWatch({ control: form.control, name: "enabled" });
  const selectedProvider = useWatch({ control: form.control, name: "provider" });
  const selectedCapability = useWatch({ control: form.control, name: "capability" });
  const bindingMode = useWatch({ control: form.control, name: "bindingMode" });
  const selectedAccountIDs = useWatch({ control: form.control, name: "accountIds" });

  const modelsQuery = useQuery({
    queryKey: [
      "models",
      "grouped",
      page,
      pageSize,
      debouncedSearch,
      statusFilter,
      providerFilter,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      listModelGroups(apiClient, {
        page,
        pageSize,
        search: debouncedSearch,
        status: statusFilter,
        provider: providerFilter,
        ...(sort.field ? { sortBy: sort.field, sortOrder: sort.order } : {}),
      }),
  });

  const accountOptionsQuery = useQuery({
    queryKey: ["models", "account-options", selectedProvider],
    queryFn: () => listModelAccountOptions(apiClient, selectedProvider),
    enabled: editing !== null,
  });

  const updateMutation = useMutation({
    mutationFn: (values: ModelForm) => {
      if (!editing) throw new Error(t("errors.generic"));
      const input = { ...values, accountIds: values.bindingMode ? values.accountIds : [] };
      if (editing === "new") return createModel(apiClient, input);
      return updateModel(apiClient, editing.id, {
        publicId: input.publicId,
        enabled: input.enabled,
        accountIds: input.accountIds,
      });
    },
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      setEditing(null);
      toast.success(t(editing === "new" ? "models.created" : "models.updated"));
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: async (routes: ModelRouteDTO[]) => {
      if (routes.length === 1) {
        const route = routes[0];
        if (!route) throw new Error(t("errors.generic"));
        await deleteModel(apiClient, route.id);
      } else
        await deleteModels(
          apiClient,
          routes.map((route) => route.id),
        );
    },
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      setDeleting(null);
      setPage(1);
      toast.success(t("models.deleted"));
    },
    onError: showError,
  });

  const batchDeleteMutation = useMutation({
    mutationFn: () => deleteModels(apiClient, [...selected]),
    onSuccess: (result) => {
      setSelected(new Set());
      setBatchDeleteOpen(false);
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success(t("models.batchDeleted", { count: result.deleted }));
    },
    onError: showError,
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (enabled: boolean) => updateModelsEnabled(apiClient, [...selected], enabled),
    onSuccess: () => {
      setSelected(new Set());
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success(t("models.batchUpdated"));
    },
    onError: showError,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncModels(apiClient),
    onSuccess: (result) => {
      setSelected(new Set());
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success(t("models.synced", { count: result.synced }));
    },
    onError: showError,
  });

  function showError(error: unknown): void {
    toast.error(error instanceof Error ? error.message : t("errors.generic"));
  }

  function beginEdit(model: ModelRouteDTO): void {
    setEditing(model);
    setAccountSearch("");
    form.reset({
      publicId: model.publicId,
      provider: model.provider,
      upstreamModel: model.upstreamModel,
      capability: model.capability,
      enabled: model.enabled,
      bindingMode: model.bindingMode,
      accountIds: model.accountIds,
    });
  }

  function beginCreate(): void {
    setEditing("new");
    setAccountSearch("");
    form.reset({
      publicId: "",
      provider: "grok_build",
      upstreamModel: "",
      capability: "responses",
      enabled: true,
      bindingMode: false,
      accountIds: [],
    });
  }

  function toggleBoundAccount(id: string, checked: boolean): void {
    const current = form.getValues("accountIds");
    form.setValue(
      "accountIds",
      checked ? [...new Set([...current, id])] : current.filter((value) => value !== id),
      { shouldValidate: true },
    );
  }

  const accountOptions = accountOptionsQuery.data?.items ?? [];
  const normalizedAccountSearch = accountSearch.trim().toLocaleLowerCase();
  const visibleAccountOptions = normalizedAccountSearch
    ? accountOptions.filter(
        (account) =>
          account.name.toLocaleLowerCase().includes(normalizedAccountSearch) ||
          account.id.includes(normalizedAccountSearch),
      )
    : accountOptions;

  const result = useMemo(
    () =>
      modelsQuery.data
        ? {
            ...modelsQuery.data,
            items: modelsQuery.data.items.map((group) => newModelRouteGroup(group, t)),
          }
        : undefined,
    [modelsQuery.data, t],
  );
  const pageIDs = result?.items.flatMap((group) => group.routes.map((route) => route.id)) ?? [];
  const selectedOnPage = pageIDs.filter((id) => selected.has(id));
  const allPageSelected = pageIDs.length > 0 && selectedOnPage.length === pageIDs.length;
  const selectedGroupCount =
    result?.items.filter((group) => group.routes.some((route) => selected.has(route.id))).length ??
    0;

  function togglePage(checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIDs) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleModelGroup(routes: ModelRouteDTO[], checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const route of routes) {
        if (checked) next.add(route.id);
        else next.delete(route.id);
      }
      return next;
    });
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
    setSelected(new Set());
  }

  return (
    <div className="space-y-5">
      <header className="flex min-h-8 items-center">
        <h1 className="text-xl font-medium">{t("models.title")}</h1>
        <p className="sr-only">{t("models.description")}</p>
      </header>

      <DataTableShell
        toolbar={
          <>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-9 text-xs"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                    setSelected(new Set());
                  }}
                  placeholder={t("models.search")}
                  aria-label={t("models.search")}
                />
              </div>
              <DataTableFilters
                filters={[
                  {
                    id: "provider",
                    label: t("models.provider"),
                    value: providerFilter,
                    onChange: (value) => {
                      setProviderFilter(value as ModelRouteDTO["provider"] | "");
                      setPage(1);
                      setSelected(new Set());
                    },
                    options: [
                      { value: "grok_build", label: t("models.providerGrokBuild") },
                      { value: "grok_web", label: t("models.providerGrokWeb") },
                      { value: "grok_console", label: t("console.name") },
                    ],
                  },
                  {
                    id: "status",
                    label: t("models.status"),
                    value: statusFilter,
                    onChange: (value) => {
                      setStatusFilter(value);
                      setPage(1);
                      setSelected(new Set());
                    },
                    options: [
                      { value: "enabled", label: t("common.enabled") },
                      { value: "disabled", label: t("common.disabled") },
                    ],
                  },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {selected.size > 0 ? (
                <>
                  <span className="mr-1 text-xs text-muted-foreground">
                    {t("common.selectedCount", { count: selectedGroupCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchUpdateMutation.mutate(true)}
                  >
                    {t("common.enable")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchUpdateMutation.mutate(false)}
                  >
                    {t("common.disable")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setBatchDeleteOpen(true)}
                  >
                    {t("common.delete")}
                  </Button>
                </>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                disabled={syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
              >
                {syncMutation.isPending ? <Spinner /> : <RefreshCw />}
                {t("models.sync")}
              </Button>
              <Button size="sm" onClick={beginCreate}>
                <Plus />
                {t("models.create")}
              </Button>
            </div>
          </>
        }
        footer={
          result && result.total > 0 ? (
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              onPageChange={(value) => {
                setPage(value);
                setSelected(new Set());
              }}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
                setSelected(new Set());
              }}
            />
          ) : undefined
        }
      >
        <ModelsTable
          items={result?.items ?? []}
          isPending={modelsQuery.isPending}
          isError={modelsQuery.isError}
          errorMessage={modelsQuery.error?.message ?? t("errors.generic")}
          selected={selected}
          allPageSelected={allPageSelected}
          selectedOnPageCount={selectedOnPage.length}
          sort={sort}
          onRetry={() => void modelsQuery.refetch()}
          onTogglePage={togglePage}
          onToggleModelGroup={toggleModelGroup}
          onSort={changeSort}
          onEdit={beginEdit}
          onDelete={setDeleting}
        />
      </DataTableShell>

      <ModelEditorDialog
        editing={editing}
        form={form}
        selectedProvider={selectedProvider}
        selectedCapability={selectedCapability}
        modelEnabled={modelEnabled}
        bindingMode={bindingMode}
        selectedAccountIDs={selectedAccountIDs}
        accountSearch={accountSearch}
        accountOptionsPending={accountOptionsQuery.isPending}
        accountOptionsError={accountOptionsQuery.error?.message ?? null}
        visibleAccountOptions={visibleAccountOptions}
        updatePending={updateMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(values) => updateMutation.mutate(values)}
        onAccountSearchChange={setAccountSearch}
        onToggleBoundAccount={toggleBoundAccount}
      />

      <ModelDeleteDialogs
        deleting={deleting}
        batchDeleteOpen={batchDeleteOpen}
        selectedGroupCount={selectedGroupCount}
        deletePending={deleteMutation.isPending}
        batchDeletePending={batchDeleteMutation.isPending}
        onDeletingOpenChange={(open) => !open && setDeleting(null)}
        onBatchDeleteOpenChange={setBatchDeleteOpen}
        onDelete={() => deleting && deleteMutation.mutate(deleting.routes)}
        onBatchDelete={() => batchDeleteMutation.mutate()}
      />
    </div>
  );
}
