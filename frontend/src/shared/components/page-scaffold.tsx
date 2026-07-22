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
      className={cn("mx-auto w-full max-w-[1440px] flex-1 px-5 py-8 sm:px-8 lg:py-20", className)}
    >
      {children}
    </div>
  );
}
