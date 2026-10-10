import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { splitDuration } from "@/features/audits/audit-format";
import type { AuditDTO } from "@/features/audits/request-audits-api";
import { cn } from "@/shared/lib/cn";
import { formatDuration, formatNumber } from "@/shared/lib/format";

function PerformanceValue({ value, unit }: { value: string; unit: string }) {
  return (
    <span className="font-medium">
      {value}
      {unit ? (
        <>
          {" "}
          <span className="font-normal">{unit}</span>
        </>
      ) : null}
    </span>
  );
}

export function ResponsePerformance({ audit, locale }: { audit: AuditDTO; locale: string }) {
  const { t } = useTranslation();
  const duration = splitDuration(formatDuration(audit.durationMs));
  const firstToken =
    audit.firstTokenMs === undefined ? { value: "—", unit: "" } : splitDuration(formatDuration(audit.firstTokenMs));
  const throughput =
    audit.outputTokensPerSecond === undefined ? "—" : formatNumber(audit.outputTokensPerSecond, locale, 1);
  return (
    <div className="grid w-fit max-w-full grid-cols-[auto_auto] gap-x-2.5 gap-y-0.5 whitespace-nowrap text-[11px] leading-4 tabular-nums">
      <span className="text-muted-foreground">{t("audits.durationMetric")}</span>
      <PerformanceValue value={duration.value} unit={duration.unit} />
      <span className="text-muted-foreground">{t("audits.firstTokenMetric")}</span>
      <PerformanceValue value={firstToken.value} unit={firstToken.unit} />
      <span className="text-muted-foreground">{t("audits.throughputMetric")}</span>
      <PerformanceValue value={throughput} unit={t("audits.tokensPerSecondUnit")} />
    </div>
  );
}

export function EgressValue({ audit }: { audit: AuditDTO }) {
  const { t } = useTranslation();
  if (!audit.egressMode) {
    return <span className="text-muted-foreground">-</span>;
  }
  const proxied = audit.egressMode === "proxy";
  const node = audit.egressNodeName || (proxied ? t("audits.egressUnknown") : t("audits.egressDirect"));
  const details = [audit.egressScope, audit.egressNodeId ? `#${audit.egressNodeId}` : ""].filter(Boolean).join(" · ");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-block min-w-0 max-w-full cursor-help text-center"
          aria-label={`${proxied ? t("audits.egressProxy") : t("audits.egressDirect")}: ${node}`}
        >
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs",
              proxied ? "text-emerald-700 dark:text-emerald-300" : "text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", proxied ? "bg-emerald-500" : "bg-muted-foreground/50")} />
            {proxied ? t("audits.egressProxy") : t("audits.egressDirect")}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-72" side="top" align="center">
        <div>{node}</div>
        {details ? <div className="mt-1 text-primary-foreground/65">{details}</div> : null}
      </TooltipContent>
    </Tooltip>
  );
}
