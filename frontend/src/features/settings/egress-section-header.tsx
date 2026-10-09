import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 出口分区标题：标题 + 帮助图标，右侧可放置分区级操作。 */
export function EgressSectionHeader({ title, help, children }: { title: string; help: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground transition-colors hover:text-foreground"
              aria-label={help}
            >
              <CircleHelp className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent className="max-w-80">{help}</TooltipContent>
        </Tooltip>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-1.5">{children}</div> : null}
    </div>
  );
}

/** 为分区操作按钮补充悬浮说明，不改变按钮本身的语义。 */
export function EgressActionTooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-80">{label}</TooltipContent>
    </Tooltip>
  );
}
