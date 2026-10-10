import {
  ClipboardPaste,
  Compass,
  Download,
  ExternalLink,
  FileUp,
  Plus,
  Search,
  SquareTerminal,
  Trash2,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { useRef, type ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { buildAccountFilterDescriptors } from "@/features/accounts/accounts-filter-descriptors";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import type { Translate } from "@/features/accounts/accounts-view-model";
import type { AccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { Pagination } from "@/shared/components/pagination";

type AccountToolbarAction = {
  id: string;
  label: string;
  icon?: LucideIcon;
  destructive?: boolean;
  onClick: () => void;
};

const destructiveButtonClass = "bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive";

function importMenuLabel(t: Translate, provider: AccountProvider): string {
  if (provider === "grok_build") return t("accounts.importAuth");
  if (provider === "grok_console") return t("console.importFile");
  return t("accounts.importWebFile");
}

function accountProviderTabs(model: AccountsPageModel): ReactElement {
  return (
    <Tabs value={model.filters.provider} onValueChange={(value) => model.changeProvider(value as AccountProvider)}>
      <TabsList>
        <TabsTrigger value="grok_build" className="gap-1.5">
          <SquareTerminal className="size-3.5 text-quota-product-1" />
          <span>Grok Build</span>
        </TabsTrigger>
        <TabsTrigger value="grok_web" className="gap-1.5">
          <Compass className="size-3.5 text-quota-product-2" />
          <span>Grok Web</span>
        </TabsTrigger>
        <TabsTrigger value="grok_console" className="gap-1.5">
          <Webhook className="size-3.5 text-quota-product-4" />
          <span>Grok Console</span>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function AccountsConnectMenu({ model }: { model: AccountsPageModel }): ReactElement {
  const { t, filters, tasks } = model;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm">
          <Plus />
          {t("accounts.connectAccount")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {filters.provider === "grok_build" ? (
          <DropdownMenuItem onClick={tasks.device.login}>
            <ExternalLink />
            {t("accounts.deviceLogin")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem disabled={model.bulkTaskPending} onClick={tasks.importFlow.openQuickImport}>
          <ClipboardPaste />
          {t(filters.provider === "grok_build" ? "accounts.quickImportRT" : "accounts.quickImportSSO")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={model.bulkTaskPending} onClick={() => fileInputRef.current?.click()}>
          <FileUp />
          {importMenuLabel(t, filters.provider)}
        </DropdownMenuItem>
        {model.hasProviderAccounts ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={tasks.exportFlow.openProviderExport}>
              <Download />
              {t("accounts.exportAuth")}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="application/json,text/plain,.json,.txt"
        className="hidden"
        onChange={(event) => {
          tasks.importFlow.importFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
    </DropdownMenu>
  );
}

function AccountsSearchInput({ model }: { model: AccountsPageModel }): ReactElement {
  const { t, filters } = model;
  return (
    <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        className="h-8 pl-9 text-xs"
        value={filters.search}
        onChange={(event) => filters.changeSearch(event.target.value)}
        placeholder={t("accounts.search")}
        aria-label={t("accounts.search")}
      />
    </div>
  );
}

function AccountsFilterFields({ model }: { model: AccountsPageModel }): ReactElement {
  const { t, filters, tasks } = model;
  return (
    <DataTableFilters
      filters={buildAccountFilterDescriptors({
        t,
        provider: filters.provider,
        values: filters.filterValues,
        onChange: filters.filterChanges,
        egressGroups: tasks.egressGroups,
        egressGroupSearch: {
          value: filters.egressFilterOptionsSearch,
          onChange: filters.setEgressFilterOptionsSearch,
        },
        onEgressGroupsOpenChange: filters.setEgressFilterOptionsOpen,
        onEgressLabelChange: filters.setEgressFilterSelectedLabel,
      })}
    />
  );
}

function selectedActionItems(model: AccountsPageModel): AccountToolbarAction[] {
  const { t, filters, tasks, records } = model;
  const items: AccountToolbarAction[] = [
    { id: "export", label: t("accounts.exportAuth"), icon: Download, onClick: tasks.exportFlow.openSelectedExport },
    { id: "enable", label: t("common.enable"), onClick: records.batch.onEnableSelected },
    { id: "disable", label: t("common.disable"), onClick: records.batch.onDisableSelected },
    { id: "concurrency", label: t("accounts.batchSetConcurrency"), onClick: records.batch.onOpenConcurrency },
    { id: "egress", label: t("accounts.egressConfiguration"), onClick: tasks.egress.openDialog },
  ];
  if (filters.provider === "grok_web") {
    const ids = model.selection.selectedIds;
    items.push({
      id: "convert",
      label: t("accountConversion.action"),
      onClick: () => tasks.conversion.openDialog(ids),
    });
    items.push({ id: "scripts", label: t("webAccountScripts.action"), onClick: () => tasks.scripts.openDialog(ids) });
  }
  if (filters.provider === "grok_build") {
    items.push({
      id: "detect",
      label: t("accountCredential.detectAction"),
      onClick: () => tasks.detect.openDialog("selected"),
    });
  }
  items.push({ id: "quota", label: t("accountCredential.quotaSyncAction"), onClick: records.batch.onOpenQuotaSync });
  if (filters.provider === "grok_build") {
    items.push({
      id: "tokens",
      label: t("accountCredential.refreshAction"),
      onClick: records.batch.onRefreshSelectedTokens,
    });
  }
  items.push({
    id: "delete",
    label: t("common.delete"),
    destructive: true,
    onClick: records.remove.openBatchDelete,
  });
  return items;
}

function poolActionItems(model: AccountsPageModel): AccountToolbarAction[] {
  const { t, filters, tasks } = model;
  const items: AccountToolbarAction[] = [];
  if (!model.hasProviderAccounts) return items;
  if (filters.provider === "grok_web") {
    items.push({
      id: "convert-all",
      label: t("accountConversion.action"),
      onClick: () => tasks.conversion.openDialog("all"),
    });
    items.push({
      id: "scripts-all",
      label: t("webAccountScripts.action"),
      onClick: () => tasks.scripts.openDialog("all"),
    });
  }
  if (filters.provider === "grok_build") {
    items.push({
      id: "detect-all",
      label: t("accountCredential.detectAction"),
      onClick: () => tasks.detect.openDialog("all"),
    });
  }
  items.push({
    id: "quota-all",
    label: t("accountCredential.quotaSyncAction"),
    onClick: () => tasks.quotaSync.openDialog("sync"),
  });
  if (filters.provider === "grok_build") {
    items.push({ id: "renew-all", label: t("accountCredential.refreshAction"), onClick: tasks.renewal.openDialog });
  }
  items.push({
    id: "cleanup",
    label: t("accounts.cleanupAction"),
    icon: Trash2,
    destructive: true,
    onClick: tasks.cleanup.openDialog,
  });
  return items;
}

function AccountActionButton({ item, disabled }: { item: AccountToolbarAction; disabled: boolean }): ReactElement {
  const Icon = item.icon;
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      className={item.destructive ? destructiveButtonClass : undefined}
      onClick={item.onClick}
    >
      {Icon ? <Icon /> : null}
      {item.label}
    </Button>
  );
}

function AccountsSelectedActions({ model }: { model: AccountsPageModel }): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-muted-foreground">
        {model.t("common.selectedCount", { count: model.selection.selectedIds.length })}
      </span>
      {selectedActionItems(model).map((item) => (
        <AccountActionButton key={item.id} item={item} disabled={model.bulkTaskPending} />
      ))}
    </div>
  );
}

function AccountsPoolActions({ model }: { model: AccountsPageModel }): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {poolActionItems(model).map((item) => (
        <AccountActionButton key={item.id} item={item} disabled={model.bulkTaskPending} />
      ))}
    </div>
  );
}

/** 列表工具栏：账号池切换、导入/导出入口、搜索、筛选与批量动作。 */
export function AccountsToolbar({ model }: { model: AccountsPageModel }): ReactElement {
  return (
    <>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <AccountsSearchInput model={model} />
        <AccountsFilterFields model={model} />
      </div>
      {model.selection.selectedIds.length > 0 ? (
        <AccountsSelectedActions model={model} />
      ) : (
        <AccountsPoolActions model={model} />
      )}
    </>
  );
}

export function AccountsPagination({ model }: { model: AccountsPageModel }): ReactElement | undefined {
  const result = model.result;
  if (!result || result.total <= 0) return undefined;
  return (
    <Pagination
      page={result.page}
      pageSize={result.pageSize}
      total={result.total}
      onPageChange={model.filters.setPage}
      onPageSizeChange={model.filters.changePageSize}
    />
  );
}

export function AccountsTabsRow({ model }: { model: AccountsPageModel }): ReactElement {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      {accountProviderTabs(model)}
      <AccountsConnectMenu model={model} />
    </div>
  );
}
