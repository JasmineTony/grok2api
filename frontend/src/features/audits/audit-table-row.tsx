import { memo } from "react";

import { TableCell, TableRow } from "@/components/ui/table";
import { BillingValue } from "@/features/audits/audit-billing-cell";
import { EgressValue, ResponsePerformance } from "@/features/audits/audit-performance-cell";
import { ModelRouteValue } from "@/features/audits/audit-route-cell";
import { AuditStatus } from "@/features/audits/audit-status-cell";
import { UsageDetails } from "@/features/audits/audit-usage-cell";
import type { AuditDTO } from "@/features/audits/request-audits-api";
import { formatCompactDateTime, formatDateTime } from "@/shared/lib/format";

export const AuditRow = memo(function AuditRow({
  audit,
  locale,
  onOpen,
}: {
  audit: AuditDTO;
  locale: string;
  onOpen: (audit: AuditDTO) => void;
}) {
  const createdAt = formatCompactDateTime(audit.createdAt, locale);
  const createdAtLabel = formatDateTime(audit.createdAt, locale);
  return (
    <TableRow className="h-[96px]" data-testid={`audit-row-${audit.id}`}>
      <TableCell>
        <ModelRouteValue
          model={audit.modelPublicId || `#${audit.modelRouteId}`}
          upstreamModel={audit.modelUpstreamModel || "-"}
          account={audit.accountName || (audit.accountId ? `#${audit.accountId}` : "-")}
          clientKey={audit.clientKeyName || `#${audit.clientKeyId}`}
          clientIp={audit.clientIp}
          requestId={audit.requestId}
          provider={audit.provider}
          operation={audit.operation}
          sources={audit.numSourcesUsed}
        />
      </TableCell>
      <TableCell className="text-center">
        <EgressValue audit={audit} />
      </TableCell>
      <TableCell>
        <BillingValue audit={audit} />
      </TableCell>
      <TableCell className="px-3">
        <UsageDetails audit={audit} locale={locale} />
      </TableCell>
      <TableCell className="text-center">
        <AuditStatus audit={audit} onOpen={() => onOpen(audit)} />
      </TableCell>
      <TableCell>
        <ResponsePerformance audit={audit} locale={locale} />
      </TableCell>
      <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        <time dateTime={audit.createdAt} title={createdAtLabel}>
          {createdAt}
        </time>
      </TableCell>
    </TableRow>
  );
});
