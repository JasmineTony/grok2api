import { useQuery } from "@tanstack/react-query";
import { FileText, Globe2, ListTree, Server } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/features/audits/audit-detail-common";
import { AuditMetadataPanel } from "@/features/audits/audit-metadata-panel";
import { AuditOverviewPanel } from "@/features/audits/audit-overview-panel";
import { UpstreamAttemptsPanel } from "@/features/audits/audit-attempts-panel";
import { getRequestAudit, type AuditAttemptDTO, type AuditDTO } from "@/features/audits/request-audits-api";
import { ErrorState, LoadingState } from "@/shared/components/data-state";
import { formatDateTime } from "@/shared/lib/format";

const AUDIT_DETAIL_CACHE_TIME_MS = 60_000;

function DialogMeta({ audit, locale }: { audit: AuditDTO; locale: string }) {
  const hasMeta = Boolean(audit.requestId || audit.clientIp || audit.operation);
  return (
    <DialogDescription asChild>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-normal text-muted-foreground">
        {audit.requestId ? (
          <span className="max-w-[280px] truncate" title={audit.requestId}>
            {audit.requestId}
          </span>
        ) : null}
        {audit.clientIp ? (
          <>
            {audit.requestId ? <span aria-hidden="true">·</span> : null}
            <span className="inline-flex items-center gap-1">
              <Globe2 className="size-3" />
              {audit.clientIp}
            </span>
          </>
        ) : null}
        {audit.operation ? (
          <>
            {audit.requestId || audit.clientIp ? <span aria-hidden="true">·</span> : null}
            <span>{audit.operation}</span>
          </>
        ) : null}
        <>
          {hasMeta ? <span aria-hidden="true">·</span> : null}
          <span>{formatDateTime(audit.createdAt, locale)}</span>
        </>
      </div>
    </DialogDescription>
  );
}

function DetailTabs({ audit, attempts }: { audit: AuditDTO; attempts: AuditAttemptDTO[] }) {
  const { t } = useTranslation();
  return (
    <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 overflow-x-auto bg-muted/15 px-4 py-2 sm:px-5">
        <TabsList className="h-8 w-max">
          <TabsTrigger value="overview" className="gap-1.5 px-3 text-xs">
            <FileText className="size-3.5" />
            {t("audits.requestOverview")}
          </TabsTrigger>
          <TabsTrigger value="requestMetadata" className="gap-1.5 px-3 text-xs">
            <ListTree className="size-3.5" />
            {t("audits.requestMetadata")}
          </TabsTrigger>
          <TabsTrigger value="attempts" className="gap-1.5 px-3 text-xs">
            <Server className="size-3.5" />
            {t("audits.upstreamDiagnostics")}
            {attempts.length > 0 ? (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px] font-mono">
                {attempts.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent
        value="overview"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 focus-visible:outline-none sm:p-5"
      >
        <AuditOverviewPanel audit={audit} />
      </TabsContent>
      <TabsContent
        value="requestMetadata"
        className="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-3 focus-visible:outline-none sm:px-5 sm:pb-5"
      >
        <AuditMetadataPanel audit={audit} />
      </TabsContent>
      <TabsContent value="attempts" className="min-h-0 flex-1 overflow-hidden focus-visible:outline-none">
        <UpstreamAttemptsPanel audit={audit} attempts={attempts} />
      </TabsContent>
    </Tabs>
  );
}

export function RequestAuditDetailDialog({
  audit,
  open,
  onOpenChange,
}: {
  audit: AuditDTO | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const detailQuery = useQuery({
    queryKey: ["request-audits", "detail", audit?.id],
    queryFn: ({ signal }) => getRequestAudit(audit?.id ?? "", signal),
    enabled: open && audit !== null,
    gcTime: AUDIT_DETAIL_CACHE_TIME_MS,
  });
  const activeAudit = detailQuery.data?.audit ?? audit;
  const attempts = detailQuery.data?.attempts ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(700px,calc(100svh-2rem))] max-h-[calc(100svh-2rem)] min-h-0 flex-col gap-0 overflow-hidden p-0 text-xs sm:max-w-[900px]">
        <DialogHeader className="shrink-0 px-5 pb-3 pt-4 pr-12">
          <div className="flex items-center gap-2">
            <DialogTitle>{t("audits.detailTitle")}</DialogTitle>
            {activeAudit ? (
              <StatusBadge
                statusCode={activeAudit.statusCode}
                failed={Boolean(activeAudit.errorCode) || activeAudit.statusCode >= 400}
              />
            ) : null}
          </div>
          {activeAudit ? <DialogMeta audit={activeAudit} locale={i18n.language} /> : null}
        </DialogHeader>
        {detailQuery.isPending && !activeAudit ? <LoadingState className="min-h-0 flex-1" /> : null}
        {detailQuery.isError ? (
          <ErrorState message={detailQuery.error.message} onRetry={() => void detailQuery.refetch()} />
        ) : null}
        {activeAudit ? <DetailTabs audit={activeAudit} attempts={attempts} /> : null}
      </DialogContent>
    </Dialog>
  );
}
