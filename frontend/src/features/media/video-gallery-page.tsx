import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, RefreshCw, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
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
import { deleteVideos, getVideoStats, listVideos } from "@/features/media/media-api";
import type { MediaJobDTO } from "@/features/media/types";
import { VideoProgress, VideoSummary, VideoTimes } from "@/features/media/video-gallery-components";
import {
  formatSpec,
  isTerminalVideoJob,
  videoAssetURL,
} from "@/features/media/video-gallery-utils";
import { useApiClient } from "@/shared/api/use-api-client";
import { EmptyState, ErrorState, TableLoadingRow } from "@/shared/components/data-state";
import { DataTableFilters } from "@/shared/components/data-table-filters";
import { DataTableShell } from "@/shared/components/data-table-shell";
import { PageHeader } from "@/shared/components/page-header";
import { Pagination } from "@/shared/components/pagination";
import { SortableTableHead } from "@/shared/components/sortable-table-head";
import { VirtualTableBody } from "@/shared/components/virtual-table-body";
import { useDebouncedValue } from "@/shared/hooks/use-debounced-value";
import { nextTableSort, type SortOrder, type TableSort } from "@/shared/lib/table-sort";

type VideoStatusFilter = MediaJobDTO["status"] | "";

const statusOptions: MediaJobDTO["status"][] = ["queued", "in_progress", "completed", "failed"];

