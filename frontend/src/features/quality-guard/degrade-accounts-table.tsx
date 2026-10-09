import type { TFunction } from "i18next";
import { PowerOff, RefreshCw, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DegradeAccountDTO, DegradeSummaryDTO } from "@/features/quality-guard/quality-guard-api";
import type { DegradeAccountsController, DegradeFilters } from "@/features/quality-guard/use-degrade-accounts";
import { EmptyState } from "@/shared/components/data-state";
import { Pagination } from "@/shared/components/pagination";
import { cn } from "@/shared/lib/cn";
import { formatCompactDateTime } from "@/shared/lib/format";

// 降级账号列表卡片：从 degrade-accounts-panel.tsx 拆出。筛选控件、列顺序、提示文案与分页行为保持不变。

function classSummary(classes: DegradeAccountDTO["classes"]): string {
  return (
    [
      classes.missing_thinking ? `thinking ${classes.missing_thinking}` : "",
      classes.buffered_burst ? `burst ${classes.buffered_burst}` : "",
      classes.soft_tps ? `soft ${classes.soft_tps}` : "",
      classes.hard_tps ? `hard ${classes.hard_tps}` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "-"
  );
}

type FilterSelectSpec = { value: string; onChange: (value: string) => void; items: string[][] };

function degradeFilterSpecs(filters: DegradeFilters, t: TFunction): FilterSelectSpec[] {
  return [
    {
      value: filters.period,
      onChange: (value) => filters.setPeriod(value as DegradeSummaryDTO["window"]),
      items: [
        ["1h", t("qualityGuard.degrade.windows.1h")],
        ["6h", t("qualityGuard.degrade.windows.6h")],
        ["24h", t("qualityGuard.degrade.windows.24h")],
        ["7d", t("qualityGuard.degrade.windows.7d")],
      ],
    },
    {
      value: filters.status,
      onChange: (value) => filters.setStatus(value as DegradeFilters["status"]),
      items: [
        ["all", t("qualityGuard.degrade.statusAll")],
        ["enabled", t("qualityGuard.degrade.statusOn")],
        ["disabled", t("qualityGuard.degrade.statusOff")],
        ["deleted", t("qualityGuard.degrade.statusDeleted")],
      ],
    },
    {
      value: filters.cls,
      onChange: (value) => filters.setCls(value as DegradeFilters["cls"]),
      items: [
        ["all", t("qualityGuard.degrade.classAll")],
        ["missing_thinking", t("qualityGuard.degrade.classThinking")],
        ["buffered_burst", "burst"],
        ["soft_tps", "soft"],
        ["hard_tps", "hard"],
      ],
    },
    {
      value: String(filters.hitsMin),
      onChange: (value) => filters.setHitsMin(Number(value)),
      items: [
        ["1", t("qualityGuard.degrade.hitsAll")],
        ["2", t("qualityGuard.degrade.hitsMin", { count: 2 })],
        ["3", t("qualityGuard.degrade.hitsMin", { count: 3 })],
        ["5", t("qualityGuard.degrade.hitsMin", { count: 5 })],
        ["10", t("qualityGuard.degrade.hitsMin", { count: 10 })],
      ],
    },
  ];
}

function FilterSelect({ value, onChange, items, testId }: FilterSelectSpec & { testId: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 w-auto min-w-28" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map(([itemValue, label]) => (
          <SelectItem key={itemValue} value={itemValue}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DegradeFilterSelects({ filters }: { filters: DegradeFilters }) {
  const { t } = useTranslation();
  const ids = ["window", "status", "class", "hits"];
  return (
    <>
      {degradeFilterSpecs(filters, t).map((spec, index) => (
        <FilterSelect key={ids[index]} testId={`degrade-filter-${ids[index]}`} {...spec} />
      ))}
    </>
  );
}

function DegradeAccountStatusCell({ account, locale }: { account: DegradeAccountDTO; locale: string }) {
  const { t } = useTranslation();
  return (
    <TableCell className="whitespace-nowrap">
      {!account.found ? (
        <Badge variant="outline" className="whitespace-nowrap text-muted-foreground">
          {t("qualityGuard.degrade.deletedStatus")}
        </Badge>
      ) : account.leaseQuarantinedUntil ? (
        <Badge variant="outline" className="whitespace-nowrap border-amber-500/40 text-amber-700 dark:text-amber-400">
          {t("qualityGuard.leaseUntil", { time: formatCompactDateTime(account.leaseQuarantinedUntil, locale) })}
        </Badge>
      ) : account.enabled ? (
        <Badge variant="outline" className="whitespace-nowrap text-destructive">
          {t("qualityGuard.degrade.scheduling")}
        </Badge>
      ) : (
        <Badge variant="outline" className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">
          {t("qualityGuard.degrade.disabledStatus")}
        </Badge>
      )}
      {account.bfs ? (
        <Badge variant="outline" className="ml-1 whitespace-nowrap text-muted-foreground">
          bfs {account.bfs}
        </Badge>
      ) : null}
    </TableCell>
  );
}

function DegradeAccountRow({
  account,
  thresholds,
  selected,
  locale,
  onToggle,
}: {
  account: DegradeAccountDTO;
  thresholds: DegradeSummaryDTO["thresholds"];
  selected: boolean;
  locale: string;
  onToggle: (id: string, checked?: boolean) => void;
}) {
  const canMute = account.found && account.enabled;
  return (
    <TableRow
      data-testid={`degrade-account-row-${account.id}`}
      className={canMute ? "cursor-pointer" : undefined}
      onClick={() => {
        if (canMute) onToggle(account.id);
      }}
    >
      <DegradeAccountSelectCell account={account} selected={selected} canMute={canMute} onToggle={onToggle} />
      <DegradeAccountIdentityCell account={account} />
      <DegradeAccountStatusCell account={account} locale={locale} />
      <TableCell className="text-right font-mono tabular-nums">{account.hits}</TableCell>
      <DegradeAccountMaxTPSCell account={account} thresholds={thresholds} />
      <TableCell className="text-xs text-muted-foreground">{classSummary(account.classes)}</TableCell>
      <TableCell className="text-xs">{account.nodes.join(" · ") || "-"}</TableCell>
      <TableCell className="font-mono text-xs">
        {account.last ? formatCompactDateTime(account.last, locale) : "-"}
      </TableCell>
    </TableRow>
  );
}

function DegradeAccountSelectCell({
  account,
  selected,
  canMute,
  onToggle,
}: {
  account: DegradeAccountDTO;
  selected: boolean;
  canMute: boolean;
  onToggle: (id: string, checked?: boolean) => void;
}) {
  return (
    <TableCell className="px-3" onClick={(event) => event.stopPropagation()}>
      <label className="flex size-8 cursor-pointer items-center justify-center">
        <Checkbox
          disabled={!canMute}
          checked={selected}
          onCheckedChange={(checked) => onToggle(account.id, checked === true)}
          aria-label={`#${account.id}`}
          data-testid={`degrade-account-select-${account.id}`}
        />
      </label>
    </TableCell>
  );
}

function DegradeAccountIdentityCell({ account }: { account: DegradeAccountDTO }) {
  return (
    <TableCell>
      <div className="font-mono text-xs text-muted-foreground">#{account.id}</div>
      <div className="text-sm">{account.email || account.name || "-"}</div>
    </TableCell>
  );
}

function DegradeAccountMaxTPSCell({
  account,
  thresholds,
}: {
  account: DegradeAccountDTO;
  thresholds: DegradeSummaryDTO["thresholds"];
}) {
  return (
    <TableCell
      className={cn(
        "text-right font-mono tabular-nums",
        account.maxTPS >= thresholds.hardTPS
          ? "text-destructive"
          : account.maxTPS >= thresholds.softTPS
            ? "text-amber-600 dark:text-amber-400"
            : "",
      )}
    >
      {account.maxTPS}
    </TableCell>
  );
}

function DegradeAccountTableBody({
  controller,
  summary,
  locale,
}: {
  controller: DegradeAccountsController;
  summary: DegradeSummaryDTO;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <TableBody>
      {controller.rows.length === 0 ? (
        <TableRow>
          <TableCell colSpan={8}>
            <EmptyState message={t("qualityGuard.degrade.noAccounts")} />
          </TableCell>
        </TableRow>
      ) : (
        controller.rows.map((account) => (
          <DegradeAccountRow
            key={account.id}
            account={account}
            thresholds={summary.thresholds}
            selected={controller.selected.has(account.id)}
            locale={locale}
            onToggle={controller.toggleRow}
          />
        ))
      )}
    </TableBody>
  );
}

function DegradeAccountTableHead({ controller }: { controller: DegradeAccountsController }) {
  const { t } = useTranslation();
  return (
    <TableHeader>
      <TableRow>
        <TableHead className="w-10 px-3">
          <Checkbox
            checked={controller.allSelected ? true : controller.selectedRows.length > 0 ? "indeterminate" : false}
            disabled={controller.selectable.length === 0}
            onCheckedChange={(checked) => controller.toggleAll(checked === true)}
            aria-label={t("common.selectPage")}
            data-testid="degrade-select-page"
          />
        </TableHead>
        <TableHead>{t("qualityGuard.degrade.account")}</TableHead>
        <TableHead>{t("qualityGuard.degrade.status")}</TableHead>
        <TableHead className="text-right">{t("qualityGuard.degrade.hitCount")}</TableHead>
        <TableHead className="text-right">{t("qualityGuard.outputTPS")}</TableHead>
        <TableHead>{t("qualityGuard.degrade.class")}</TableHead>
        <TableHead>{t("qualityGuard.node")}</TableHead>
        <TableHead>{t("qualityGuard.lastObserved")}</TableHead>
      </TableRow>
    </TableHeader>
  );
}

function DegradeAccountsToolbar({
  controller,
  summary,
}: {
  controller: DegradeAccountsController;
  summary: DegradeSummaryDTO;
}) {
  const { t } = useTranslation();
  const { filters } = controller;
  return (
    <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
      <DegradeAccountsHint controller={controller} summary={summary} />
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-8 w-44 pl-8"
            value={filters.search}
            onChange={(event) => filters.setSearch(event.target.value)}
            placeholder={t("qualityGuard.degrade.search")}
            aria-label={t("qualityGuard.degrade.search")}
            data-testid="degrade-search"
          />
        </div>
        <DegradeFilterSelects filters={filters} />
        <DegradeMuteButton controller={controller} />
        <DegradeRefreshButton controller={controller} />
      </div>
    </div>
  );
}

function DegradeAccountsHint({
  controller,
  summary,
}: {
  controller: DegradeAccountsController;
  summary: DegradeSummaryDTO;
}) {
  const { t } = useTranslation();
  const { hitsMin } = controller.filters;
  return (
    <div>
      <h2 className="text-sm font-medium">{t("qualityGuard.degrade.accountsTitle")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {hitsMin > 1
          ? t("qualityGuard.degrade.accountsHintFiltered", {
              shown: controller.rows.length,
              total: summary.accountPage.total,
              min: hitsMin,
            })
          : t("qualityGuard.degrade.accountsHint", {
              shown: controller.rows.length,
              total: summary.accountPage.total,
            })}
      </p>
    </div>
  );
}

function DegradeMuteButton({ controller }: { controller: DegradeAccountsController }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
      disabled={controller.selectedRows.length === 0 || controller.busy}
      onClick={() => {
        if (!window.confirm(t("qualityGuard.degrade.muteConfirm", { count: controller.selectedRows.length }))) return;
        controller.muteSelected(controller.selectedRows.map((account) => account.id));
      }}
      data-testid="degrade-mute-selected"
    >
      <PowerOff />
      {controller.selectedRows.length
        ? t("qualityGuard.degrade.muteSelectedCount", { count: controller.selectedRows.length })
        : t("qualityGuard.degrade.muteSelected")}
    </Button>
  );
}

function DegradeRefreshButton({ controller }: { controller: DegradeAccountsController }) {
  const { t } = useTranslation();
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={() => void controller.query.refetch()}
      disabled={controller.query.isFetching}
      aria-label={t("common.refresh")}
    >
      <RefreshCw className={cn("size-4", controller.query.isFetching && "animate-spin")} />
    </Button>
  );
}

export function DegradeAccountsCard({
  controller,
  summary,
}: {
  controller: DegradeAccountsController;
  summary: DegradeSummaryDTO;
}) {
  const { i18n } = useTranslation();
  return (
    <section className="overflow-hidden rounded-lg bg-card" data-testid="degrade-accounts-card">
      <DegradeAccountsToolbar controller={controller} summary={summary} />
      <div className="overflow-x-auto">
        <Table className="min-w-[920px]" data-testid="degrade-accounts-table">
          <DegradeAccountTableHead controller={controller} />
          <DegradeAccountTableBody controller={controller} summary={summary} locale={i18n.language} />
        </Table>
      </div>
      {summary.accountPage.total > 0 ? (
        <div className="border-t px-4 py-3 sm:px-5">
          <Pagination
            page={summary.accountPage.page}
            pageSize={summary.accountPage.pageSize}
            total={summary.accountPage.total}
            pageSizeOptions={[20, 50, 100]}
            onPageChange={controller.filters.setPage}
            onPageSizeChange={controller.filters.setPageSize}
          />
        </div>
      ) : null}
    </section>
  );
}
