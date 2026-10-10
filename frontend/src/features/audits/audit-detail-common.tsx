import { FileText } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { auditStatusBadgeClass } from "@/features/audits/audit-status-tone";
import { CopyButton } from "@/shared/components/copy-button";
import { cn } from "@/shared/lib/cn";

export function StatusBadge({ statusCode, failed = false }: { statusCode: number; failed?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn("h-5 min-w-8 justify-center px-1.5 text-xs font-normal", auditStatusBadgeClass(statusCode, failed))}
    >
      {statusCode}
    </Badge>
  );
}

export function OverviewField({
  className,
  label,
  value,
  copy,
}: {
  className?: string;
  label: string;
  value: string;
  copy?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 items-start gap-3 rounded-lg bg-muted/25 p-3", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p className="mt-0.5 break-all text-xs font-medium" title={value}>
          {value}
        </p>
      </div>
      {copy ? (
        <div className="shrink-0 pt-0.5">
          <CopyButton value={value} />
        </div>
      ) : null}
    </div>
  );
}

export function EmptyPanel({ icon, message }: { icon: ReactNode; message: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-lg bg-muted/15 px-6 text-center text-muted-foreground [&_svg]:size-6 [&_svg]:stroke-1">
      <span>{icon}</span>
      <p className="text-xs">{message}</p>
    </div>
  );
}

function HeaderRow({ name, values, index }: { name: string; values: string[]; index: number }) {
  return (
    <div
      className={cn(
        "grid gap-1 rounded-md px-2.5 py-2 transition-colors hover:bg-background/70 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4",
        index % 2 === 0 && "bg-background/35",
      )}
    >
      <span className="break-all font-mono text-[11px] text-muted-foreground">{name}</span>
      <div className="min-w-0 space-y-1">
        {values.map((value, valueIndex) => (
          <span
            key={`${name}-${valueIndex}`}
            className={cn(
              "block break-all font-mono text-[11px]",
              value === "[REDACTED]" && "font-semibold text-amber-700 dark:text-amber-300",
            )}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function HeadersPanelToolbar({ title, count, copyValue }: { title?: string; count: number; copyValue: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-10 shrink-0 items-center justify-between px-3">
      <span className="flex min-w-0 items-center gap-2 text-[11px]">
        {title ? <span className="truncate font-medium text-foreground">{title}</span> : null}
        <span className="text-muted-foreground">{t("audits.headerItemCount", { count })}</span>
      </span>
      <CopyButton value={copyValue} />
    </div>
  );
}

export function HeadersPanel({
  title,
  headers,
  emptyMessage,
}: {
  title?: string;
  headers: Record<string, string[]>;
  emptyMessage?: string;
}) {
  const { t } = useTranslation();
  const entries = useMemo(
    () => Object.entries(headers).sort(([left], [right]) => left.localeCompare(right)),
    [headers],
  );
  const copyValue = useMemo(() => JSON.stringify(headers, null, 2), [headers]);
  if (entries.length === 0)
    return <EmptyPanel icon={<FileText />} message={emptyMessage ?? t("audits.emptyResponseHeaders")} />;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-muted/15">
      <HeadersPanelToolbar title={title} count={entries.length} copyValue={copyValue} />
      <div className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-2">
        {entries.map(([name, values], entryIndex) => (
          <HeaderRow key={name} name={name} values={values} index={entryIndex} />
        ))}
      </div>
    </div>
  );
}

export function CodePanel({
  value,
  displayValue,
  emptyMessage,
  encoding,
  truncated,
}: {
  value: string;
  displayValue: string;
  emptyMessage: string;
  encoding: string;
  truncated: boolean;
}) {
  const { t } = useTranslation();
  if (!value) return <EmptyPanel icon={<FileText />} message={emptyMessage} />;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-muted/20">
      <div className="flex h-10 shrink-0 items-center justify-between px-3">
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground text-[11px]">
          <span>{t("audits.bodyEncoding", { encoding })}</span>
          {truncated ? (
            <Badge variant="outline" className="text-[10px]">
              {t("audits.bodyTruncated")}
            </Badge>
          ) : null}
        </span>
        <CopyButton value={value} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <pre className="font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all select-text">
          {displayValue}
        </pre>
      </div>
    </div>
  );
}
