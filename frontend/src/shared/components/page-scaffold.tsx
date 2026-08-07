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
      className={cn(
        "mx-auto w-full max-w-[1520px] flex-1 px-4 py-6 sm:px-7 lg:px-10 lg:py-12 xl:px-12",
        className,
      )}
    >
      {children}
    </div>
  );
}
