import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  createClientKey,
  deleteClientKey,
  deleteClientKeys,
  getClientKeySecret,
  listClientKeys,
  updateClientKey,
  updateClientKeysEnabled,
  type ClientKeyDTO,
  type CreateKeyResponseDTO,
} from "@/features/client-keys/client-keys-api";
import { ClientKeyDeleteDialog, ClientKeysBatchDeleteDialog } from "@/features/client-keys/client-key-delete-dialogs";
import { ClientKeyFormDialog } from "@/features/client-keys/client-key-form-dialog";
import {
  clientKeyFormToInput,
  clientKeyToFormValues,
  createClientKeyDefaults,
  createClientKeySchema,
  type ClientKeyFormValues,
} from "@/features/client-keys/client-key-form-schema";
import { ClientKeySecretDialog, type SecretDialogState } from "@/features/client-keys/client-key-secret-dialog";
import { ClientKeysTable } from "@/features/client-keys/client-keys-table";
import { ClientKeysToolbar } from "@/features/client-keys/client-keys-toolbar";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

/**
 * 客户端密钥页：持有筛选/分页/选中状态与全部查询、变更，
 * 表格、工具栏、创建/编辑弹窗、明文弹窗与删除确认均为独立组件。
 */
export function ClientKeysPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
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
  const [statusReferenceTime] = useState(() => Date.now());
  const debouncedSearch = useDebouncedValue(search);
  const form = useForm<ClientKeyFormValues>({
    resolver: zodResolver(createClientKeySchema(t)),
    defaultValues: createClientKeyDefaults(),
  });

  function showError(error: unknown): void {
    toast.error(error instanceof Error ? error.message : t("errors.generic"));
  }

  const keysQuery = useQuery({
    queryKey: ["client-keys", page, pageSize, debouncedSearch, statusFilter, modelScopeFilter, sort.field, sort.order],
    queryFn: () =>
      listClientKeys({
        page,
        pageSize,
        search: debouncedSearch,
        status: statusFilter,
        modelScope: modelScopeFilter,
        sortBy: sort.field || undefined,
        sortOrder: sort.field ? sort.order : undefined,
      }),
  });

  const saveMutation = useMutation<CreateKeyResponseDTO | ClientKeyDTO, Error, ClientKeyFormValues>({
    mutationFn: (values: ClientKeyFormValues) => {
      if (editing === "new") return createClientKey(clientKeyFormToInput(values));
      if (!editing) throw new Error(t("errors.generic"));
      return updateClientKey(editing.id, clientKeyFormToInput(values));
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
    mutationFn: deleteClientKey,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["client-keys"] });
      setDeleting(null);
      toast.success(t("keys.deleted"));
    },
    onError: showError,
  });

  const copyMutation = useMutation({
    mutationFn: getClientKeySecret,
    onSuccess: (result) => setSecretDialog({ secret: result.secret, source: "retrieved" }),
    onError: showError,
  });

  const batchUpdateMutation = useMutation({
    mutationFn: (enabled: boolean) => updateClientKeysEnabled([...selected], enabled),
    onSuccess: () => {
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ["client-keys"] });
      toast.success(t("keys.batchUpdated"));
    },
    onError: showError,
  });

  const batchDeleteMutation = useMutation({
    mutationFn: () => deleteClientKeys([...selected]),
    onSuccess: () => {
      setSelected(new Set());
      setBatchDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["client-keys"] });
      toast.success(t("keys.deleted"));
    },
    onError: showError,
  });

  function beginCreate(): void {
    setEditing("new");
    form.reset(createClientKeyDefaults());
  }

  function beginEdit(key: ClientKeyDTO): void {
    setEditing(key);
    form.reset(clientKeyToFormValues(key));
  }

  function togglePage(checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const key of keysQuery.data?.items ?? []) {
        if (checked) next.add(key.id);
        else next.delete(key.id);
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

  const result = keysQuery.data;
  return (
    <div className="space-y-5">
      <header className="flex min-h-8 items-center">
        <h1 className="text-xl font-medium">{t("keys.title")}</h1>
        <p className="sr-only">{t("keys.description")}</p>
      </header>

      <DataTableShell
        toolbar={
          <ClientKeysToolbar
            search={search}
            onSearchChange={(value) => {
              setSearch(value);
              setPage(1);
            }}
            statusFilter={statusFilter}
            onStatusFilterChange={(value) => {
              setStatusFilter(value);
              setPage(1);
            }}
            modelScopeFilter={modelScopeFilter}
            onModelScopeFilterChange={(value) => {
              setModelScopeFilter(value);
              setPage(1);
            }}
            selectedCount={selected.size}
            onBatchEnable={() => batchUpdateMutation.mutate(true)}
            onBatchDisable={() => batchUpdateMutation.mutate(false)}
            onBatchDelete={() => setBatchDeleteOpen(true)}
            onCreate={beginCreate}
          />
        }
        footer={
          result && result.total > 0 ? (
            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              onPageChange={setPage}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setPage(1);
              }}
            />
          ) : undefined
        }
      >
        <ClientKeysTable
          result={result}
          isPending={keysQuery.isPending}
          isError={keysQuery.isError}
          errorMessage={keysQuery.error?.message ?? ""}
          onRetry={() => void keysQuery.refetch()}
          selected={selected}
          onTogglePage={togglePage}
          onToggleKey={toggleKey}
          sort={sort}
          onSort={changeSort}
          referenceTime={statusReferenceTime}
          copyPending={copyMutation.isPending}
          copyPendingId={copyMutation.variables}
          onCopySecret={(id) => copyMutation.mutate(id)}
          onEdit={beginEdit}
          onDelete={setDeleting}
        />
      </DataTableShell>

      <ClientKeyFormDialog
        editing={editing}
        form={form}
        isPending={saveMutation.isPending}
        onClose={() => setEditing(null)}
        onSubmit={(values) => saveMutation.mutate(values)}
      />
      <ClientKeySecretDialog state={secretDialog} onClose={() => setSecretDialog(null)} />
      <ClientKeyDeleteDialog
        target={deleting}
        onClose={() => setDeleting(null)}
        onConfirm={(id) => deleteMutation.mutate(id)}
      />
      <ClientKeysBatchDeleteDialog
        open={batchDeleteOpen}
        count={selected.size}
        onOpenChange={setBatchDeleteOpen}
        onConfirm={() => batchDeleteMutation.mutate()}
      />
    </div>
  );
}
