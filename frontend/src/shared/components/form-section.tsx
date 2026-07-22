import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type FormSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
};

/** Groups related form controls without coupling shared UI to feature data or APIs. */
export function FormSection({
  title,
  description,
  children,
  actions,
  className,
}: FormSectionProps) {
  return (
    <section className={cn("space-y-4 rounded-lg border bg-card p-4 sm:p-5", className)}>
      <header className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
