import { Info, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/shared/lib/cn";

function MetricHeader({ icon: Icon, label, tooltip }: { icon: LucideIcon; label: string; tooltip?: string }) {
  return (
    <header className="flex min-h-5 items-center justify-between gap-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="cursor-help" aria-label={tooltip}>
                <Info className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-72 leading-5">{tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
    </header>
  );
}

function MetricValue({ value, fullValue }: { value: string; fullValue?: string }) {
  const { t } = useTranslation();
  if (!fullValue) return <>{value}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help" tabIndex={0}>
          {value}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <span className="text-primary-foreground/65">{t("audits.exactBilling")}</span>{" "}
        <span className="font-mono">{fullValue}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function AuditMetric({
  icon,
  label,
  value,
  detail,
  tooltip,
  fullValue,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  tooltip?: string;
  fullValue?: string;
  loading: boolean;
}) {
  return (
    <article className="min-h-28 rounded-lg bg-card p-4" aria-busy={loading}>
      <MetricHeader icon={icon} label={label} tooltip={tooltip} />
      <div className="mt-3 flex min-h-8 items-center text-2xl font-medium tracking-tight tabular-nums">
        {loading ? <Spinner /> : <MetricValue value={value} fullValue={fullValue} />}
      </div>
      {detail ? (
        <p
          className={cn("mt-1.5 min-h-4 truncate text-[11px] text-muted-foreground", loading && "invisible")}
          title={detail}
        >
          {detail}
        </p>
      ) : null}
    </article>
  );
}

export function AuditTokenMetric({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  loading: boolean;
}) {
  return (
    <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 rounded-lg bg-muted/45 px-4 py-2">
      <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        {label}
      </span>
      <span
        className="flex min-h-5 min-w-8 items-center justify-end truncate text-sm font-medium tabular-nums"
        title={loading ? undefined : value}
      >
        {loading ? <Spinner className="size-3.5" /> : value}
      </span>
    </div>
  );
}
