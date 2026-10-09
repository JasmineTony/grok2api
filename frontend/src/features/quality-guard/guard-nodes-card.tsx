import type { TFunction } from "i18next";
import { Plus, Power, PowerOff, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatTime } from "@/features/quality-guard/guard-format";
import { GuardNodesTable } from "@/features/quality-guard/guard-nodes-table";
import type { GuardNodeFilters } from "@/features/quality-guard/use-guard-node-list";
import type { GuardNodesController } from "@/features/quality-guard/use-guard-nodes";
import type { EgressNodeDTO } from "@/features/settings/settings-api";
import { DataTableFilters, type DataTableFilter } from "@/shared/components/data-table-filters";
import { Pagination } from "@/shared/components/pagination";
import { cn } from "@/shared/lib/cn";

// 节点质量卡片：标题/批量操作、搜索与筛选、表格与分页。从 quality-guard-page.tsx 拆出，查询参数与列不变。

const QUALITY_GUARD_PAGE_SIZES = [20, 50, 100] as const;

function nodeFilterDefinitions(filters: GuardNodeFilters, t: TFunction): DataTableFilter[] {
  return [
    {
      id: "enabled",
      label: t("settings.egress.enabled"),
      value: filters.enabledFilter,
      onChange: filters.setEnabledFilter,
      options: [
        { value: "enabled", label: t("common.enable") },
        { value: "disabled", label: t("common.disable") },
      ],
    },
    {
      id: "probe",
      label: t("settings.egress.probe"),
      value: filters.probeFilter,
      onChange: filters.setProbeFilter,
      options: [
        { value: "healthy", label: t("settings.egress.healthy") },
        { value: "unhealthy", label: t("settings.egress.unhealthy") },
        { value: "unknown", label: t("settings.egress.notTested") },
      ],
    },
    {
      id: "assignment",
      label: t("settings.egress.accounts"),
      value: filters.assignmentFilter,
      onChange: filters.setAssignmentFilter,
      options: [
        { value: "bound", label: t("settings.egress.assigned") },
        { value: "unbound", label: t("settings.egress.unassigned") },
      ],
    },
  ];
}

function GuardNodeBatchActions({
  nodes,
  batchPending,
  deleting,
  onToggle,
  onDelete,
}: {
  nodes: EgressNodeDTO[];
  batchPending: boolean;
  deleting: boolean;
  onToggle: (nodes: EgressNodeDTO[], enabled: boolean) => void;
  onDelete: (nodes: EgressNodeDTO[]) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <span className="mr-1 text-xs text-muted-foreground">{t("common.selectedCount", { count: nodes.length })}</span>
      <GuardNodeBatchToggleButtons nodes={nodes} batchPending={batchPending} onToggle={onToggle} />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
        disabled={deleting}
        onClick={() => onDelete(nodes)}
      >
        <Trash2 />
        {t("common.delete")}
      </Button>
    </>
  );
}

function GuardNodeBatchToggleButtons({
  nodes,
  batchPending,
  onToggle,
}: {
  nodes: EgressNodeDTO[];
  batchPending: boolean;
  onToggle: (nodes: EgressNodeDTO[], enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={batchPending || nodes.every((node) => node.enabled)}
        onClick={() => onToggle(nodes, true)}
      >
        <Power />
        {t("common.enable")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={batchPending || nodes.every((node) => !node.enabled)}
        onClick={() => onToggle(nodes, false)}
      >
        <PowerOff />
        {t("common.disable")}
      </Button>
    </>
  );
}

function GuardNodesHeader({ controller }: { controller: GuardNodesController }) {
  const { t, i18n } = useTranslation();
  const { view, nodesQuery, actions, dialogs } = controller;
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div>
        <h2 id="guard-nodes-title" className="text-sm font-medium">
          {t("qualityGuard.nodes")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("qualityGuard.nodesHelp")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 self-start sm:self-auto sm:justify-end">
        <span className="mr-1 hidden text-xs text-muted-foreground lg:inline">
          {t("qualityGuard.updatedAt", { time: formatTime(view.status?.updatedAt, i18n.language) })}
        </span>
        {view.selectedNodes.length > 0 ? (
          <GuardNodeBatchActions
            nodes={view.selectedNodes}
            batchPending={actions.batchPending}
            deleting={actions.deleting}
            onToggle={actions.batchToggleNodes}
            onDelete={dialogs.beginDelete}
          />
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => void nodesQuery.refetch()}
          disabled={nodesQuery.isFetching}
          aria-label={t("qualityGuard.refreshNodes")}
          title={t("qualityGuard.refreshNodes")}
        >
          <RefreshCw className={cn("size-4", nodesQuery.isFetching && "animate-spin")} />
        </Button>
        <Button type="button" size="sm" onClick={dialogs.beginCreate} data-testid="guard-node-create">
          <Plus />
          {t("settings.egress.add")}
        </Button>
      </div>
    </div>
  );
}

function GuardNodesToolbar({ filters }: { filters: GuardNodeFilters }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:px-5">
      <div className="relative min-w-0 flex-1 sm:max-w-72">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-9 text-xs"
          value={filters.search}
          onChange={(event) => filters.setSearch(event.target.value)}
          placeholder={t("settings.egress.search")}
          aria-label={t("settings.egress.search")}
          data-testid="guard-nodes-search"
        />
      </div>
      <DataTableFilters filters={nodeFilterDefinitions(filters, t)} />
    </div>
  );
}

export function GuardNodesCard({ controller }: { controller: GuardNodesController }) {
  const { nodesQuery, filters } = controller;
  return (
    <section
      className="overflow-hidden rounded-lg bg-card"
      aria-labelledby="guard-nodes-title"
      data-testid="guard-nodes-card"
    >
      <GuardNodesHeader controller={controller} />
      <GuardNodesToolbar filters={filters} />
      <GuardNodesTable controller={controller} />
      {nodesQuery.data && nodesQuery.data.total > 0 ? (
        <div className="border-t px-4 py-3 sm:px-5">
          <Pagination
            page={nodesQuery.data.page}
            pageSize={nodesQuery.data.pageSize}
            total={nodesQuery.data.total}
            pageSizeOptions={QUALITY_GUARD_PAGE_SIZES}
            onPageChange={filters.changePage}
            onPageSizeChange={filters.changePageSize}
          />
        </div>
      ) : null}
    </section>
  );
}
