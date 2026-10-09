import type { TFunction } from "i18next";
import { Network, Plus, Power, PowerOff, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { EgressNodeDTO, EgressScope } from "@/features/settings/settings-api";
import { DataTableFilters, type DataTableFilter } from "@/shared/components/data-table-filters";
import { cn } from "@/shared/lib/cn";

export type EgressNodesToolbarProps = {
  search: string;
  onSearchChange: (value: string) => void;
  scopeFilter: string;
  onScopeFilterChange: (value: string) => void;
  enabledFilter: string;
  onEnabledFilterChange: (value: string) => void;
  probeFilter: string;
  onProbeFilterChange: (value: string) => void;
  assignmentFilter: string;
  onAssignmentFilterChange: (value: string) => void;
  scopeLabel: (scope: EgressScope) => string;
  selectedCount: number;
  selectedNodes: EgressNodeDTO[];
  batchPending: boolean;
  refreshing: boolean;
  cleanupPending: boolean;
  onBatchEnable: () => void;
  onBatchDisable: () => void;
  onBatchDelete: () => void;
  onOpenProfileLibrary: () => void;
  onRefresh: () => void;
  onCleanup: () => void;
  onCreate: () => void;
  onImport: () => void;
};

function scopeFilter(
  t: TFunction,
  value: string,
  onChange: (value: string) => void,
  scopeLabel: (scope: EgressScope) => string,
): DataTableFilter {
  return {
    id: "scope",
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

function enabledFilter(t: TFunction, value: string, onChange: (value: string) => void): DataTableFilter {
  return {
    id: "enabled",
    label: t("settings.egress.enabled"),
    value,
    onChange,
    options: [
      { value: "enabled", label: t("common.enable") },
      { value: "disabled", label: t("common.disable") },
    ],
  };
}

function probeFilter(t: TFunction, value: string, onChange: (value: string) => void): DataTableFilter {
  return {
    id: "probe",
    label: t("settings.egress.probe"),
    value,
    onChange,
    options: [
      { value: "healthy", label: t("settings.egress.healthy") },
      { value: "unhealthy", label: t("settings.egress.unhealthy") },
      { value: "unknown", label: t("settings.egress.notTested") },
    ],
  };
}

function assignmentFilter(t: TFunction, value: string, onChange: (value: string) => void): DataTableFilter {
  return {
    id: "assignment",
    label: t("settings.egress.accounts"),
    value,
    onChange,
    options: [
      { value: "bound", label: t("settings.egress.assigned") },
      { value: "unbound", label: t("settings.egress.unassigned") },
    ],
  };
}

/** 出口节点工具栏：搜索 + 作用域/启用/探测/账号绑定筛选，右侧为批量与全局操作。 */
export function EgressNodesToolbar(props: EgressNodesToolbarProps) {
  return (
    <>
      <EgressNodesFilterBar {...props} />
      <EgressNodesActions {...props} />
    </>
  );
}

function EgressNodesFilterBar(props: EgressNodesToolbarProps) {
  const { t } = useTranslation();
  const { scopeLabel } = props;
  return (
    <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto">
      <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-8 pl-9 text-xs"
          data-testid="egress-nodes-search"
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder={t("settings.egress.search")}
          aria-label={t("settings.egress.search")}
        />
      </div>
      <DataTableFilters
        filters={[
          scopeFilter(t, props.scopeFilter, props.onScopeFilterChange, scopeLabel),
          enabledFilter(t, props.enabledFilter, props.onEnabledFilterChange),
          probeFilter(t, props.probeFilter, props.onProbeFilterChange),
          assignmentFilter(t, props.assignmentFilter, props.onAssignmentFilterChange),
        ]}
      />
    </div>
  );
}

function EgressNodesActions(props: EgressNodesToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.selectedCount > 0 ? <EgressNodesBulkActions {...props} /> : null}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={props.onOpenProfileLibrary}
        data-testid="egress-nodes-open-profile-library"
      >
        <Network />
        {t("egressProxyProfiles.libraryTitle")}
      </Button>
      <Button
        type="button"
        size="icon"
        variant="secondary"
        className="size-8"
        disabled={props.refreshing}
        onClick={props.onRefresh}
        aria-label={t("egressProxyProfiles.refreshNodes")}
        title={t("egressProxyProfiles.refreshNodes")}
        data-testid="egress-nodes-refresh"
      >
        <RefreshCw className={cn(props.refreshing && "animate-spin")} />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={props.cleanupPending}
        onClick={props.onCleanup}
        data-testid="egress-nodes-cleanup"
      >
        <Trash2 />
        {t("settings.egress.cleanupUnavailable")}
      </Button>
      <EgressNodesAddMenu onCreate={props.onCreate} onImport={props.onImport} />
    </div>
  );
}

function EgressNodesBulkActions({
  selectedCount,
  selectedNodes,
  batchPending,
  onBatchEnable,
  onBatchDisable,
  onBatchDelete,
}: EgressNodesToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="egress-nodes-batch-actions">
      <span className="mr-1 text-xs text-muted-foreground">{t("common.selectedCount", { count: selectedCount })}</span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={batchPending || selectedNodes.every((node) => node.enabled)}
        onClick={onBatchEnable}
        data-testid="egress-nodes-batch-enable"
      >
        <Power />
        {t("common.enable")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={batchPending || selectedNodes.every((node) => !node.enabled)}
        onClick={onBatchDisable}
        data-testid="egress-nodes-batch-disable"
      >
        <PowerOff />
        {t("common.disable")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
        disabled={batchPending}
        onClick={onBatchDelete}
        data-testid="egress-nodes-batch-delete"
      >
        <Trash2 />
        {t("common.delete")}
      </Button>
    </div>
  );
}

function EgressNodesAddMenu({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="secondary" data-testid="egress-nodes-add">
          <Plus />
          {t("settings.egress.add")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onCreate} data-testid="egress-nodes-add-manual">
          <Plus />
          {t("settings.egress.addManually")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImport} data-testid="egress-nodes-add-import">
          <Upload />
          {t("settings.egress.importText")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
