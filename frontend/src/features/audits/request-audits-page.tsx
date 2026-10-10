import { RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { AuditFiltersToolbar } from "@/features/audits/audit-filters-toolbar";
import { auditCacheRate } from "@/features/audits/audit-format";
import { AuditSummarySection, type AuditSummaryDisplay } from "@/features/audits/audit-summary-section";
import { AuditRow } from "@/features/audits/audit-table-row";
import { AuditTableContent } from "@/features/audits/audit-table-content";
import { RequestAuditDetailDialog } from "@/features/audits/request-audit-detail-dialog";
import type { AuditDTO, AuditSummaryDTO } from "@/features/audits/request-audits-api";
import { useAuditFilterOptions } from "@/features/audits/use-audit-filter-options";
import { useAuditList } from "@/features/audits/use-audit-list";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { CursorPagination } from "@/shared/components/pagination";
import { PageHeader } from "@/shared/components/page-header";
import { PeriodSelector } from "@/shared/components/period-selector";
import { formatDuration, formatNumber } from "@/shared/lib/format";
import { formatUSDTicks } from "@/shared/lib/usd";

type Translate = (key: string, options?: Record<string, unknown>) => string;

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
      <PageHeader
        title={t("audits.title")}
        description={t("audits.description")}
        actions={
          <>
            <PeriodSelector
              value={list.periodDays}
              onChange={list.setPeriodDays}
              ariaLabel={t("audits.usageSummary")}
            />
            <Button variant="secondary" size="sm" onClick={list.refreshAll} disabled={refreshing}>
              <RefreshCw className={refreshing ? "animate-spin" : undefined} />
              {t("common.refresh")}
            </Button>
          </>
        }
      />
      <AuditSummarySection
        loading={list.summaryQuery.isPending || list.summaryQuery.isPlaceholderData}
        display={summaryDisplay}
      />
      <DataTableShell
        toolbar={
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
        }
        footer={
          (list.auditsQuery.data?.items.length ?? 0) > 0 || list.cursors.length > 1 ? (
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
          ) : undefined
        }
      >
        <AuditTableContent
          query={list.auditsQuery}
          sort={list.sort}
          onSort={list.changeSort}
          renderRow={renderAuditRow}
        />
      </DataTableShell>
      <RequestAuditDetailDialog
        key={list.selectedAudit?.id ?? "closed"}
        audit={list.selectedAudit}
        open={list.selectedAudit !== null}
        onOpenChange={(open) => !open && list.setSelectedAudit(null)}
      />
    </div>
  );
}
