import { useTranslation } from "react-i18next";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { auditErrorLabel, statusTone } from "@/features/audits/audit-format";
import type { AuditDTO } from "@/features/audits/request-audits-api";
import { cn } from "@/shared/lib/cn";

export function StatusCode({ statusCode, hasError = false }: { statusCode: number; hasError?: boolean }) {
  const tone = statusTone(statusCode, hasError);
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] leading-4 tabular-nums", tone.text)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {statusCode || "-"}
    </span>
  );
}

export function AuditStatus({ audit, onOpen }: { audit: AuditDTO; onOpen: () => void }) {
  const { t } = useTranslation();
  const mode =
    audit.operation === "compaction"
      ? t("audits.operations.compaction")
      : audit.streaming
        ? t("audits.stream")
        : t("audits.nonStream");
  const hasError = Boolean(audit.errorCode);
  const { showErrorLabel, statusPrefix } = auditErrorLabel(audit.statusCode, hasError);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group inline-flex flex-col items-center justify-center space-y-0.5 rounded-md px-2 py-1 text-center outline-none transition-colors hover:bg-muted/80 focus-visible:ring-2 focus-visible:ring-ring/50 [&>span:last-child]:underline-offset-2 hover:[&>span:last-child]:text-foreground hover:[&>span:last-child]:underline cursor-pointer"
          aria-label={t("audits.viewDetails")}
          onClick={onOpen}
          data-testid={`audit-status-${audit.id}`}
        >
          {showErrorLabel ? (
            <span className="inline-flex items-center gap-1 text-[10px] leading-4 tabular-nums text-amber-700 dark:text-amber-300">
              <span className="size-1.5 rounded-full bg-amber-500" />
              {statusPrefix}
              {t("audits.errorLabel")}
            </span>
          ) : (
            <StatusCode statusCode={audit.statusCode} hasError={hasError} />
          )}
          <span className="block whitespace-nowrap text-[10px] text-muted-foreground">{mode}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-80 whitespace-normal break-words text-left leading-5" side="top">
        {audit.errorCode || t("audits.viewDetails")}
      </TooltipContent>
    </Tooltip>
  );
}
