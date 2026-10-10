import { useTranslation } from "react-i18next";

import { TableCell, TableRow } from "@/components/ui/table";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { formatCompactTokens, formatUSD } from "@/features/dashboard/dashboard-format";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";

export type TopModel = DashboardDTO["topModels"][number];

/** 单个模型行：模型与 tokens 明细、计费、tokens、请求数。 */
export function TopModelRow({ item, locale }: { item: TopModel; locale: string }) {
  const inactive = item.requests === 0;
  return (
    <TableRow className="h-14">
      <TableCell>
        <TopModelIdentity item={item} locale={locale} />
      </TableCell>
      <TopModelBilling item={item} locale={locale} />
      <TopModelTokens item={item} locale={locale} />
      <TableCell className="text-right tabular-nums">
        <span
          className={cn(
            "text-xs font-medium text-sky-600 dark:text-sky-400",
            inactive && "font-normal text-muted-foreground",
          )}
        >
          {formatNumber(item.requests, locale)}
        </span>
      </TableCell>
    </TableRow>
  );
}

function TopModelIdentity({ item, locale }: { item: TopModel; locale: string }) {
  const { t } = useTranslation();
  const tokenDetails = [
    [t("dashboard.inputTokens"), item.inputTokens],
    [t("dashboard.outputTokens"), item.outputTokens],
    ...(item.cachedInputTokens > 0 ? [[t("dashboard.cachedTokens"), item.cachedInputTokens]] : []),
    ...(item.reasoningTokens > 0 ? [[t("dashboard.reasoningTokens"), item.reasoningTokens]] : []),
  ];
  return (
    <div className="min-w-0">
      <span
        className={cn("block truncate text-xs font-medium", item.requests === 0 && "font-normal text-muted-foreground")}
        title={item.model}
      >
        {item.model}
      </span>
      <p className="mt-1 truncate text-[10px] text-muted-foreground/80">
        {tokenDetails.map(([label, value]) => `${label} ${formatNumber(Number(value), locale)}`).join(" · ")}
      </p>
    </div>
  );
}

function TopModelBilling({ item, locale }: { item: TopModel; locale: string }) {
  return (
    <TableCell
      className={cn(
        "whitespace-nowrap text-right text-xs font-medium tabular-nums text-emerald-600 dark:text-emerald-400",
        item.billedCostUsdTicks === 0 && "font-normal text-muted-foreground",
      )}
    >
      {formatUSD(item.billedCostUsdTicks, locale)}
    </TableCell>
  );
}

function TopModelTokens({ item, locale }: { item: TopModel; locale: string }) {
  return (
    <TableCell
      className={cn(
        "text-right text-xs font-medium tabular-nums text-violet-600 dark:text-violet-400",
        item.tokens === 0 && "font-normal text-muted-foreground",
      )}
      title={formatNumber(item.tokens, locale)}
    >
      {formatCompactTokens(item.tokens, locale)}
    </TableCell>
  );
}
