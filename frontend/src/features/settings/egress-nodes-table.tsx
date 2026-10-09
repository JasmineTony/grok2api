import type { UseQueryResult } from "@tanstack/react-query";
import { CircleHelp, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EgressErrorTooltip } from "@/features/settings/egress-error-tooltip";
import { ClearanceBadge, HealthMeter, ProbeSummary } from "@/features/settings/egress-node-indicators";
import type { ClearanceMode, EgressNodeDTO, EgressNodeListDTO, EgressScope } from "@/features/settings/settings-api";
import { ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { cn } from "@/shared/lib/cn";
import type { SortOrder, TableSort } from "@/shared/lib/table-sort";

export type EgressNodeRowActions = {
  edit: (node: EgressNodeDTO) => void;
  remove: (node: EgressNodeDTO) => void;
  test: (node: EgressNodeDTO) => void;
  refreshClearance: (node: EgressNodeDTO) => void;
  testPending: boolean;
  clearancePending: boolean;
};

type EgressNodesTableProps = {
  query: UseQueryResult<EgressNodeListDTO>;
  nodes: EgressNodeDTO[];
  selected: Map<string, EgressNodeDTO>;
  allPageSelected: boolean;
  selectedOnPage: EgressNodeDTO[];
  hasActiveFilters: boolean;
  sort: TableSort;
  clearanceMode: ClearanceMode;
  scopeLabel: (scope: EgressScope) => string;
  actions: EgressNodeRowActions;
  onSort: (field: string, initialOrder: SortOrder) => void;
  onTogglePage: (checked: boolean) => void;
  onToggleNode: (node: EgressNodeDTO, checked: boolean) => void;
};

/** 出口节点表格：加载态、空态、失败重试与虚拟滚动行渲染。 */
export function EgressNodesTable(props: EgressNodesTableProps) {
  const { query, nodes, hasActiveFilters, sort, scopeLabel, actions, onSort, onTogglePage } = props;
  if (query.isError) {
    return <ErrorState message={query.error.message} onRetry={() => void query.refetch()} />;
  }
  return (
    <Table viewportRows={10} rowHeight={48} className="min-w-[920px] table-fixed" data-testid="egress-nodes-table">
      <EgressNodesTableHead
        nodes={nodes}
        sort={sort}
        allPageSelected={props.allPageSelected}
        selectedOnPage={props.selectedOnPage}
        onSort={onSort}
        onTogglePage={onTogglePage}
      />
      {query.isPending ? (
        <TableBody>
          <TableLoadingRow colSpan={9} />
        </TableBody>
      ) : null}
      {!query.isPending && nodes.length === 0 ? <EgressNodesEmptyRow hasActiveFilters={hasActiveFilters} /> : null}
      {!query.isPending && nodes.length > 0 ? (
        <VirtualTableBody
          items={nodes}
          colSpan={9}
          rowHeight={48}
          renderRow={(node) => (
            <EgressNodeRow
              key={node.id}
              node={node}
              selected={props.selected.has(node.id)}
              clearanceMode={props.clearanceMode}
              scopeLabel={scopeLabel}
              actions={actions}
              onToggle={props.onToggleNode}
            />
          )}
        />
      ) : null}
    </Table>
  );
}

function EgressNodesTableHead({
  nodes,
  sort,
  allPageSelected,
  selectedOnPage,
  onSort,
  onTogglePage,
}: {
  nodes: EgressNodeDTO[];
  sort: TableSort;
  allPageSelected: boolean;
  selectedOnPage: EgressNodeDTO[];
  onSort: (field: string, initialOrder: SortOrder) => void;
  onTogglePage: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <EgressNodesSelectAllHead
          nodes={nodes}
          allPageSelected={allPageSelected}
          selectedOnPage={selectedOnPage}
          onTogglePage={onTogglePage}
        />
        <EgressSortHead className="w-18" field="name" sort={sort} onSort={onSort}>
          {t("settings.egress.name")}
        </EgressSortHead>
        <EgressSortHead className="w-24" field="scope" align="center" sort={sort} onSort={onSort}>
          {t("settings.egress.scope")}
        </EgressSortHead>
        <EgressSortHead className="w-44" field="proxy" sort={sort} onSort={onSort}>
          {t("settings.egress.proxy")}
        </EgressSortHead>
        <EgressSortHead className="w-28" field="clearance" align="center" sort={sort} onSort={onSort}>
          {t("settings.egress.clearance")}
        </EgressSortHead>
        <TableHead className="w-14 text-center">{t("settings.egress.accounts")}</TableHead>
        <EgressNodesHealthHead sort={sort} onSort={onSort} />
        <ProbeHelpHead />
        <TableActionHead />
      </TableRow>
    </TableHeader>
  );
}

function EgressNodesSelectAllHead({
  nodes,
  allPageSelected,
  selectedOnPage,
  onTogglePage,
}: {
  nodes: EgressNodeDTO[];
  allPageSelected: boolean;
  selectedOnPage: EgressNodeDTO[];
  onTogglePage: (checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableHead className="w-10 px-2">
      <Checkbox
        checked={allPageSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false}
        disabled={nodes.length === 0}
        onCheckedChange={(checked) => onTogglePage(checked === true)}
        aria-label={t("common.selectPage")}
        data-testid="egress-nodes-select-page"
      />
    </TableHead>
  );
}

function EgressNodesHealthHead({
  sort,
  onSort,
}: {
  sort: TableSort;
  onSort: (field: string, initialOrder: SortOrder) => void;
}) {
  const { t } = useTranslation();
  return (
    <EgressSortHead
      className="w-24"
      field="health"
      align="center"
      initialOrder="desc"
      title={t("settings.egress.healthHelp")}
      sort={sort}
      onSort={onSort}
    >
      {t("settings.egress.health")}
    </EgressSortHead>
  );
}

function EgressSortHead({
  className,
  field,
  align,
  initialOrder,
  title,
  sort,
  onSort,
  children,
}: {
  className: string;
  field: string;
  align?: "left" | "center" | "right";
  initialOrder?: SortOrder;
  title?: string;
  sort: TableSort;
  onSort: (field: string, initialOrder: SortOrder) => void;
  children: ReactNode;
}) {
  return (
    <SortableTableHead
      className={className}
      field={field}
      align={align}
      initialOrder={initialOrder}
      title={title}
      sortBy={sort.field}
      sortOrder={sort.order}
      onSort={onSort}
    >
      {children}
    </SortableTableHead>
  );
}

function ProbeHelpHead() {
  const { t } = useTranslation();
  return (
    <TableHead className="w-52">
      <div className="flex items-center justify-center gap-1">
        <span>{t("settings.egress.probe")}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={t("settings.egress.probeHelp")}
            >
              <CircleHelp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80">{t("settings.egress.probeHelp")}</TooltipContent>
        </Tooltip>
      </div>
    </TableHead>
  );
}

function EgressNodesEmptyRow({ hasActiveFilters }: { hasActiveFilters: boolean }) {
  const { t } = useTranslation();
  return (
    <TableBody>
      <TableRow>
        <TableCell
          colSpan={9}
          className="h-24 text-center text-xs text-muted-foreground"
          data-testid="egress-nodes-empty"
        >
          {hasActiveFilters ? t("settings.egress.noMatches") : t("settings.egress.directFallback")}
        </TableCell>
      </TableRow>
    </TableBody>
  );
}

function EgressNodeRow({
  node,
  selected,
  clearanceMode,
  scopeLabel,
  actions,
  onToggle,
}: {
  node: EgressNodeDTO;
  selected: boolean;
  clearanceMode: ClearanceMode;
  scopeLabel: (scope: EgressScope) => string;
  actions: EgressNodeRowActions;
  onToggle: (node: EgressNodeDTO, checked: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <TableRow
      className="group h-12"
      data-state={selected ? "selected" : undefined}
      data-testid={`egress-node-row-${node.id}`}
    >
      <TableCell className="px-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onToggle(node, checked === true)}
          aria-label={t("common.selectItem", { name: node.name })}
          data-testid={`egress-node-select-${node.id}`}
        />
      </TableCell>
      <EgressNodeNameCell node={node} />
      <EgressNodeScopeCell node={node} scopeLabel={scopeLabel} />
      <EgressNodeProxyCell node={node} />
      <TableCell className="text-center">
        <ClearanceBadge node={node} clearanceMode={clearanceMode} />
      </TableCell>
      <EgressNodeCapacityCell node={node} />
      <TableCell>
        <HealthMeter nodeId={node.id} value={node.health} />
      </TableCell>
      <TableCell>
        <ProbeSummary node={node} />
      </TableCell>
      <EgressNodeActionsCell node={node} clearanceMode={clearanceMode} actions={actions} />
    </TableRow>
  );
}

function EgressNodeScopeCell({
  node,
  scopeLabel,
}: {
  node: EgressNodeDTO;
  scopeLabel: (scope: EgressScope) => string;
}) {
  return (
    <TableCell className="text-center">
      <Badge variant="secondary" className="text-[10px]" data-testid={`egress-node-scope-${node.id}`}>
        {scopeLabel(node.scope)}
      </Badge>
    </TableCell>
  );
}

function EgressNodeNameCell({ node }: { node: EgressNodeDTO }) {
  return (
    <TableCell>
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn("size-1.5 shrink-0 rounded-full", node.enabled ? "bg-emerald-500" : "bg-muted-foreground/35")}
        />
        <span
          className={cn("truncate text-xs font-medium", !node.enabled && "text-muted-foreground")}
          title={node.name}
          data-testid={`egress-node-name-${node.id}`}
        >
          {node.name}
        </span>
        {node.lastError ? <EgressErrorTooltip message={node.lastError} /> : null}
      </div>
    </TableCell>
  );
}

function EgressNodeProxyCell({ node }: { node: EgressNodeDTO }) {
  const { t } = useTranslation();
  return (
    <TableCell>
      {node.proxyConfigured ? (
        <div
          className="min-w-0"
          title={`${node.proxyDisplay || t("settings.egress.configured")} · ${node.proxyProfileName || node.proxyFingerprint || ""}`}
          data-testid={`egress-node-proxy-${node.id}`}
        >
          <p className="truncate text-xs font-medium">{node.proxyDisplay || t("settings.egress.configured")}</p>
          {node.proxyProfileId ? (
            <p className="truncate text-[10px] text-muted-foreground">
              {node.proxyProfileName || `#${node.proxyFingerprint}`}
            </p>
          ) : node.proxyFingerprint ? (
            <p className="font-mono text-[10px] text-muted-foreground">#{node.proxyFingerprint}</p>
          ) : null}
        </div>
      ) : (
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground"
          data-testid={`egress-node-proxy-direct-${node.id}`}
        >
          {t("settings.egress.direct")}
        </Badge>
      )}
    </TableCell>
  );
}

function EgressNodeCapacityCell({ node }: { node: EgressNodeDTO }) {
  return (
    <TableCell className="text-center text-xs tabular-nums" data-testid={`egress-node-accounts-${node.id}`}>
      <span className="font-medium">{node.assignedAccountCount}</span>
      {node.accountCapacity > 0 ? <span className="text-muted-foreground"> / {node.accountCapacity}</span> : null}
    </TableCell>
  );
}

function EgressNodeActionsCell({
  node,
  clearanceMode,
  actions,
}: {
  node: EgressNodeDTO;
  clearanceMode: ClearanceMode;
  actions: EgressNodeRowActions;
}) {
  const { t } = useTranslation();
  return (
    <TableActionCell>
      <DropdownMenu>
        <EgressNodeActionsTrigger nodeId={node.id} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => actions.edit(node)} data-testid={`egress-node-edit-${node.id}`}>
            <Pencil />
            {t("common.edit")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <RefreshClearanceItem node={node} clearanceMode={clearanceMode} actions={actions} />
          <DropdownMenuItem
            disabled={actions.testPending || !node.proxyConfigured}
            onClick={() => actions.test(node)}
            data-testid={`egress-node-test-${node.id}`}
          >
            <RefreshCw />
            {t("settings.egress.test")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => actions.remove(node)}
            data-testid={`egress-node-delete-${node.id}`}
          >
            <Trash2 />
            {t("common.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </TableActionCell>
  );
}

function EgressNodeActionsTrigger({ nodeId }: { nodeId: string }) {
  const { t } = useTranslation();
  return (
    <DropdownMenuTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={t("common.actions")}
        data-testid={`egress-node-actions-${nodeId}`}
      >
        <MoreHorizontal />
      </Button>
    </DropdownMenuTrigger>
  );
}

function RefreshClearanceItem({
  node,
  clearanceMode,
  actions,
}: {
  node: EgressNodeDTO;
  clearanceMode: ClearanceMode;
  actions: EgressNodeRowActions;
}) {
  const { t } = useTranslation();
  const refreshableScope =
    node.scope === "grok_web" || node.scope === "grok_web_asset" || node.scope === "grok_console";
  if (clearanceMode === "manual" || node.accountBoundProxy || !refreshableScope) return null;
  return (
    <DropdownMenuItem
      disabled={actions.clearancePending}
      onClick={() => actions.refreshClearance(node)}
      data-testid={`egress-node-refresh-clearance-${node.id}`}
    >
      <RefreshCw />
      {t("settings.egress.refreshClearance")}
    </DropdownMenuItem>
  );
}
