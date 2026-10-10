import { ArrowRight, MoreHorizontal, Pencil, RefreshCw, RotateCw, TimerOff, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";

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
import { AccountStatus, AccountType, AccountTypeText, WebAccountType } from "@/features/accounts/account-cells";
import { AccountNameCell } from "@/features/accounts/account-name-cell";
import { AccountQuota, ConsoleQuota, WebQuota } from "@/features/accounts/account-quota";
import { AccountsPagination, AccountsToolbar } from "@/features/accounts/accounts-toolbar";
import type { SortOrder } from "@/shared/lib/table-sort";
import type { AccountDTO } from "@/features/accounts/accounts-api";
import type { AccountProvider } from "@/features/accounts/accounts-dto";
import type { AccountsPageModel } from "@/features/accounts/use-accounts-page-model";
import { WebAccountSettingsMenu } from "@/features/accounts/web-account-settings";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";

function accountTableColumns(provider: AccountProvider): ReactElement {
  return (
    <colgroup>
      <col style={{ width: "3%" }} />
      <col style={{ width: "18%" }} />
      <col style={{ width: "7%" }} />
      <col style={{ width: "7%" }} />
      <col style={{ width: provider === "grok_build" ? "27%" : "43%" }} />
      {provider === "grok_build" ? <col style={{ width: "16%" }} /> : null}
      <col style={{ width: "18%" }} />
      <col style={{ width: "4%" }} />
    </colgroup>
  );
}

function accountTypeCell(account: AccountDTO, provider: AccountProvider, consoleLabel: string): ReactElement {
  if (provider === "grok_web") return <WebAccountType tier={account.webTier} />;
  if (provider === "grok_console") return <AccountTypeText label={consoleLabel} variant="free" />;
  return <AccountType quota={account.quota} />;
}

function accountQuotaCell(account: AccountDTO, provider: AccountProvider, locale: string): ReactElement {
  if (provider === "grok_web") {
    return <WebQuota windows={account.quotaWindows ?? []} locale={locale} tier={account.webTier} />;
  }
  if (provider === "grok_console") return <ConsoleQuota windows={account.quotaWindows ?? []} locale={locale} />;
  return <AccountQuota quota={account.quota} billing={account.billing} locale={locale} />;
}

function AccountCredentialCell({ account, locale }: { account: AccountDTO; locale: string }): ReactElement {
  const { t } = useTranslation();
  if (!account.refreshable) {
    return (
      <span className="font-medium text-amber-700 dark:text-amber-300">{t("accountCredential.noAutoRefresh")}</span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="cursor-help font-medium text-emerald-700 dark:text-emerald-300">
          {t("accountCredential.autoRefresh")}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {account.expiresAt
          ? t("accountCredential.expiresAt", { time: formatDateTime(account.expiresAt, locale) })
          : t("accountCredential.expiryUnknown")}
      </TooltipContent>
    </Tooltip>
  );
}

function AccountRow({ account, model }: { account: AccountDTO; model: AccountsPageModel }): ReactElement {
  const { t, language } = model;
  const { provider } = model.filters;
  const { selected, toggleAccount } = model.selection;
  return (
    <TableRow
      className="group h-14 [&>td]:py-1.5"
      key={account.id}
      data-state={selected.has(account.id) ? "selected" : undefined}
    >
      <TableCell className="px-2">
        <Checkbox
          checked={selected.has(account.id)}
          onCheckedChange={(checked) => toggleAccount(account.id, checked === true)}
          aria-label={t("common.selectItem", { name: account.name })}
        />
      </TableCell>
      <TableCell className="min-w-0">
        <AccountNameCell account={account} />
      </TableCell>
      <TableCell className="text-center whitespace-nowrap">
        {accountTypeCell(account, provider, t("accountType.console"))}
      </TableCell>
      <TableCell className="text-center whitespace-nowrap">
        <AccountStatus account={account} />
      </TableCell>
      <TableCell className={provider === "grok_build" ? undefined : "px-6"}>
        {accountQuotaCell(account, provider, language)}
      </TableCell>
      {provider === "grok_build" ? (
        <TableCell className="whitespace-nowrap pl-4 text-xs">
          <AccountCredentialCell account={account} locale={language} />
        </TableCell>
      ) : null}
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
        {formatDateTime(account.createdAt, language)}
      </TableCell>
      <TableActionCell>
        <AccountRowActions account={account} model={model} />
      </TableActionCell>
    </TableRow>
  );
}

function AccountsTableBody({ model }: { model: AccountsPageModel }): ReactElement {
  const { provider } = model.filters;
  const colSpan = provider === "grok_build" ? 8 : 7;
  if (model.list.query.isPending) {
    return (
      <TableBody>
        <TableLoadingRow colSpan={colSpan} />
      </TableBody>
    );
  }
  return (
    <VirtualTableBody
      items={model.result?.items ?? []}
      colSpan={colSpan}
      rowHeight={56}
      renderRow={(account) => <AccountRow account={account} model={model} key={account.id} />}
    />
  );
}

export function AccountsTableSection({ model }: { model: AccountsPageModel }): ReactElement {
  const query = model.list.query;
  const result = model.result;
  return (
    <DataTableShell toolbar={<AccountsToolbar model={model} />} footer={<AccountsPagination model={model} />}>
      {query.isError ? <ErrorState message={query.error.message} onRetry={() => void query.refetch()} /> : null}
      {result && result.items.length === 0 ? <EmptyState /> : null}
      {query.isPending || (result && result.items.length > 0) ? <AccountsTable model={model} /> : null}
    </DataTableShell>
  );
}

function AccountsTable({ model }: { model: AccountsPageModel }): ReactElement {
  return (
    <Table
      viewportRows={20}
      rowHeight={56}
      className="table-fixed border-collapse min-w-[780px] xl:min-w-[960px] 2xl:min-w-[1080px]"
    >
      {accountTableColumns(model.filters.provider)}
      <AccountsTableHeader model={model} />
      <AccountsTableBody model={model} />
    </Table>
  );
}
function AccountRowCredentialItems({
  account,
  model,
}: {
  account: AccountDTO;
  model: AccountsPageModel;
}): ReactElement {
  const { t } = model;
  const rows = model.records.rows;
  const coolingDown = Boolean(account.cooldownUntil) && new Date(account.cooldownUntil ?? 0) > new Date();
  return (
    <>
      {model.filters.provider === "grok_build" ? (
        <DropdownMenuItem onClick={() => rows.refreshToken(account.id)}>
          <RotateCw />
          {t("accounts.refreshToken")}
        </DropdownMenuItem>
      ) : null}
      {coolingDown ? (
        <DropdownMenuItem onClick={() => rows.clearCooldown(account.id)} disabled={rows.cooldownPending}>
          <TimerOff />
          {t("accounts.clearCooldown")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

function AccountRowRefreshQuotaItem({
  account,
  model,
}: {
  account: AccountDTO;
  model: AccountsPageModel;
}): ReactElement {
  const { t } = model;
  const rows = model.records.rows;
  const buildPool = model.filters.provider === "grok_build";
  return (
    <DropdownMenuItem onClick={() => (buildPool ? rows.refreshBilling(account.id) : rows.refreshQuota(account.id))}>
      <RefreshCw />
      {buildPool ? t("accounts.refreshBilling") : t("accounts.refreshModeQuota")}
    </DropdownMenuItem>
  );
}

function AccountRowActions({ account, model }: { account: AccountDTO; model: AccountsPageModel }): ReactElement {
  const { t } = model;
  const webPool = model.filters.provider === "grok_web";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8" aria-label={t("common.actions")}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => model.records.edit.beginEdit(account)}>
          <Pencil />
          {t("common.edit")}
        </DropdownMenuItem>
        {webPool ? (
          <DropdownMenuItem onClick={() => model.tasks.conversion.openDialog([account.id])}>
            <ArrowRight />
            {t("accountConversion.action")}
          </DropdownMenuItem>
        ) : null}
        {webPool ? (
          <WebAccountSettingsMenu
            account={account}
            disabled={model.bulkTaskPending}
            onConfirm={model.records.rows.confirmation.onTargetChange}
          />
        ) : null}
        <AccountRowCredentialItems account={account} model={model} />
        <AccountRowRefreshQuotaItem account={account} model={model} />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => model.records.remove.openDelete(account)}
        >
          <Trash2 />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type AccountSortableHeadProps = {
  model: AccountsPageModel;
  field: string;
  label: string;
  align?: "left" | "center" | "right";
  className?: string;
  initialOrder?: SortOrder;
};

function AccountSortableHead({
  model,
  field,
  label,
  align,
  className,
  initialOrder,
}: AccountSortableHeadProps): ReactElement {
  return (
    <SortableTableHead
      field={field}
      sortBy={model.filters.sort.field}
      sortOrder={model.filters.sort.order}
      align={align}
      initialOrder={initialOrder}
      onSort={model.filters.changeSort}
      className={className}
    >
      {label}
    </SortableTableHead>
  );
}

function AccountsTableHeader({ model }: { model: AccountsPageModel }): ReactElement {
  const { t, filters } = model;
  return (
    <TableHeader>
      <TableRow className="hover:bg-transparent">
        <TableHead className="px-2">
          <Checkbox
            checked={model.allPageSelected ? true : model.selectedOnPageIds.length > 0 ? "indeterminate" : false}
            onCheckedChange={(checked) => model.selection.togglePage(model.pageIds, checked === true)}
            aria-label={t("common.selectPage")}
          />
        </TableHead>
        <AccountSortableHead model={model} field="name" label={t("accounts.account")} />
        <AccountSortableHead
          model={model}
          field="type"
          label={t("accountType.label")}
          align="center"
          className="whitespace-nowrap"
        />
        <AccountSortableHead
          model={model}
          field="status"
          label={t("accounts.status")}
          align="center"
          className="whitespace-nowrap"
        />
        <TableHead className={cn("whitespace-nowrap", filters.provider !== "grok_build" && "px-6")}>
          {t("accounts.quota")}
        </TableHead>
        {filters.provider === "grok_build" ? (
          <TableHead className="whitespace-nowrap pl-4">{t("accountCredential.label")}</TableHead>
        ) : null}
        <AccountSortableHead
          model={model}
          field="createdAt"
          label={t("accounts.createdAt")}
          initialOrder="desc"
          className="whitespace-nowrap"
        />
        <TableActionHead />
      </TableRow>
    </TableHeader>
  );
}
