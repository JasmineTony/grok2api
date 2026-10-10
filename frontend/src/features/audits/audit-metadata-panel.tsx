import { FileText } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { EmptyPanel, HeadersPanel } from "@/features/audits/audit-detail-common";
import type { AuditDTO } from "@/features/audits/request-audits-api";
import { CopyButton } from "@/shared/components/copy-button";

function RequestPathSection({ audit }: { audit: AuditDTO }) {
  const { t } = useTranslation();
  return (
    <section className="shrink-0">
      <p className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">{t("audits.requestPath")}</p>
      <div className="flex h-10 min-w-0 items-center gap-3 rounded-lg bg-muted/15 px-3">
        <span className="shrink-0 text-xs text-muted-foreground">{audit.requestMethod || "-"}</span>
        <span className="min-w-0 flex-1 truncate text-xs" title={audit.requestPath}>
          {audit.requestPath || "-"}
        </span>
        {audit.requestPath ? <CopyButton value={audit.requestPath} /> : null}
      </div>
    </section>
  );
}

export function AuditMetadataPanel({ audit }: { audit: AuditDTO }) {
  const { t } = useTranslation();
  const headers = useMemo(() => audit.requestHeaders ?? {}, [audit.requestHeaders]);
  const hasMetadata = Boolean(audit.requestMethod) || Boolean(audit.requestPath) || Object.keys(headers).length > 0;
  if (!hasMetadata) {
    return <EmptyPanel icon={<FileText />} message={t("audits.noRequestMetadata")} />;
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <RequestPathSection audit={audit} />
      <section className="min-h-0 flex-1">
        <HeadersPanel
          title={t("audits.requestHeaders")}
          headers={headers}
          emptyMessage={t("audits.noRequestHeaders")}
        />
      </section>
    </div>
  );
}
