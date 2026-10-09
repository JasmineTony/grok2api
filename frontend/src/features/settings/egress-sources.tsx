import type { UseQueryResult } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { MoreHorizontal, Pencil, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
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
import { EgressErrorTooltip } from "@/features/settings/egress-error-tooltip";
import { EgressActionTooltip } from "@/features/settings/egress-section-header";
import type { EgressScope, EgressSourceDTO, EgressSourceListDTO } from "@/features/settings/settings-api";
import { ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { DataTableFilters, type DataTableFilter } from "@/shared/components/data-table-filters";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { formatDateTime } from "@/shared/lib/format";

function subscriptionScopeFilter(
  t: TFunction,
  value: string,
  onChange: (value: string) => void,
  scopeLabel: (scope: EgressScope) => string,
): DataTableFilter {
  return {
    id: "subscription-scope",
    label: t("settings.egress.scope"),
    value,
    onChange,
    options: [
      { value: "grok_build", label: scopeLabel("grok_build") },
      { value: "grok_web", label: scopeLabel("grok_web") },
      { value: "grok_console", label: scopeLabel("grok_console") },
      { value: "grok_web_asset", label: scopeLabel("grok_web_asset") },
      { value: "grok_console_asset", label: scopeLabel("grok_console_asset") },
    ],
  };
}

type EgressSourcesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  scopeFilter: string;
  onScopeFilterChange: (value: string) => void;
  scopeLabel: (scope: EgressScope) => string;
  onAdd: () => void;
};

/** 订阅源工具栏：搜索 + 作用域筛选 + 新增入口。 */
export function EgressSourcesToolbar({
  search,
  onSearchChange,
  scopeFilter,
  onScopeFilterChange,
  scopeLabel,
  onAdd,
}: EgressSourcesToolbarProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
        <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 pl-9 text-xs"
            data-testid="egress-sources-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={t("settings.egress.searchSubscriptions")}
            aria-label={t("settings.egress.searchSubscriptions")}
          />
        </div>
        <DataTableFilters filters={[subscriptionScopeFilter(t, scopeFilter, onScopeFilterChange, scopeLabel)]} />
      </div>
      <EgressActionTooltip label={t("settings.egress.addSourceHelp")}>
        <Button type="button" size="sm" variant="secondary" onClick={onAdd} data-testid="egress-sources-add">
          <Plus />
          {t("settings.egress.addSource")}
        </Button>
      </EgressActionTooltip>
    </>
  );
}

export type EgressSourcesTableProps = {
  query: UseQueryResult<EgressSourceListDTO>;
  sources: EgressSourceDTO[];
  scopeLabel: (scope: EgressScope) => string;
  hasActiveFilters: boolean;
  syncPending: boolean;
  removePending: boolean;
  onSync: (source: EgressSourceDTO) => void;
  onEdit: (source: EgressSourceDTO) => void;
  onDelete: (source: EgressSourceDTO) => void;
};

/** 订阅源表格：加载态、空态与失败重试。 */
export function EgressSourcesTable(props: EgressSourcesTableProps) {
  const { query, sources, hasActiveFilters } = props;
  if (query.isError) {
    return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  }
  return (
    <Table viewportRows={10} rowHeight={48} className="min-w-[720px] table-fixed" data-testid="egress-sources-table">
      <EgressSourcesTableHead />
      {query.isPending ? (
        <TableBody>
          <TableLoadingRow colSpan={6} />
        </TableBody>
      ) : null}
      {!query.isPending && sources.length === 0 ? <EgressSourcesEmptyRow hasActiveFilters={hasActiveFilters} /> : null}
      {!query.isPending && sources.length > 0 ? (
        <VirtualTableBody
          items={sources}
          colSpan={6}
          rowHeight={48}
          renderRow={(source) => <EgressSourceRow key={source.id} source={source} actions={props} />}
        />
      ) : null}
    </Table>
  );
}

