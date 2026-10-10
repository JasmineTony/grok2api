import type { LucideIcon } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/shared/lib/cn";

export type DashboardMetricProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  loading: boolean;
};

/** 概览指标卡：标签、数值与补充说明；加载中显示 spinner 并隐藏说明。 */
export function DashboardMetric({ icon: Icon, label, value, detail, loading }: DashboardMetricProps) {
  return (
    <article className="min-h-28 rounded-lg bg-card p-4" aria-busy={loading}>
      <header className="flex min-h-5 items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      </header>
      <div className="mt-3 flex min-h-8 items-center text-2xl font-medium tracking-tight tabular-nums">
        {loading ? <Spinner /> : value}
      </div>
      <p
        className={cn("mt-1.5 min-h-4 truncate text-[11px] text-muted-foreground", loading && "invisible")}
        title={detail}
      >
        {detail}
      </p>
    </article>
  );
}