export function VideoGalleryPage() {
  const { t, i18n } = useTranslation();
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<VideoStatusFilter>("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [previewing, setPreviewing] = useState<MediaJobDTO | null>(null);
  const [sort, setSort] = useState<TableSort>({ field: "createdAt", order: "desc" });
  const debouncedSearch = useDebouncedValue(search);
  const normalizedSearch = debouncedSearch.trim();

  const videosQuery = useQuery({
    queryKey: [
      "media",
      "videos",
      page,
      pageSize,
      statusFilter,
      normalizedSearch,
      sort.field,
      sort.order,
    ],
    queryFn: () =>
      listVideos(apiClient, {
        page,
        pageSize,
        status: statusFilter,
        ...(normalizedSearch ? { search: normalizedSearch } : {}),
        sortBy: sort.field,
        sortOrder: sort.order,
      }),
  });
  const statsQuery = useQuery({
    queryKey: ["media", "videos", "stats"],
    queryFn: () => getVideoStats(apiClient),
    staleTime: 30_000,
  });

  const result = videosQuery.data;
  const refreshing = videosQuery.isFetching || statsQuery.isFetching;
  const pageIDs = result?.items.filter(isTerminalVideoJob).map((job) => job.id) ?? [];
  const selectedOnPage = pageIDs.filter((id) => selected.has(id));
  const allPageSelected = pageIDs.length > 0 && selectedOnPage.length === pageIDs.length;

  const deleteMutation = useMutation({
    mutationFn: () => deleteVideos(apiClient, [...selected]),
    onSuccess: (deleteResult) => {
      if (result && selectedOnPage.length === result.items.length && page > 1) setPage(page - 1);
      if (previewing && selected.has(previewing.id)) setPreviewing(null);
      setSelected(new Set());
      setDeleteOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["media", "videos"] });
      toast.success(t("media.videos.deleted", { count: deleteResult.deleted }));
    },
    onError: (error) => {
      void queryClient.invalidateQueries({ queryKey: ["media", "videos"] });
      toast.error(error instanceof Error ? error.message : t("errors.generic"));
    },
  });

  function refreshAll(): void {
    void videosQuery.refetch();
    void statsQuery.refetch();
  }

  function changeSort(field: string, initialOrder: SortOrder): void {
    setSort((current) => nextTableSort(current, field, initialOrder));
    setPage(1);
  }

  function togglePage(checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      for (const id of pageIDs) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function toggleVideo(id: string, checked: boolean): void {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("media.videos.title")}
        description={t("media.videos.description")}
        actions={
          <Button variant="secondary" size="sm" onClick={refreshAll} disabled={refreshing}>
            <RefreshCw className={refreshing ? "animate-spin" : undefined} />
            {t("common.refresh")}
          </Button>
        }
      />

      <DataTableShell
        toolbar={
          <>
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-8 pl-9 text-xs"
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                  placeholder={t("media.videos.search")}
                  aria-label={t("media.videos.search")}
                />
              </div>
              <DataTableFilters
                filters={[
                  {
                    id: "status",
                    label: t("media.videos.status"),
                    value: statusFilter,
                    onChange: (value) => {
                      setStatusFilter(value as VideoStatusFilter);
                      setPage(1);
                    },
                    options: statusOptions.map((status) => ({
                      value: status,
                      label: t(`media.videoStatus.${status}`),
                    })),
                  },
                ]}
              />
              {(normalizedSearch || statusFilter) && result ? (
                <span className="hidden whitespace-nowrap text-xs tabular-nums text-muted-foreground md:inline">
                  {t("media.videos.pageSummary", {
                    count: result.items.length,
                    total: result.total,
                  })}
                </span>
              ) : null}
            </div>
            {selected.size > 0 ? (
              <div className="flex h-8 items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {t("common.selectedCount", { count: selected.size })}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 />
                  {t("common.delete")}
                </Button>
              </div>
            ) : (
              <VideoSummary
                stats={statsQuery.data}
                loading={statsQuery.isPending}
                unavailable={statsQuery.isError}
                locale={i18n.language}
              />
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
        {videosQuery.isError ? (
          <ErrorState
            message={videosQuery.error.message}
            onRetry={() => void videosQuery.refetch()}
          />
        ) : null}
        {result && result.items.length === 0 ? (
          <EmptyState message={t("media.videos.empty")} />
        ) : null}
        {videosQuery.isPending || (result && result.items.length > 0) ? (
          <Table viewportRows={20} rowHeight={72} className="min-w-[1096px] table-fixed text-xs">
            <colgroup>
              <col className="w-10" />
              <col className="w-64" />
              <col className="w-40" />
              <col className="w-40" />
              <col className="w-28" />
              <col className="w-40" />
              <col className="w-44" />
              <col className="w-10" />
            </colgroup>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>
                  <Checkbox
                    checked={
                      allPageSelected ? true : selectedOnPage.length > 0 ? "indeterminate" : false
                    }
                    disabled={pageIDs.length === 0}
                    onCheckedChange={(checked) => togglePage(checked === true)}
                    aria-label={t("common.selectPage")}
                  />
                </TableHead>
                <SortableTableHead
                  field="prompt"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("media.videos.prompt")}
                </SortableTableHead>
                <SortableTableHead
                  field="model"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("media.videos.model")}
                </SortableTableHead>
                <SortableTableHead
                  field="status"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("media.videos.statusProgress")}
                </SortableTableHead>
                <SortableTableHead
                  field="spec"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("media.videos.spec")}
                </SortableTableHead>
                <SortableTableHead
                  field="account"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  onSort={changeSort}
                >
                  {t("media.videos.owner")}
                </SortableTableHead>
                <SortableTableHead
                  field="createdAt"
                  sortBy={sort.field}
                  sortOrder={sort.order}
                  initialOrder="desc"
                  onSort={changeSort}
                >
                  {t("media.videos.time")}
                </SortableTableHead>
                <TableActionHead />
              </TableRow>
            </TableHeader>
            {videosQuery.isPending ? (
              <TableBody>
                <TableLoadingRow colSpan={8} />
              </TableBody>
            ) : (
              <VirtualTableBody
                items={result?.items ?? []}
                colSpan={8}
                rowHeight={72}
                renderRow={(job) => (
                  <TableRow
                    className="group h-[72px]"
                    data-state={selected.has(job.id) ? "selected" : undefined}
                    key={job.id}
                  >
                    <TableCell>
                      <Checkbox
                        checked={selected.has(job.id)}
                        disabled={!isTerminalVideoJob(job)}
                        onCheckedChange={(checked) => toggleVideo(job.id, checked === true)}
                        aria-label={t("common.selectItem", { name: job.id })}
                      />
                    </TableCell>
                    <TableCell className="min-w-0">
                      <div className="min-w-0">
                        <span className="block truncate text-xs font-medium" title={job.prompt}>
                          {job.prompt || "-"}
                        </span>
                        <span
                          className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground"
                          title={job.id}
                        >
                          {job.id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <span className="block truncate" title={job.model}>
                        {job.model || "-"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <VideoProgress
                        status={job.status}
                        value={job.progress}
                        errorMessage={job.errorMessage}
                        locale={i18n.language}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5 text-xs">
                        <span className="block truncate" title={formatSpec(job)}>
                          {formatSpec(job)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {t("media.videos.seconds", { count: job.seconds })}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="min-w-0">
                      <div className="min-w-0 space-y-0.5">
                        <span className="block truncate" title={job.accountName}>
                          {job.accountName || "-"}
                        </span>
                        <span
                          className="block truncate text-[11px] text-muted-foreground"
                          title={job.clientKeyName}
                        >
                          {job.clientKeyName || "-"}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <VideoTimes job={job} locale={i18n.language} />
                    </TableCell>
                    <TableActionCell>
                      {job.status === "completed" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          disabled={!job.assetId}
                          title={
                            job.assetId
                              ? t("media.videos.preview")
                              : t("media.videos.previewUnavailable")
                          }
                          onClick={() => setPreviewing(job)}
                          aria-label={
                            job.assetId
                              ? t("media.videos.preview")
                              : t("media.videos.previewUnavailable")
                          }
                        >
                          <Eye />
                        </Button>
                      ) : null}
                    </TableActionCell>
                  </TableRow>
                )}
              />
            )}
          </Table>
        ) : null}
      </DataTableShell>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("media.videos.deleteTitle", { count: selected.size })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("media.videos.deleteDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? <Spinner /> : <Trash2 />}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(previewing)} onOpenChange={(open) => !open && setPreviewing(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle className="truncate">
              {previewing?.prompt || t("media.videos.previewTitle")}
            </DialogTitle>
            <DialogDescription className="truncate font-mono">{previewing?.id}</DialogDescription>
          </DialogHeader>
          {previewing?.assetId ? (
            <div className="overflow-hidden rounded-lg bg-black">
              <video
                key={previewing.assetId}
                className="max-h-[70vh] w-full"
                src={videoAssetURL(previewing.assetId)}
                controls
                playsInline
                preload="metadata"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
