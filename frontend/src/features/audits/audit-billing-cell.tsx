import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fallbackBillingBreakdown } from "@/features/audits/audit-format";
import type {
  AuditBillingBreakdownDTO,
  AuditBillingComponentDTO,
  AuditDTO,
} from "@/features/audits/request-audits-api";
import { cn } from "@/shared/lib/cn";
import { formatNumber } from "@/shared/lib/format";
import { formatUSDTicks, usdTicksToValue } from "@/shared/lib/usd";

function formatUSDCostCompact(ticks: number): string {
  const value = usdTicksToValue(ticks).toFixed(10).replace(/0+$/, "").replace(/\.$/, "");
  return `$${value}`;
}

function formatBillingComponentFormula(component: AuditBillingComponentDTO, locale: string): string {
  const quantity = formatNumber(component.quantity, locale, 0);
  if (component.unit === "token") {
    return `${quantity} / 1M × ${formatUSDCostCompact(component.unitPriceInUsdTicks * 1_000_000)}`;
  }
  return `${quantity} × ${formatUSDCostCompact(component.unitPriceInUsdTicks)} / ${component.unit}`;
}

function BillingDetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <span className="text-primary-foreground/65">{label}</span>
      <span className={cn("break-all text-right", mono && "font-mono")}>{value}</span>
    </div>
  );
}

function BillingFormula({ component, locale }: { component: AuditBillingComponentDTO; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
      <span className="text-primary-foreground/65">{t(`audits.billingComponents.${component.kind}`)}</span>
      <span className="break-words text-right font-mono tabular-nums">
        {formatBillingComponentFormula(component, locale)} = {formatUSDTicks(component.subtotalInUsdTicks, 10)}
      </span>
    </div>
  );
}

function BillingFormulaSection({ billing, locale }: { billing: AuditBillingBreakdownDTO; locale: string }) {
  const { t } = useTranslation();
  if (billing.method === "upstream_reported") return <p>{t("audits.billingUpstreamFormula")}</p>;
  if (billing.method === "stored_estimate") return <p>{t("audits.billingStoredFormulaUnavailable")}</p>;
  if (billing.components.length === 0) return <p>{t("audits.billingZeroFormula")}</p>;
  return (
    <div className="space-y-1">
      {billing.components.map((component) => (
        <BillingFormula key={component.kind} component={component} locale={locale} />
      ))}
    </div>
  );
}

function BillingBreakdown({ billing, locale }: { billing: AuditBillingBreakdownDTO; locale: string }) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2.5 text-xs leading-5">
      <div className="space-y-1">
        <BillingDetailRow
          label={t("audits.billingSource")}
          value={billing.source === "upstream" ? t("audits.billingSourceUpstream") : t("audits.billingSourceOfficial")}
        />
        {billing.model ? <BillingDetailRow label={t("audits.billingModel")} value={billing.model} mono /> : null}
        {billing.version ? <BillingDetailRow label={t("audits.billingVersion")} value={billing.version} /> : null}
        {billing.tier === "long_context" ? (
          <BillingDetailRow label={t("audits.billingRateTier")} value={t("audits.billingLongContextTier")} />
        ) : null}
      </div>
      <div className="border-t border-primary-foreground/15 pt-2">
        <div className="mb-1 text-primary-foreground/65">{t("audits.billingFormula")}</div>
        <BillingFormulaSection billing={billing} locale={locale} />
      </div>
      <div className="flex items-baseline justify-between gap-4 border-t border-primary-foreground/15 pt-2 font-medium">
        <span>{t("audits.billingConclusion")}</span>
        <span className="font-mono tabular-nums">{formatUSDTicks(billing.totalInUsdTicks, 10)}</span>
      </div>
    </div>
  );
}

export function BillingValue({ audit }: { audit: AuditDTO }) {
  const { t, i18n } = useTranslation();
  const billing = audit.billing ?? fallbackBillingBreakdown(audit);
  const amount = billing ? formatUSDTicks(billing.totalInUsdTicks, 2) : t("audits.unbilled");
  return (
    <div className="max-w-full text-left">
      {billing ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="block cursor-help whitespace-nowrap text-xs tabular-nums" tabIndex={0}>
              {amount}
            </span>
          </TooltipTrigger>
          <TooltipContent className="w-96 max-w-[calc(100vw-2rem)] p-3" side="top" align="start">
            <BillingBreakdown billing={billing} locale={i18n.language} />
          </TooltipContent>
        </Tooltip>
      ) : (
        <span className="block whitespace-nowrap text-xs text-muted-foreground">{amount}</span>
      )}
      {audit.numServerSideToolsUsed > 0 ? (
        <span className="mt-0.5 block whitespace-nowrap text-[10px] text-muted-foreground">
          {t("audits.serverTools", { count: audit.numServerSideToolsUsed })}
        </span>
      ) : null}
    </div>
  );
}
