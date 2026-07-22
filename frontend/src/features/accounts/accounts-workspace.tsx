import type { UseQueryResult } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import {
  ArrowRight,
  History,
  MoreHorizontal,
  Network,
  Pencil,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
} from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AccountNameCell } from "@/features/accounts/account-name-cell";
import {
  AccountStatus,
  AccountType,
  AccountTypeText,
  WebAccountType,
} from "@/features/accounts/account-presentation";
import { AccountProviderToolbar } from "@/features/accounts/account-provider-toolbar";
import { AccountQuota, ConsoleQuota, WebQuota } from "@/features/accounts/account-quota";
import type {
  AccountCleanupStatus,
  AccountDTO,
  AccountProvider,
} from "@/features/accounts/accounts-api";
import {
  type WebAccountConfirmationTarget,
  WebAccountSettingsMenu,
} from "@/features/accounts/web-account-settings";
import type { PaginatedDTO } from "@/shared/api/client";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { Pagination } from "@/shared/components/pagination";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { cn } from "@/shared/lib/cn";
import { formatDateTime } from "@/shared/lib/format";
import type { SortOrder, TableSort } from "@/shared/lib/table-sort";

type ValueMutation<T> = { mutate: (value: T) => void };
type VoidMutation = { mutate: () => void };

type AccountsWorkspaceProps = {
  t: TFunction;
  i18n: { language: string };
  provider: AccountProvider;
  changeProvider: (provider: AccountProvider) => void;
  bulkTaskPending: boolean;
  hasProviderAccounts: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  startDeviceLogin: () => Promise<void>;
  setQuickImportOpen: Dispatch<SetStateAction<boolean>>;
  importMutation: ValueMutation<File[]>;
  setExportOpen: Dispatch<SetStateAction<boolean>>;
  search: string;
  setSearch: Dispatch<SetStateAction<string>>;
  setPage: Dispatch<SetStateAction<number>>;
  typeFilter: string;
  setTypeFilter: Dispatch<SetStateAction<string>>;
  statusFilter: string;
  setStatusFilter: Dispatch<SetStateAction<string>>;
  renewalFilter: string;
  setRenewalFilter: Dispatch<SetStateAction<string>>;
  riskFilter: string;
  setRiskFilter: Dispatch<SetStateAction<string>>;
  selected: Set<string>;
  selectedOnPage: string[];
  allPageSelected: boolean;
  togglePage: (checked: boolean) => void;
  toggleAccount: (id: string, checked: boolean) => void;
  batchUpdateMutation: ValueMutation<boolean>;
  openWebConversion: (targets: string[] | "all") => void;
  setWebAccountScriptsTargets: Dispatch<SetStateAction<string[] | "all" | null>>;
  batchBillingMutation: VoidMutation;
  batchTokenMutation: VoidMutation;
  setBatchDeleteOpen: Dispatch<SetStateAction<boolean>>;
  setSyncAllOpen: Dispatch<SetStateAction<boolean>>;
  setRenewAllOpen: Dispatch<SetStateAction<boolean>>;
  setCleanupStatuses: Dispatch<SetStateAction<Set<AccountCleanupStatus>>>;
  setCleanupOpen: Dispatch<SetStateAction<boolean>>;
  result: PaginatedDTO<AccountDTO> | undefined;
  setPageSize: Dispatch<SetStateAction<number>>;
  accountsQuery: Pick<
    UseQueryResult<PaginatedDTO<AccountDTO>, Error>,
    "isError" | "error" | "isPending" | "refetch"
  >;
  sort: TableSort;
  changeSort: (field: string, initialOrder: SortOrder) => void;
  beginEdit: (account: AccountDTO) => void;
  setStateHistoryAccount: Dispatch<SetStateAction<AccountDTO | null>>;
  setEgressPolicyAccount: Dispatch<SetStateAction<AccountDTO | null>>;
  setWebConfirmationTarget: Dispatch<SetStateAction<WebAccountConfirmationTarget | null>>;
  tokenMutation: ValueMutation<string>;
  billingMutation: ValueMutation<string>;
  quotaMutation: ValueMutation<string>;
  setDeleting: Dispatch<SetStateAction<AccountDTO | null>>;
};

