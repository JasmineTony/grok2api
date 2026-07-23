import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type DashboardPanelProps = {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  style?: CSSProperties;
};

export function DashboardPanel({
  id,
  title,
  actions,
  children,
  className,
  contentClassName,
  style,
}: DashboardPanelProps) {
  return (
    <section
      className={cn("rounded-lg bg-card p-4 sm:p-5", className)}
      style={style}
      aria-labelledby={id}
    >
      <header className="flex min-h-8 items-center justify-between gap-3">
        <h2 id={id} className="text-sm font-medium">
          {title}
        </h2>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className={cn("mt-4", contentClassName)}>{children}</div>
    </section>
  );
}
