import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

export function PageToolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex min-h-12 flex-wrap items-center justify-between gap-3 py-2", className)}
    >
      {children}
    </div>
  );
}