export function AccountsWorkspace(props: AccountsWorkspaceProps) {
  const {
    t,
    i18n,
    provider,
    changeProvider,
    bulkTaskPending,
    hasProviderAccounts,
    fileInputRef,
    startDeviceLogin,
    setQuickImportOpen,
    importMutation,
    setExportOpen,
    search,
    setSearch,
    setPage,
    typeFilter,
    setTypeFilter,
    statusFilter,
    setStatusFilter,
    renewalFilter,
    setRenewalFilter,
    riskFilter,
    setRiskFilter,
    selected,
    selectedOnPage,
    allPageSelected,
    togglePage,
    toggleAccount,
    batchUpdateMutation,
    openWebConversion,
    setWebAccountScriptsTargets,
    batchBillingMutation,
    batchTokenMutation,
    setBatchDeleteOpen,
    setSyncAllOpen,
    setRenewAllOpen,
    setCleanupStatuses,
    setCleanupOpen,
    result,
    setPageSize,
    accountsQuery,
    sort,
    changeSort,
    beginEdit,
    setStateHistoryAccount,
    setEgressPolicyAccount,
    setWebConfirmationTarget,
    tokenMutation,
    billingMutation,
    quotaMutation,
    setDeleting,
  } = props;

  return (
    <div className="space-y-5">
      <AccountProviderToolbar
        provider={provider}
        pending={bulkTaskPending}
        hasAccounts={hasProviderAccounts}
        fileInputRef={fileInputRef}
        onProviderChange={changeProvider}
        onDeviceLogin={() => void startDeviceLogin()}
        onQuickImport={() => setQuickImportOpen(true)}
        onImportFiles={(files) => importMutation.mutate(files)}
        onExport={() => setExportOpen(true)}
      />

      <DataTableShell
        toolbar={
          <>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-9 text-xs"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t("accounts.search")}
                  aria-label={t("accounts.search")}
                />
              </div>
              <DataTableFilters
                filters={[
                  ...(provider === "grok_console"
                    ? []
                    : [
                        {
                          id: "type",
                          label: t("accountType.label"),
                          value: typeFilter,
                          onChange: (value: string) => {
                            setTypeFilter(value);
                            setPage(1);
                          },
                          options:
                            provider === "grok_web"
                              ? [
                                  {
                                    value: "auto",
                                    label: t("accountType.auto"),
                                  },
                                  {
                                    value: "basic",
                                    label: t("accountType.free"),
                                  },
                                  {
                                    value: "super",
                                    label: t("accountType.super"),
                                  },
                                  {
                                    value: "heavy",
                                    label: t("accountType.heavy"),
                                  },
                                ]
                              : [
                                  {
                                    value: "free",
                                    label: t("accountType.free"),
                                  },
                                  {
                                    value: "paid",
                                    label: t("accountType.paid"),
                                  },
                                  {
                                    value: "unknown",
                                    label: t("accountType.pending"),
                                  },
                                ],
                        },
                      ]),
                  {
                    id: "status",
                    label: t("accounts.status"),
                    value: statusFilter,
                    onChange: (value) => {
                      setStatusFilter(value);
                      setPage(1);
                    },
                    options: [
                      { value: "active", label: t("accounts.statusActive") },
                      {
                        value: "disabled",
                        label: t("accounts.statusDisabled"),
                      },
                      {
                        value: "reauthRequired",
                        label: t("accounts.statusReauthRequired"),
                      },
                      {
                        value: "cooldown",
                        label: t("accounts.statusCooldown"),
                      },
                      {
                        value: "waitingReset",
                        label: t("accounts.waitingReset"),
                      },
                      { value: "probing", label: t("accounts.probing") },
                    ],
                  },
                  ...(provider === "grok_build"
                    ? [
                        {
                          id: "renewal",
                          label: t("accountCredential.label"),
                          value: renewalFilter,
                          onChange: (value: string) => {
                            setRenewalFilter(value);
                            setPage(1);
                          },
                          options: [
                            {
                              value: "refreshable",
                              label: t("accountCredential.autoRefresh"),
                            },
                            {
                              value: "unrefreshable",
                              label: t("accountCredential.noAutoRefresh"),
                            },
                          ],
                        },
                      ]
                    : []),
                  ...(provider === "grok_build"
                    ? [
                        {
                          id: "risk",
                          label: t("accounts.riskFilter"),
                          value: riskFilter,
                          onChange: (value: string) => {
                            setRiskFilter(value);
                            setPage(1);
                          },
                          options: [
                            {
                              value: "flagged",
                              label: t("accounts.botRisk"),
                            },
                            {
                              value: "normal",
                              label: t("accounts.riskNormal"),
                            },
                          ],
                        },
                      ]
                    : []),
                ]}
              />
            </div>
            {selected.size > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted-foreground">
                  {t("common.selectedCount", { count: selected.size })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={bulkTaskPending}
                  onClick={() => batchUpdateMutation.mutate(true)}
                >
                  {t("common.enable")}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={bulkTaskPending}
                  onClick={() => batchUpdateMutation.mutate(false)}
                >
                  {t("common.disable")}
                </Button>
                {provider === "grok_web" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => openWebConversion([...selected])}
                  >
                    {t("accountConversion.action")}
                  </Button>
                ) : null}
                {provider === "grok_web" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => setWebAccountScriptsTargets([...selected])}
                  >
                    {t("webAccountScripts.action")}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={bulkTaskPending}
                  onClick={() => batchBillingMutation.mutate()}
                >
                  {t("accountCredential.quotaSyncAction")}
                </Button>
                {provider === "grok_build" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => batchTokenMutation.mutate()}
                  >
                    {t("accountCredential.refreshAction")}
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                  disabled={bulkTaskPending}
                  onClick={() => setBatchDeleteOpen(true)}
                >
                  {t("common.delete")}
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                {provider === "grok_web" && hasProviderAccounts ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => openWebConversion("all")}
                  >
                    {t("accountConversion.action")}
                  </Button>
                ) : null}
                {provider === "grok_web" && hasProviderAccounts ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => setWebAccountScriptsTargets("all")}
                  >
                    {t("webAccountScripts.action")}
                  </Button>
                ) : null}
                {hasProviderAccounts ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => setSyncAllOpen(true)}
                  >
                    {t("accountCredential.quotaSyncAction")}
                  </Button>
                ) : null}
                {hasProviderAccounts && provider === "grok_build" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={bulkTaskPending}
                    onClick={() => setRenewAllOpen(true)}
                  >
                    {t("accountCredential.refreshAction")}
                  </Button>
                ) : null}
                {hasProviderAccounts ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
                    disabled={bulkTaskPending}
                    onClick={() => {
                      setCleanupStatuses(new Set());
                      setCleanupOpen(true);
                    }}
                  >
                    <Trash2 />
                    {t("accounts.cleanupAction")}
                  </Button>
                ) : null}
              </div>
            )}
          </>
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
        {accountsQuery.isError ? (
          <ErrorState
            message={accountsQuery.error?.message ?? t("errors.generic")}
            onRetry={() => void accountsQuery.refetch()}
          />
        ) : null}
        {result && result.items.length === 0 ? <EmptyState /> : null}
        {accountsQuery.isPending || (result && result.items.length > 0) ? (
          <Table
            viewportRows={20}
            rowHeight={56}
            className="table-fixed border-collapse min-w-[780px] xl:min-w-[960px] 2xl:min-w-[1080px]"
          >
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
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="px-2">
                  <Checkbox
                    checked={
                      allPageSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false
                    }
                    onCheckedChange={(checked) => togglePage(checked === true)}
                    aria-label={t("common.selectPage")}
                  />
                </TableHead>
                <SortableTableHead
                  field="name"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("accounts.account")}
                </SortableTableHead>
                <SortableTableHead
                  field="type"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                  className="whitespace-nowrap"
                >
                  {t("accountType.label")}
                </SortableTableHead>
                <SortableTableHead
                  field="status"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                  className="whitespace-nowrap"
                >
                  {t("accounts.status")}
                </SortableTableHead>
                <TableHead className={cn("whitespace-nowrap", provider !== "grok_build" && "px-6")}>
                  {t("accounts.quota")}
                </TableHead>
                {provider === "grok_build" ? (
                  <TableHead className="whitespace-nowrap pl-4">
                    {t("accountCredential.label")}
                  </TableHead>
                ) : null}
                <SortableTableHead
                  field="createdAt"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                  className="whitespace-nowrap"
                >
                  {t("accounts.createdAt")}
                </SortableTableHead>
                <TableActionHead />
              </TableRow>
            </TableHeader>
            {accountsQuery.isPending ? (
              <TableBody>
                <TableLoadingRow colSpan={provider === "grok_build" ? 8 : 7} />
              </TableBody>
            ) : (
              <VirtualTableBody
                items={result?.items ?? []}
                colSpan={provider === "grok_build" ? 8 : 7}
                rowHeight={56}
                renderRow={(account) => (
                  <TableRow
                    className="group h-14 [&>td]:py-1.5"
                    key={account.id}
                    data-state={selected.has(account.id) ? "selected" : undefined}
                  >
                    <TableCell className="px-2">
                      <Checkbox
                        checked={selected.has(account.id)}
                        onCheckedChange={(checked) => toggleAccount(account.id, checked === true)}
                        aria-label={t("common.selectItem", {
                          name: account.name,
                        })}
                      />
                    </TableCell>
                    <TableCell className="min-w-0">
                      <AccountNameCell account={account} />
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      {provider === "grok_web" ? (
                        <WebAccountType tier={account.webTier} />
                      ) : provider === "grok_console" ? (
                        <AccountTypeText label={t("accountType.console")} variant="free" />
                      ) : (
                        <AccountType quota={account.quota} />
                      )}
                    </TableCell>
                    <TableCell className="text-center whitespace-nowrap">
                      <AccountStatus account={account} />
                    </TableCell>
                    <TableCell className={provider === "grok_build" ? undefined : "px-6"}>
                      {provider === "grok_web" ? (
                        <WebQuota
                          windows={account.quotaWindows ?? []}
                          locale={i18n.language}
                          tier={account.webTier}
                        />
                      ) : provider === "grok_console" ? (
                        <ConsoleQuota windows={account.quotaWindows ?? []} locale={i18n.language} />
                      ) : (
                        <AccountQuota
                          quota={account.quota}
                          billing={account.billing}
                          locale={i18n.language}
                        />
                      )}
                    </TableCell>
                    {provider === "grok_build" ? (
                      <TableCell className="whitespace-nowrap pl-4 text-xs">
                        {account.refreshable ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                tabIndex={0}
                                className="cursor-help font-medium text-emerald-700 dark:text-emerald-300"
                              >
                                {t("accountCredential.autoRefresh")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {account.expiresAt
                                ? t("accountCredential.expiresAt", {
                                    time: formatDateTime(account.expiresAt, i18n.language),
                                  })
                                : t("accountCredential.expiryUnknown")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="font-medium text-amber-700 dark:text-amber-300">
                            {t("accountCredential.noAutoRefresh")}
                          </span>
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(account.createdAt, i18n.language)}
                    </TableCell>
                    <TableActionCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={t("common.actions")}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => beginEdit(account)}>
                            <Pencil />
                            {t("common.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setStateHistoryAccount(account)}>
                            <History />
                            {t("accounts.stateHistory")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEgressPolicyAccount(account)}>
                            <Network />
                            {t("accounts.egressPolicy")}
                          </DropdownMenuItem>
                          {provider === "grok_web" ? (
                            <DropdownMenuItem onClick={() => openWebConversion([account.id])}>
                              <ArrowRight />
                              {t("accountConversion.action")}
                            </DropdownMenuItem>
                          ) : null}
                          {provider === "grok_web" ? (
                            <WebAccountSettingsMenu
                              account={account}
                              disabled={bulkTaskPending}
                              onConfirm={setWebConfirmationTarget}
                            />
                          ) : null}
                          {provider === "grok_build" ? (
                            <DropdownMenuItem onClick={() => tokenMutation.mutate(account.id)}>
                              <RotateCw />
                              {t("accounts.refreshToken")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onClick={() =>
                              provider === "grok_build"
                                ? billingMutation.mutate(account.id)
                                : quotaMutation.mutate(account.id)
                            }
                          >
                            <RefreshCw />
                            {provider === "grok_build"
                              ? t("accounts.refreshBilling")
                              : t("accounts.refreshModeQuota")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleting(account)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableActionCell>
                  </TableRow>
                )}
              />
            )}
          </Table>
        ) : null}
      </DataTableShell>
    </div>
  );
}
