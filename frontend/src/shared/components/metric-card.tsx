import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export function MetricCard({
  label,
  value,
  detail,
  icon,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("min-h-28 rounded-lg bg-card p-4", className)}>
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div className="mt-3 flex min-h-8 items-center text-2xl font-medium tracking-tight tabular-nums">
        {value}
      </div>
      {detail ? (
        <div className="mt-1.5 min-h-4 text-[11px] text-muted-foreground">
          {detail}
        </div>
      ) : null}
    </article>
  );
}
