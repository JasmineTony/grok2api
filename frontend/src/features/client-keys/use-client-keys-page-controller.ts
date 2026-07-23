import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { listModels } from "@/entities/model/model-api";
import {
  type ClientKeyDTO,
  createClientKey,
  type CreateKeyResponseDTO,
  deleteClientKey,
  deleteClientKeys,
  getClientKeySecret,
  listClientKeys,
  updateClientKey,
  updateClientKeysEnabled,
} from "@/features/client-keys/client-keys-api";
import { useApiClient } from "@/shared/api/use-api-client";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { ticksToUSD, usdToTicks } from "@/shared/lib/cost";
import { toDateTimeLocal } from "@/shared/lib/format";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

type SecretDialogState = { secret: string; source: "created" | "retrieved" };

export function useClientKeysPageController() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const apiClient = useApiClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modelScopeFilter, setModelScopeFilter] = useState("");
  const [sort, setSort] = useState<TableSort>({ field: "", order: "asc" });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [editing, setEditing] = useState<ClientKeyDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<ClientKeyDTO | null>(null);
  const [secretDialog, setSecretDialog] = useState<SecretDialogState | null>(null);
  const [modelOptionsPage, setModelOptionsPage] = useState(1);
  const [modelOptionsSearch, setModelOptionsSearch] = useState("");
  const [statusReferenceTime] = useState(() => Date.now());
  const debouncedSearch = useDebouncedValue(search);
  const debouncedModelOptionsSearch = useDebouncedValue(modelOptionsSearch);
  const schema = z
    .object({
      name: z.string().min(1, t("errors.required")),
      enabled: z.boolean(),
      expiryUnlimited: z.boolean(),
      expiresAt: z.string(),
      rpmUnlimited: z.boolean(),
      rpmLimit: z.number().int().min(1, t("errors.positive")).max(100_000),
      concurrencyUnlimited: z.boolean(),
      maxConcurrent: z.number().int().min(1, t("errors.positive")).max(1_024),
      billingUnlimited: z.boolean(),
      billingLimitUsd: z.number().min(0.01, t("errors.positive")),
      allowedModelIds: z.array(z.string()),
    })
    .superRefine((value, context) => {
      if (!value.expiryUnlimited && !value.expiresAt) {
        context.addIssue({ code: "custom", path: ["expiresAt"], message: t("errors.required") });
      }
    });
  type KeyForm = z.infer<typeof schema>;
  const form = useForm<KeyForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      enabled: true,
      expiryUnlimited: true,
      expiresAt: "",
      rpmUnlimited: false,
      rpmLimit: 120,
      concurrencyUnlimited: false,
      maxConcurrent: 8,
      billingUnlimited: true,
      billingLimitUsd: 10,
      allowedModelIds: [],
    },
  });
  const keyEnabled = useWatch({ control: form.control, name: "enabled" });
  const selectedModels = useWatch({ control: form.control, name: "allowedModelIds" });
  const expiryUnlimited = useWatch({ control: form.control, name: "expiryUnlimited" });
  const rpmUnlimited = useWatch({ control: form.control, name: "rpmUnlimited" });
  const concurrencyUnlimited = useWatch({ control: form.control, name: "concurrencyUnlimited" });
  const billingUnlimited = useWatch({ control: form.control, name: "billingUnlimited" });

  const keysQuery = useQuery({
    queryKey: [
      "client-keys",
      page,
      pageSize,
      debouncedSearch,
      statusFilter,
      modelScopeFilter,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      listClientKeys(apiClient, {
        page,
        pageSize,
        search: debouncedSearch,
        status: statusFilter,
        modelScope: modelScopeFilter,
        ...(sort.field ? { sortBy: sort.field, sortOrder: sort.order } : {}),
      }),
  });
  const modelsQuery = useQuery({
    queryKey: ["models", "options", modelOptionsPage, debouncedModelOptionsSearch],
    queryFn: () =>
      listModels(apiClient, {
        page: modelOptionsPage,
        pageSize: 50,
        search: debouncedModelOptionsSearch,
      }),
    enabled: editing !== null,
  });

  const saveMutation = useMutation<CreateKeyResponseDTO | ClientKeyDTO, Error, KeyForm>({
    mutationFn: (values: KeyForm) => {
      const body = {
        name: values.name,
        enabled: values.enabled,
        rpmLimit: values.rpmUnlimited ? 0 : values.rpmLimit,
        maxConcurrent: values.concurrencyUnlimited ? 0 : values.maxConcurrent,
        billingLimitUsdTicks: values.billingUnlimited ? 0 : usdToTicks(values.billingLimitUsd),
        allowedModelIds: values.allowedModelIds,
        expiresAt: values.expiryUnlimited ? "" : new Date(values.expiresAt).toISOString(),
      };
      if (editing === "new") {
        return createClientKey(apiClient, body);
      }
      if (!editing) throw new Error(t("errors.generic"));
      return updateClientKey(apiClient, editing.id, body);
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["client-keys"] });
      if ("secret" in result) {
        setSecretDialog({ secret: result.secret, source: "created" });
        toast.success(t("keys.created"));
      } else {
        toast.success(t("keys.updated"));
      }
      setEditing(null);
    },
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteClientKey(apiClient, id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-keys"] });
      setDeleting(null);
      toast.success(t("keys.deleted"));
    },
    onError: showError,
  });

  const copyMutation = useMutation({
    mutationFn: (id: string) => getClientKeySecret(apiClient, id),
    onSuccess: (result) => setSecretDialog({ secret: result.secret, source: "retrieved" }),
    onError: showError,
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (enabled: boolean) => updateClientKeysEnabled(apiClient, [...selected], enabled),
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["client-keys"] });
      toast.success(t("keys.batchUpdated"));
    },
    onError: showError,
  });

  const batchDeleteMutation = useMutation({
    mutationFn: () => deleteClientKeys(apiClient, [...selected]),
    onSuccess: () => {
      setSelected(new Set());
      setBatchDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["client-keys"] });
      toast.success(t("keys.deleted"));
    },
    onError: showError,
  });

  function showError(error: unknown): void {
    toast.error(error instanceof Error ? error.message : t("errors.generic"));
  }

  function beginCreate(): void {
    setEditing("new");
    setModelOptionsPage(1);
    setModelOptionsSearch("");
    form.reset({
      name: "",
      enabled: true,
      expiryUnlimited: true,
      expiresAt: "",
      rpmUnlimited: false,
      rpmLimit: 120,
      concurrencyUnlimited: false,
      maxConcurrent: 8,
      billingUnlimited: true,
      billingLimitUsd: 10,
      allowedModelIds: [],
    });
  }

  function beginEdit(key: ClientKeyDTO): void {
    setEditing(key);
    setModelOptionsPage(1);
    setModelOptionsSearch("");
    form.reset({
      name: key.name,
      enabled: key.enabled,
      expiryUnlimited: !key.expiresAt,
      expiresAt: toDateTimeLocal(key.expiresAt),
      rpmUnlimited: key.rpmLimit === 0,
      rpmLimit: key.rpmLimit > 0 ? key.rpmLimit : 120,
      concurrencyUnlimited: key.maxConcurrent === 0,
      maxConcurrent: key.maxConcurrent > 0 ? key.maxConcurrent : 8,
      billingUnlimited: key.billingLimitUsdTicks === 0,
      billingLimitUsd: key.billingLimitUsdTicks > 0 ? ticksToUSD(key.billingLimitUsdTicks) : 10,
      allowedModelIds: key.allowedModelIds,
    });
  }

  function toggleModel(id: string): void {
    const current = form.getValues("allowedModelIds");
    form.setValue(
      "allowedModelIds",
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
      { shouldDirty: true },
    );
  }

  const result = keysQuery.data;
  const pageIDs = result?.items.map((key) => key.id) ?? [];
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

  function toggleKey(id: string, checked: boolean): void {
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
    modelScopeFilter,
    setModelScopeFilter,
    sort,
    setSort,
    selected,
    setSelected,
    batchDeleteOpen,
    setBatchDeleteOpen,
    editing,
    setEditing,
    deleting,
    setDeleting,
    secretDialog,
    setSecretDialog,
    modelOptionsPage,
    setModelOptionsPage,
    modelOptionsSearch,
    setModelOptionsSearch,
    statusReferenceTime,
    form,
    keyEnabled,
    selectedModels,
    expiryUnlimited,
    rpmUnlimited,
    concurrencyUnlimited,
    billingUnlimited,
    keysQuery,
    modelsQuery,
    saveMutation,
    deleteMutation,
    copyMutation,
    batchUpdateMutation,
    batchDeleteMutation,
    beginCreate,
    beginEdit,
    toggleModel,
    result,
    selectedOnPage,
    allPageSelected,
    togglePage,
    toggleKey,
    changeSort,
  };
}

export type ClientKeysPageController = ReturnType<typeof useClientKeysPageController>;
