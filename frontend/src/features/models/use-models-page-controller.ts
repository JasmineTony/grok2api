import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import {
  createModel,
  deleteModel,
  deleteModels,
  listModelAccountOptions,
  listModels,
  syncModels,
  updateModel,
  updateModelsEnabled,
} from "@/entities/model/model-api";
import type { ModelRouteDTO } from "@/entities/model/types";
import { useApiClient } from "@/shared/api/use-api-client";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

export function useModelsPageController() {
  const { t, i18n } = useTranslation();
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
  const [deleting, setDeleting] = useState<ModelRouteDTO | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search);
  const schema = z
    .object({
      publicId: z.string().min(1, t("errors.required")),
      provider: z.enum(["grok_build", "grok_web", "grok_console"]),
      upstreamModel: z.string().min(1, t("errors.required")),
      capability: z.enum(["responses", "chat", "image", "image_edit", "video"]),
      enabled: z.boolean(),
      bindingMode: z.boolean(),
      accountIds: z.array(z.string()),
    })
    .refine((value) => !value.bindingMode || value.accountIds.length > 0, {
      path: ["accountIds"],
      message: t("models.selectAccountRequired"),
    });
  type ModelForm = z.infer<typeof schema>;
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
      page,
      pageSize,
      debouncedSearch,
      statusFilter,
      providerFilter,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      listModels(apiClient, {
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
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      setEditing(null);
      toast.success(t(editing === "new" ? "models.created" : "models.updated"));
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteModel(apiClient, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      setDeleting(null);
      toast.success(t("models.deleted"));
    },
    onError: showError,
  });

  const batchDeleteMutation = useMutation({
    mutationFn: () => deleteModels(apiClient, [...selected]),
    onSuccess: (result) => {
      setSelected(new Set());
      setBatchDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success(t("models.batchDeleted", { count: result.deleted }));
    },
    onError: showError,
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (enabled: boolean) => updateModelsEnabled(apiClient, [...selected], enabled),
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success(t("models.batchUpdated"));
    },
    onError: showError,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncModels(apiClient),
    onSuccess: (result) => {
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

  const result = modelsQuery.data;
  const pageIDs = result?.items.map((model) => model.id) ?? [];
  const selectedOnPage = pageIDs.filter((id) => selected.has(id));
  const allPageSelected = pageIDs.length > 0 && selectedOnPage.length === pageIDs.length;

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

  function toggleModel(id: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  }

  return {
    t,
    i18n,
    page,
    setPage,
    pageSize,
    setPageSize,
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    providerFilter,
    setProviderFilter,
    sort,
    setSort,
    selected,
    setSelected,
    editing,
    setEditing,
    deleting,
    setDeleting,
    batchDeleteOpen,
    setBatchDeleteOpen,
    accountSearch,
    setAccountSearch,
    form,
    modelEnabled,
    selectedProvider,
    selectedCapability,
    bindingMode,
    selectedAccountIDs,
    modelsQuery,
    accountOptionsQuery,
    updateMutation,
    deleteMutation,
    batchDeleteMutation,
    batchUpdateMutation,
    syncMutation,
    beginEdit,
    beginCreate,
    toggleBoundAccount,
    visibleAccountOptions,
    result,
    pageIDs,
    selectedOnPage,
    allPageSelected,
    togglePage,
    toggleModel,
    changeSort,
  };
}

export type ModelsPageController = ReturnType<typeof useModelsPageController>;
