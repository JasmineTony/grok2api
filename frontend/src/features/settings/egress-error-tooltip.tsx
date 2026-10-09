import { CircleAlert } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** 表格内的悬浮错误说明：节点 lastError 与订阅源 lastSyncError 共用。 */
export function EgressErrorTooltip({ message }: { message: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0 cursor-help text-destructive" tabIndex={0} aria-label={message}>
          <CircleAlert className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-80">{message}</TooltipContent>
    </Tooltip>
  );
}
