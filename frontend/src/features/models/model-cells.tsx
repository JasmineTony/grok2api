import { useTranslation } from "react-i18next";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import {
  displayCapabilityLabel,
  endpointCapabilityMetadata,
  providerDotClassName,
  providerLabel,
  type ModelDisplayCapability,
  type ModelRouteGroup,
} from "@/features/models/model-display";
import { cn } from "@/shared/lib/cn";

// 模型表格单元格的展示组件：与数据获取/交互状态解耦，props 驱动。

export function ModelProvider({ provider }: { provider: ModelRouteDTO["provider"] }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-full", providerDotClassName(provider))} />
      {providerLabel(provider, t)}
    </span>
  );
}

export function ModelCapabilities({ capabilities }: { capabilities: ModelDisplayCapability[] }) {
  const { t } = useTranslation();
  return (
    <span className="mx-auto inline-flex max-w-28 flex-wrap items-center justify-center gap-0.5">
      {capabilities.map((capability) => {
        const metadata = endpointCapabilityMetadata[capability];
        const Icon = metadata.icon;
        const label = displayCapabilityLabel(capability, t);
        return (
          <Tooltip key={capability}>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="img"
                aria-label={label}
                className={cn(
                  "inline-flex size-5 cursor-help items-center justify-center rounded outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
                  metadata.color,
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.8} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="space-y-0.5 text-left">
              <div className="font-medium">{label}</div>
              <code className="block text-[10px] text-primary-foreground/70">
                {metadata.method} {metadata.path}
              </code>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}

export function ModelEnabledStateBadge({ state }: { state: ModelRouteGroup["enabledState"] }) {
  const { t } = useTranslation();
  if (state === "enabled") {
    return (
      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
        {t("common.enabled")}
      </Badge>
    );
  }
  if (state === "disabled") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t("common.disabled")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-amber-700 dark:text-amber-300">
      {t("models.partiallyEnabled")}
    </Badge>
  );
}

export function ModelAccountSupportCell({ model }: { model: ModelRouteGroup }) {
  const { t } = useTranslation();
  const bindingKey =
    model.bindingState === "bound"
      ? "models.boundAccounts"
      : model.bindingState === "automatic"
        ? "models.automaticAccounts"
        : "models.mixedAccounts";
  return (
    <div title={model.supportTitle}>
      <span className="inline-flex items-baseline gap-1 tabular-nums">
        <span
          className={cn(
            "font-medium",
            model.supportedMax > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        >
          {model.supportedLabel}
        </span>
        <span className="text-muted-foreground">/ {model.totalLabel}</span>
      </span>
      <span className="mt-0.5 block text-[10px] text-muted-foreground">{t(bindingKey)}</span>
    </div>
  );
}
