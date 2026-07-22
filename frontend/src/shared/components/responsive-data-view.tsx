import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

type ResponsiveDataViewProps = {
  table: ReactNode;
  cards: ReactNode;
  className?: string;
  tableClassName?: string;
  cardsClassName?: string;
};

/** Selects table or card presentation using CSS only, preserving one data/container boundary. */
export function ResponsiveDataView({
  table,
  cards,
  className,
  tableClassName,
  cardsClassName,
}: ResponsiveDataViewProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className={cn("hidden min-w-0 md:block", tableClassName)}>{table}</div>
      <div className={cn("grid gap-3 md:hidden", cardsClassName)}>{cards}</div>
    </div>
  );
}
