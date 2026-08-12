import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";

/** Consistent application gutter and maximum content width. */
export function PageScaffold({
  children,
  className,
}: {
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div
      data-layout="page-scaffold"
      className={cn(
        "mx-auto w-full max-w-[1600px] min-w-0 flex-1 px-4 py-6 sm:px-6 sm:py-8 lg:px-10 lg:py-10 xl:px-12",
        className,
      )}
    >
      {children}
    </div>
  );
}
