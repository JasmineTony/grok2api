import { Plus, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { ModelRouteDTO } from "@/entities/model/types";
import type { ModelBulkMutations } from "@/features/models/use-model-bulk-mutations";
import type { ModelListController } from "@/features/models/use-model-list";
import type { ModelSelectionController } from "@/features/models/use-model-selection";
import { DataTableFilters } from "@/shared/components/data-table-filters";

// 模型页工具栏：搜索、来源/状态筛选、批量操作、同步与新增。

type ModelsToolbarProps = {
  list: ModelListController;
  selection: ModelSelectionController;
  bulk: ModelBulkMutations;
  selectedGroups: number;
  onCreate: () => void;
  onBatchDelete: () => void;
};

export function ModelsToolbar({ list, selection, bulk, selectedGroups, onCreate, onBatchDelete }: ModelsToolbarProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <ModelSearchField list={list} />
        <ModelListFilters list={list} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <ModelBulkActions
          selection={selection}
          bulk={bulk}
          selectedGroups={selectedGroups}
          onBatchDelete={onBatchDelete}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={bulk.sync.isPending}
          onClick={() => bulk.sync.mutate()}
          data-testid="models-sync"
        >
          {bulk.sync.isPending ? <Spinner /> : <RefreshCw />}
          {t("models.sync")}
        </Button>
        <Button size="sm" onClick={onCreate} data-testid="models-create">
          <Plus />
          {t("models.create")}
        </Button>
      </div>
    </>
  );
}

function ModelSearchField({ list }: { list: ModelListController }) {
  const { t } = useTranslation();
  return (
    <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 pl-9 text-xs"
        value={list.search}
        onChange={(event) => list.setSearch(event.target.value)}
        placeholder={t("models.search")}
        aria-label={t("models.search")}
        data-testid="models-search"
      />
    </div>
  );
}

function ModelListFilters({ list }: { list: ModelListController }) {
  const { t } = useTranslation();
  return (
    <DataTableFilters
      filters={[
        {
          id: "provider",
          label: t("models.provider"),
          value: list.providerFilter,
          onChange: (value) => list.setProviderFilter(value as ModelRouteDTO["provider"] | ""),
          options: [
            { value: "grok_build", label: t("models.providerGrokBuild") },
            { value: "grok_web", label: t("models.providerGrokWeb") },
            { value: "grok_console", label: t("console.name") },
          ],
        },
        {
          id: "status",
          label: t("models.status"),
          value: list.statusFilter,
          onChange: list.setStatusFilter,
          options: [
            { value: "enabled", label: t("common.enabled") },
            { value: "disabled", label: t("common.disabled") },
          ],
        },
      ]}
    />
  );
}

type ModelBulkActionsProps = {
  selection: ModelSelectionController;
  bulk: ModelBulkMutations;
  selectedGroups: number;
  onBatchDelete: () => void;
};

function ModelBulkActions({ selection, bulk, selectedGroups, onBatchDelete }: ModelBulkActionsProps) {
  const { t } = useTranslation();
  if (selection.selected.size === 0) return null;
  return (
    <>
      <span className="mr-1 text-xs text-muted-foreground" data-testid="models-selected-count">
        {t("common.selectedCount", { count: selectedGroups })}
      </span>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => bulk.setEnabled.mutate(true)}
        data-testid="models-batch-enable"
      >
        {t("common.enable")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => bulk.setEnabled.mutate(false)}
        data-testid="models-batch-disable"
      >
        {t("common.disable")}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        className="text-destructive hover:text-destructive"
        onClick={onBatchDelete}
        data-testid="models-batch-delete"
      >
        {t("common.delete")}
      </Button>
    </>
  );
}
