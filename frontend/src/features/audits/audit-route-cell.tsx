import { CornerDownRight, Globe2 } from "lucide-react";
import type { ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { auditChannelProtocolLabel } from "@/features/audits/audit-format";
import type { AuditDTO } from "@/features/audits/request-audits-api";
import { cn } from "@/shared/lib/cn";

type RouteValueProps = {
  model: string;
  upstreamModel: string;
  account: string;
  clientKey: string;
  clientIp?: string;
  requestId: string;
  provider: AuditDTO["provider"];
  operation: AuditDTO["operation"];
  sources: number;
};

function RouteDetailRow({ label, value, breakAll = false }: { label: string; value: string; breakAll?: boolean }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 text-xs font-normal leading-4">
      <span className="text-primary-foreground/65">{label}</span>
      <span className={cn("text-right", breakAll ? "break-all" : "truncate")} title={value}>
        {value}
      </span>
    </div>
  );
}

/**
 * Tooltip 触发器：Radix 通过 asChild 注入的指针/焦点事件必须落到真实按钮上，
 * 否则路由详情提示永远无法打开（曾因未转发触发器属性而丢失整块诊断信息）。
 */
function ModelRouteTrigger({
  model,
  upstreamModel,
  clientIp,
  ariaLabel,
  ...triggerProps
}: {
  model: string;
  upstreamModel: string;
  clientIp?: string;
  ariaLabel: string;
} & Omit<ComponentProps<"button">, "children" | "className" | "type" | "aria-label">) {
  return (
    <button
      type="button"
      className="block w-full min-w-0 cursor-help text-left"
      aria-label={ariaLabel}
      {...triggerProps}
    >
      <span className="block truncate text-xs font-medium" title={model}>
        {model}
      </span>
      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
        <CornerDownRight className="size-3 shrink-0" />
        <span className="truncate" title={upstreamModel}>
          {upstreamModel}
        </span>
      </span>
      {clientIp ? (
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-muted-foreground/80">
          <Globe2 className="size-3 shrink-0" />
          <span className="truncate font-mono" title={clientIp}>
            {clientIp}
          </span>
        </span>
      ) : null}
    </button>
  );
}

export function ModelRouteValue({
  model,
  upstreamModel,
  account,
  clientKey,
  clientIp,
  requestId,
  provider,
  operation,
  sources,
}: RouteValueProps) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <ModelRouteTrigger
          model={model}
          upstreamModel={upstreamModel}
          clientIp={clientIp}
          ariaLabel={t("audits.routeDetails")}
        />
      </TooltipTrigger>
      <TooltipContent className="w-72 max-w-[calc(100vw-2rem)] space-y-1.5 py-2" side="top" align="start">
        <RouteDetailRow
          label={t("audits.channelProtocol")}
          value={auditChannelProtocolLabel({ provider, operation })}
        />
        <RouteDetailRow label={t("audits.requestId")} value={requestId} breakAll />
        {clientIp ? <RouteDetailRow label={t("audits.clientIp")} value={clientIp} breakAll /> : null}
        <RouteDetailRow label={t("audits.actualModel")} value={upstreamModel} breakAll />
        <RouteDetailRow label={t("audits.owningAccount")} value={account} />
        <RouteDetailRow label={t("audits.owningKey")} value={clientKey} />
        {sources > 0 ? <RouteDetailRow label={t("audits.sourcesLabel")} value={String(sources)} /> : null}
      </TooltipContent>
    </Tooltip>
  );
}
