import { RefreshCw } from "lucide-react";
import { useCallback, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AuditFiltersToolbar } from "@/features/audits/audit-filters-toolbar";
import { auditCacheRate } from "@/features/audits/audit-format";
import { AuditSummarySection, type AuditSummaryDisplay } from "@/features/audits/audit-summary-section";
import { AuditRow } from "@/features/audits/audit-table-row";
import { AuditTableContent } from "@/features/audits/audit-table-content";
import { RequestAuditDetailDialog } from "@/features/audits/request-audit-detail-dialog";
import type { AuditDTO, AuditSummaryDTO } from "@/features/audits/request-audits-api";
import { useAuditFilterOptions, type AuditFilterOptions } from "@/features/audits/use-audit-filter-options";
import { useAuditList, type AuditListController } from "@/features/audits/use-audit-list";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { CursorPagination } from "@/shared/components/pagination";
import { PageHeader } from "@/shared/components/page-header";
import { PeriodSelector } from "@/shared/components/period-selector";
import { formatDuration, formatNumber } from "@/shared/lib/format";
import type { PeriodDays } from "@/shared/lib/period";
import { formatUSDTicks } from "@/shared/lib/usd";

type Translate = (key: string, options?: Record<string, unknown>) => string;

type AuditsPageHeaderProps = {
  periodDays: PeriodDays;
  refreshing: boolean;
  onPeriodChange: (value: PeriodDays) => void;
  onRefresh: () => void;
};

type AuditsFilterBarProps = {
  list: AuditListController;
  filterOptions: AuditFilterOptions;
};

type AuditsTableSectionProps = AuditsFilterBarProps & {
  renderRow: (audit: AuditDTO) => ReactNode;
};

function buildSummaryDisplay(summary: AuditSummaryDTO | undefined, locale: string, t: Translate): AuditSummaryDisplay {
  const hasEstimatedCost = (summary?.pricing.pricedRequests ?? 0) > 0;
  const estimatedCostTicks = summary?.usage.estimatedCostInUsdTicks ?? 0;
  return {
    requests: formatNumber(summary?.usage.requests ?? 0, locale, 0),
    requestBreakdown: t("audits.requestBreakdown", {
      success: formatNumber(summary?.usage.successfulRequests ?? 0, locale, 0),
      failed: formatNumber(summary?.usage.failedRequests ?? 0, locale, 0),
    }),
    totalTokens: formatNumber(summary?.usage.totalTokens ?? 0, locale, 0),
    tokenEfficiency: t("audits.tokenEfficiency", {
      cacheRate: formatNumber(auditCacheRate(summary?.usage), locale, 1),
    }),
    successRate: `${formatNumber(summary?.usage.successRate ?? 0, locale, 1)}%`,
    averageDuration: t("audits.averageDuration", {
      duration: formatDuration(summary?.usage.averageDurationMs ?? 0),
    }),
    estimatedCost: hasEstimatedCost ? formatUSDTicks(estimatedCostTicks, 2) : "-",
    exactEstimatedCost: hasEstimatedCost ? formatUSDTicks(estimatedCostTicks, 10) : undefined,
    pricingCoverage: t("audits.pricingCoverage", {
      priced: formatNumber(summary?.pricing.pricedRequests ?? 0, locale, 0),
      unpriced: formatNumber(summary?.pricing.unpricedRequests ?? 0, locale, 0),
    }),
    inputTokens: formatNumber(summary?.usage.inputTokens ?? 0, locale, 0),
    outputTokens: formatNumber(summary?.usage.outputTokens ?? 0, locale, 0),
    cachedTokens: formatNumber(summary?.usage.cachedInputTokens ?? 0, locale, 0),
    reasoningTokens: formatNumber(summary?.usage.reasoningTokens ?? 0, locale, 0),
  };
}

