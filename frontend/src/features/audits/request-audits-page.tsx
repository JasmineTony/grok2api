import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listModels } from "@/entities/model/model-api";
import { RequestAuditDetailDialog } from "@/features/audits/request-audit-detail-dialog";
import {
  type AuditDTO,
  type AuditPeriod,
  getRequestAudits,
  getRequestAuditSummary,
} from "@/features/audits/request-audits-api";
import {
  AuditStatus,
  BillingValue,
  EgressValue,
  ModelRouteValue,
  RequestAuditSummary,
  RequestValue,
  UsageDetails,
} from "@/features/audits/request-audits-components";
import { useApiClient } from "@/shared/api/use-api-client";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { PageHeader } from "@/shared/components/page-header";
import { CursorPagination } from "@/shared/components/pagination";
import { PeriodSelector } from "@/shared/components/period-selector";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { formatDateTime, formatDuration } from "@/shared/lib/format";
import { type PeriodDays, toPeriodValue } from "@/shared/lib/period";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

export function RequestAuditsPage() {
  const { t, i18n } = useTranslation();
  const apiClient = useApiClient();
  const [cursors, setCursors] = useState<string[]>([""]);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [modelFilter, setModelFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [modeFilter, setModeFilter] = useState("");
  const [keyFilter, setKeyFilter] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [periodDays, setPeriodDays] = useState<PeriodDays>(1);
  const [sort, setSort] = useState<TableSort>({ field: "createdAt", order: "desc" });
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [selectedAudit, setSelectedAudit] = useState<AuditDTO | null>(null);
  const forceSummaryRefresh = useRef(false);
  const debouncedSearch = useDebouncedValue(search);
  const debouncedKeyFilter = useDebouncedValue(keyFilter);
  const debouncedAccountFilter = useDebouncedValue(accountFilter);
  const cursor = cursors[cursors.length - 1];
  const period: AuditPeriod = toPeriodValue(periodDays);
  const auditsQuery = useQuery({
    queryKey: [
      "request-audits",
      "cursor",
      cursor,
      pageSize,
      debouncedSearch,
      modelFilter,
      statusFilter,
      modeFilter,
      debouncedKeyFilter,
      debouncedAccountFilter,
      period,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      getRequestAudits(apiClient, {
        ...(cursor === undefined ? {} : { cursor }),
        pageSize,
        search: debouncedSearch,
        model: modelFilter,
        status: statusFilter,
        mode: modeFilter,
        key: debouncedKeyFilter,
        account: debouncedAccountFilter,
        period,
        sortBy: sort.field,
        sortOrder: sort.order,
      }),
  });
  const summaryQuery = useQuery({
    queryKey: [
      "request-audits",
      "summary",
      debouncedSearch,
      modelFilter,
      statusFilter,
      modeFilter,
      debouncedKeyFilter,
      debouncedAccountFilter,
      period,
    ],
    queryFn: () =>
      getRequestAuditSummary(
        apiClient,
        {
          search: debouncedSearch,
          model: modelFilter,
          status: statusFilter,
          mode: modeFilter,
          key: debouncedKeyFilter,
          account: debouncedAccountFilter,
          period,
        },
        forceSummaryRefresh.current,
      ),
    placeholderData: (previous) => previous,
  });
  const modelOptionsQuery = useQuery({
    queryKey: ["models", "audit-filter"],
    queryFn: () => listModels(apiClient, { page: 1, pageSize: 100 }),
    staleTime: 60_000,
  });
  const result = auditsQuery.data;
  const summary = summaryQuery.data;
  const summaryLoading = summaryQuery.isPending || summaryQuery.isPlaceholderData;

  function refreshAll(): void {
    setManualRefreshing(true);
    forceSummaryRefresh.current = true;
    void Promise.all([
      auditsQuery.refetch(),
      summaryQuery.refetch(),
      new Promise<void>((resolve) => window.setTimeout(resolve, 400)),
    ]).finally(() => {
      forceSummaryRefresh.current = false;
      setManualRefreshing(false);
    });
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setCursors([""]);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("audits.title")}
        description={t("audits.description")}
        actions={
          <>
            <PeriodSelector
              value={periodDays}
              onChange={(days) => {
                setPeriodDays(days);
                setCursors([""]);
              }}
              ariaLabel={t("audits.usageSummary")}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={refreshAll}
              disabled={auditsQuery.isFetching || summaryQuery.isFetching || manualRefreshing}
            >
              <RefreshCw className={manualRefreshing ? "animate-spin" : undefined} />
              {t("common.refresh")}
            </Button>
          </>
        }
      />

      <RequestAuditSummary summary={summary} loading={summaryLoading} locale={i18n.language} />

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
                    setCursors([""]);
                  }}
                  placeholder={t("audits.search")}
                  aria-label={t("audits.search")}
                />
              </div>
              <DataTableFilters
                filters={[
                  {
                    id: "model",
                    label: t("audits.model"),
                    value: modelFilter,
                    onChange: (value) => {
                      setModelFilter(value);
                      setCursors([""]);
                    },
                    options: [
                      ...new Map(
                        (modelOptionsQuery.data?.items ?? []).map((model) => [
                          model.publicId,
                          { value: model.publicId, label: model.publicId },
                        ]),
                      ).values(),
                    ],
                  },
                  {
                    id: "status",
                    label: t("audits.status"),
                    value: statusFilter,
                    onChange: (value) => {
                      setStatusFilter(value);
                      setCursors([""]);
                    },
                    options: [
                      { value: "2xx", label: `2xx · ${t("audits.statusSuccess")}` },
                      { value: "4xx", label: `4xx · ${t("audits.statusClientError")}` },
                      { value: "5xx", label: `5xx · ${t("audits.statusServerError")}` },
                    ],
                  },
                  {
                    id: "mode",
                    label: t("audits.mode"),
                    value: modeFilter,
                    onChange: (value) => {
                      setModeFilter(value);
                      setCursors([""]);
                    },
                    options: [
                      { value: "stream", label: t("audits.stream") },
                      { value: "nonStream", label: t("audits.nonStream") },
                    ],
                  },
                  {
                    id: "key",
                    type: "text",
                    label: t("audits.key"),
                    value: keyFilter,
                    placeholder: t("audits.keyFilterPlaceholder"),
                    onChange: (value) => {
                      setKeyFilter(value);
                      setCursors([""]);
                    },
                  },
                  {
                    id: "account",
                    type: "text",
                    label: t("audits.account"),
                    value: accountFilter,
                    placeholder: t("audits.accountFilterPlaceholder"),
                    onChange: (value) => {
                      setAccountFilter(value);
                      setCursors([""]);
                    },
                  },
                ]}
              />
            </div>
          </>
        }
        footer={
          result && result.items.length > 0 ? (
            <CursorPagination
              page={cursors.length}
              pageSize={pageSize}
              hasMore={result.hasMore && Boolean(result.nextCursor)}
              onFirstPage={() => setCursors([""])}
              onPreviousPage={() => setCursors((values) => values.slice(0, -1))}
              onNextPage={() => setCursors((values) => [...values, result.nextCursor])}
              onPageSizeChange={(value) => {
                setPageSize(value);
                setCursors([""]);
              }}
            />
          ) : undefined
        }
      >
        {auditsQuery.isError ? (
          <ErrorState
            message={auditsQuery.error.message}
            onRetry={() => void auditsQuery.refetch()}
          />
        ) : null}
        {result && result.items.length === 0 ? <EmptyState /> : null}
        {auditsQuery.isPending || (result && result.items.length > 0) ? (
          <Table viewportRows={20} rowHeight={72} className="min-w-[1136px] table-fixed text-xs">
            <colgroup>
              <col className="w-36" />
              <col className="w-44" />
              <col className="w-20" />
              <col className="w-24" />
              <col className="w-76" />
              <col className="w-20" />
              <col className="w-20" />
              <col className="w-44" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <SortableTableHead
                  field="request"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("audits.request")}
                </SortableTableHead>
                <SortableTableHead
                  field="model"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("audits.model")}
                </SortableTableHead>
                <TableHead>{t("audits.egress")}</TableHead>
                <SortableTableHead
                  field="billing"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                >
                  {t("audits.billing")}
                </SortableTableHead>
                <SortableTableHead
                  field="tokens"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  className="px-3"
                  onSort={changeSort}
                >
                  {t("audits.tokens")}
                </SortableTableHead>
                <SortableTableHead
                  field="status"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  align="center"
                  onSort={changeSort}
                >
                  {t("audits.status")}
                </SortableTableHead>
                <SortableTableHead
                  field="duration"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                >
                  {t("audits.duration")}
                </SortableTableHead>
                <SortableTableHead
                  field="createdAt"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                >
                  {t("audits.createdAt")}
                </SortableTableHead>
              </TableRow>
            </TableHeader>
            {auditsQuery.isPending ? (
              <TableBody>
                <TableLoadingRow colSpan={8} />
              </TableBody>
            ) : (
              <VirtualTableBody
                items={result?.items ?? []}
                colSpan={8}
                rowHeight={72}
                renderRow={(audit) => (
                  <TableRow className="h-[72px]" key={audit.id}>
                    <TableCell>
                      <RequestValue audit={audit} />
                    </TableCell>
                    <TableCell>
                      <ModelRouteValue
                        model={audit.modelPublicId || `#${audit.modelRouteId}`}
                        upstreamModel={audit.modelUpstreamModel || "-"}
                        account={
                          audit.accountName || (audit.accountId ? `#${audit.accountId}` : "-")
                        }
                        clientKey={audit.clientKeyName || `#${audit.clientKeyId}`}
                      />
                    </TableCell>
                    <TableCell>
                      <EgressValue audit={audit} />
                    </TableCell>
                    <TableCell>
                      <BillingValue audit={audit} />
                    </TableCell>
                    <TableCell className="px-3">
                      <UsageDetails audit={audit} locale={i18n.language} />
                    </TableCell>
                    <TableCell className="text-center">
                      <AuditStatus audit={audit} onOpen={() => setSelectedAudit(audit)} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs tabular-nums">
                      {formatDuration(audit.durationMs)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDateTime(audit.createdAt, i18n.language)}
                    </TableCell>
                  </TableRow>
                )}
              />
            )}
          </Table>
        ) : null}
      </DataTableShell>
      <RequestAuditDetailDialog
        key={selectedAudit?.id ?? "closed"}
        audit={selectedAudit}
        open={selectedAudit !== null}
        onOpenChange={(open) => !open && setSelectedAudit(null)}
      />
    </div>
  );
}
