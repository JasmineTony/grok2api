import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export function PageToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-h-12 flex-col items-stretch justify-between gap-3 border-b border-border/60 py-3 sm:flex-row sm:items-center sm:gap-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