export function RequestAuditsPage() {
  const { t, i18n } = useTranslation();
  const list = useAuditList();
  const filterOptions = useAuditFilterOptions();
  const locale = i18n.language;
  const summary = list.summaryQuery.data;
  const summaryDisplay = buildSummaryDisplay(summary, locale, t);
  const renderAuditRow = useCallback(
    (audit: AuditDTO) => <AuditRow key={audit.id} audit={audit} locale={locale} onOpen={list.setSelectedAudit} />,
    [list.setSelectedAudit, locale],
  );
  const refreshing = list.manualRefreshing || list.auditsQuery.isFetching || list.summaryQuery.isFetching;

  return (
    <div className="space-y-5">
      <AuditsPageHeader
        periodDays={list.periodDays}
        refreshing={refreshing}
        onPeriodChange={list.setPeriodDays}
        onRefresh={list.refreshAll}
      />
      <AuditSummarySection
        loading={list.summaryQuery.isPending || list.summaryQuery.isPlaceholderData}
        display={summaryDisplay}
      />
      <AuditsTableSection list={list} filterOptions={filterOptions} renderRow={renderAuditRow} />
      <RequestAuditDetailDialog
        key={list.selectedAudit?.id ?? "closed"}
        audit={list.selectedAudit}
        open={list.selectedAudit !== null}
        onOpenChange={(open) => !open && list.setSelectedAudit(null)}
      />
    </div>
  );
}

/** 页头：周期切换与手动刷新；刷新期间按钮禁用并旋转图标。 */
function AuditsPageHeader({ periodDays, refreshing, onPeriodChange, onRefresh }: AuditsPageHeaderProps) {
  const { t } = useTranslation();
  return (
    <PageHeader
      title={t("audits.title")}
      description={t("audits.description")}
      actions={
        <>
          <PeriodSelector value={periodDays} onChange={onPeriodChange} ariaLabel={t("audits.usageSummary")} />
          <Button variant="secondary" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
        </>
      }
    />
  );
}

/** 筛选工具条：把列表控制器接到审计筛选组件。 */
function AuditsFilterBar({ list, filterOptions }: AuditsFilterBarProps) {
  return (
    <AuditFiltersToolbar
      search={list.search}
      onSearchChange={list.setSearch}
      modelFilter={list.modelFilter}
      onModelFilterChange={list.setModelFilter}
      modelOptions={list.modelOptions}
      statusFilter={list.statusFilter}
      onStatusFilterChange={list.setStatusFilter}
      modeFilter={list.modeFilter}
      onModeFilterChange={list.setModeFilter}
      keyFilter={list.keyFilter}
      onKeyFilterChange={list.setKeyFilter}
      accountFilter={list.accountFilter}
      onAccountFilterChange={list.setAccountFilter}
      filterOptions={filterOptions}
    />
  );
}

/** 游标分页：页码等于已压入的游标数。 */
function AuditsPagination({ list }: { list: AuditListController }) {
  return (
    <CursorPagination
      page={list.cursors.length}
      pageSize={list.pageSize}
      hasMore={Boolean(list.auditsQuery.data?.hasMore && list.nextCursor)}
      disabled={list.auditsQuery.isFetching}
      onFirstPage={list.goToFirstPage}
      onPreviousPage={list.goToPreviousPage}
      onNextPage={list.goToNextPage}
      onPageSizeChange={list.setPageSize}
    />
  );
}

/** 表格区：筛选工具条、分页脚注与审计表格；无数据且只有一页游标时不渲染脚注。 */
function AuditsTableSection({ list, filterOptions, renderRow }: AuditsTableSectionProps) {
  const hasRows = (list.auditsQuery.data?.items.length ?? 0) > 0;
  const showFooter = hasRows || list.cursors.length > 1;
  return (
    <DataTableShell
      toolbar={<AuditsFilterBar list={list} filterOptions={filterOptions} />}
      footer={showFooter ? <AuditsPagination list={list} /> : undefined}
    >
      <AuditTableContent query={list.auditsQuery} sort={list.sort} onSort={list.changeSort} renderRow={renderRow} />
    </DataTableShell>
  );
}