function EgressSourcesTableHead() {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="w-[22%]">{t("settings.egress.source")}</TableHead>
        <TableHead className="w-[16%] text-center">{t("settings.egress.scope")}</TableHead>
        <TableHead className="w-[13%] text-center">{t("settings.egress.subscriptionRoute")}</TableHead>
        <TableHead className="w-[29%]">{t("settings.egress.lastSync")}</TableHead>
        <TableHead className="w-[15%] text-center">{t("settings.egress.capacity")}</TableHead>
        <TableActionHead />
      </TableRow>
    </TableHeader>
  );
}

function EgressSourcesEmptyRow({ hasActiveFilters }: { hasActiveFilters: boolean }) {
  const { t } = useTranslation();
  return (
    <TableBody>
      <TableRow>
        <TableCell
          colSpan={6}
          className="h-24 text-center text-xs text-muted-foreground"
          data-testid="egress-sources-empty"
        >
          {hasActiveFilters ? t("settings.egress.noSubscriptionMatches") : t("settings.egress.noSources")}
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

function EgressSourceRow({ source, actions }: { source: EgressSourceDTO; actions: EgressSourcesTableProps }) {
  const { t, i18n } = useTranslation();
  return (
    <TableRow className="group h-12" data-testid={`egress-source-row-${source.id}`}>
      <EgressSourceNameCell source={source} />
      <TableCell className="text-center">
        <Badge variant="secondary" className="text-[10px]" data-testid={`egress-source-scope-${source.id}`}>
          {actions.scopeLabel(source.scope)}
        </Badge>
      </TableCell>
      <TableCell className="text-center">
        <Badge
          variant={source.proxyConfigured ? "secondary" : "outline"}
          className="text-[10px]"
          data-testid={`egress-source-route-${source.id}`}
        >
          {source.proxyConfigured ? t("settings.egress.subscriptionProxyShort") : t("settings.egress.direct")}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground" data-testid={`egress-source-last-sync-${source.id}`}>
        {source.lastSyncedAt ? formatDateTime(source.lastSyncedAt, i18n.language) : t("settings.egress.never")}
      </TableCell>
      <TableCell className="text-center text-xs tabular-nums" data-testid={`egress-source-capacity-${source.id}`}>
        {source.defaultAccountCapacity || t("settings.egress.unlimited")}
      </TableCell>
      <EgressSourceActionsCell source={source} actions={actions} />
    </TableRow>
  );
}

function EgressSourceNameCell({ source }: { source: EgressSourceDTO }) {
  return (
    <TableCell>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={
            source.enabled
              ? "size-1.5 shrink-0 rounded-full bg-emerald-500"
              : "size-1.5 shrink-0 rounded-full bg-muted-foreground/35"
          }
        />
        <span className="truncate text-xs font-medium" data-testid={`egress-source-name-${source.id}`}>
          {source.name}
        </span>
        {source.lastSyncError ? <EgressErrorTooltip message={source.lastSyncError} /> : null}
      </div>
    </TableCell>
  );
}

function EgressSourceActionsCell({ source, actions }: { source: EgressSourceDTO; actions: EgressSourcesTableProps }) {
  const { t } = useTranslation();
  return (
    <TableActionCell>
      <DropdownMenu>
        <EgressSourceActionsTrigger sourceId={source.id} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            disabled={actions.syncPending}
            onClick={() => actions.onSync(source)}
            data-testid={`egress-source-sync-${source.id}`}
          >
            <RefreshCw />
            {t("settings.egress.sync")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => actions.onEdit(source)} data-testid={`egress-source-edit-${source.id}`}>
            <Pencil />
            {t("common.edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            disabled={actions.removePending}
            onClick={() => actions.onDelete(source)}
            data-testid={`egress-source-delete-${source.id}`}
          >
            <Trash2 />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TableActionCell>
  );
}

function EgressSourceActionsTrigger({ sourceId }: { sourceId: string }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8"
        aria-label={t("common.actions")}
        data-testid={`egress-source-actions-${sourceId}`}
      >
        <MoreHorizontal />
      </Button>
    </DropdownMenuTrigger>
  );
}
