import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useState } from "react";

import { listClientKeys } from "@/entities/client-keys/client-keys-api";
import type { ClientKeyDTO } from "@/entities/client-keys/types";
import type { SecretDialogState } from "@/features/client-keys/client-key-secret-dialog";
import type { PaginatedDTO } from "@/shared/api/client";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

/** i18n 翻译函数签名：页面模型与各变更 hook 共用同一契约，不重复声明。 */
export type ClientKeysTranslate = (key: string, options?: Record<string, unknown>) => string;

/** 整页勾选：勾选或取消当前页全部密钥，其它页选择保持不变。 */
function nextPageSelection(current: Set<string>, ids: readonly string[], checked: boolean): Set<string> {
  const next = new Set(current);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

/** 单行勾选：只影响目标密钥。 */
function nextKeySelection(current: Set<string>, id: string, checked: boolean): Set<string> {
  const next = new Set(current);
  if (checked) next.add(id);
  else next.delete(id);
  return next;
}

export type ClientKeysListModel = {
  page: number;
  setPage: (page: number) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  search: string;
  setSearch: (search: string) => void;
  statusFilter: string;
  setStatusFilter: (status: string) => void;
  modelScopeFilter: string;
  setModelScopeFilter: (scope: string) => void;
  sort: TableSort;
  changeSort: (field: string, initialOrder: SortOrder) => void;
  keysQuery: UseQueryResult<PaginatedDTO<ClientKeyDTO>, Error>;
  pageIds: string[];
};

/** 列表查询状态：分页、筛选、排序参数与当前页密钥 id。 */
export function useClientKeysListModel(): ClientKeysListModel {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modelScopeFilter, setModelScopeFilter] = useState("");
  const [sort, setSort] = useState<TableSort>({ field: "", order: "asc" });
  const debouncedSearch = useDebouncedValue(search);
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
  const pageIds = keysQuery.data?.items.map((key) => key.id) ?? [];
  const changeSort = (field: string, initialOrder: SortOrder): void => {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  };
  return {
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
    changeSort,
    keysQuery,
    pageIds,
  };
}

export type ClientKeysSelection = {
  selected: Set<string>;
  clear: () => void;
  togglePage: (checked: boolean) => void;
  toggleKey: (id: string, checked: boolean) => void;
};

/** 选中集合：跨页保留所选密钥 id。 */
export function useClientKeysSelection(pageIds: string[]): ClientKeysSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const clear = (): void => setSelected(new Set());
  const togglePage = (checked: boolean): void => setSelected((current) => nextPageSelection(current, pageIds, checked));
  const toggleKey = (id: string, checked: boolean): void =>
    setSelected((current) => nextKeySelection(current, id, checked));
  return { selected, clear, togglePage, toggleKey };
}

export type ClientKeyDialogs = {
  editing: ClientKeyDTO | "new" | null;
  setEditing: (target: ClientKeyDTO | "new" | null) => void;
  deleting: ClientKeyDTO | null;
  setDeleting: (target: ClientKeyDTO | null) => void;
  batchDeleteOpen: boolean;
  setBatchDeleteOpen: (open: boolean) => void;
  secretDialog: SecretDialogState | null;
  setSecretDialog: (state: SecretDialogState | null) => void;
  statusReferenceTime: number;
};

/** 弹窗状态：编辑目标、删除目标、批量删除与明文弹窗；状态参考时间在首次渲染固定。 */
export function useClientKeyDialogs(): ClientKeyDialogs {
  const [editing, setEditing] = useState<ClientKeyDTO | "new" | null>(null);
  const [deleting, setDeleting] = useState<ClientKeyDTO | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [secretDialog, setSecretDialog] = useState<SecretDialogState | null>(null);
  const [statusReferenceTime] = useState(() => Date.now());
  return {
    editing,
    setEditing,
    deleting,
    setDeleting,
    batchDeleteOpen,
    setBatchDeleteOpen,
    secretDialog,
    setSecretDialog,
    statusReferenceTime,
  };
}
