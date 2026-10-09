import type { TFunction } from "i18next";
import { Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTableFilters, type DataTableFilter } from "@/shared/components/data-table-filters";

export type ClientKeysToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  modelScopeFilter: string;
  onModelScopeFilterChange: (value: string) => void;
  selectedCount: number;
  onBatchEnable: () => void;
  onBatchDisable: () => void;
  onBatchDelete: () => void;
  onCreate: () => void;
};

function statusFilter(t: TFunction, value: string, onChange: (value: string) => void): DataTableFilter {
  return {
    id: "status",
    label: t("keys.status"),
    value,
    onChange,
    options: [
      { value: "active", label: t("keys.statusActive") },
      { value: "disabled", label: t("common.disabled") },
      { value: "expired", label: t("keys.statusExpired") },
    ],
  };
}

function modelScopeFilter(t: TFunction, value: string, onChange: (value: string) => void): DataTableFilter {
  return {
    id: "modelScope",
    label: t("keys.modelScope"),
    value,
    onChange,
    options: [
      { value: "all", label: t("keys.allModels") },
      { value: "restricted", label: t("keys.restrictedModels") },
    ],
  };
}

/** 列表工具栏：搜索 + 筛选；存在选中项时切换为批量操作入口。 */
export function ClientKeysToolbar(props: ClientKeysToolbarProps) {
  const { selectedCount, onCreate } = props;
  return (
    <>
      <ClientKeysFilterBar {...props} />
      {selectedCount > 0 ? <ClientKeysBatchActions {...props} /> : <ClientKeysCreateButton onCreate={onCreate} />}
    </>
  );
}

function ClientKeysFilterBar({
  search,
  onSearchChange,
  statusFilter: status,
  onStatusFilterChange,
  modelScopeFilter: modelScope,
  onModelScopeFilterChange,
}: ClientKeysToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex w-full items-center gap-2 sm:w-auto">
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-9 text-xs"
          data-testid="client-keys-search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={t("keys.search")}
          aria-label={t("keys.search")}
        />
      </div>
      <DataTableFilters
        filters={[
          statusFilter(t, status, onStatusFilterChange),
          modelScopeFilter(t, modelScope, onModelScopeFilterChange),
        ]}
      />
    </div>
  );
}

function ClientKeysBatchActions({
  selectedCount,
  onBatchEnable,
  onBatchDisable,
  onBatchDelete,
}: ClientKeysToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="client-keys-batch-actions">
      <span className="mr-1 text-xs text-muted-foreground">{t("common.selectedCount", { count: selectedCount })}</span>
      <Button variant="secondary" size="sm" onClick={onBatchEnable} data-testid="client-keys-batch-enable">
        {t("common.enable")}
      </Button>
      <Button variant="secondary" size="sm" onClick={onBatchDisable} data-testid="client-keys-batch-disable">
        {t("common.disable")}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onBatchDelete}
        data-testid="client-keys-batch-delete"
      >
        {t("common.delete")}
      </Button>
    </div>
  );
}

function ClientKeysCreateButton({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <Button size="sm" onClick={onCreate} data-testid="client-keys-create">
      <Plus />
      {t("keys.create")}
    </Button>
  );
}
