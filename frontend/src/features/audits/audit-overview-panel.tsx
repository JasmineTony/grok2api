import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { OverviewField } from "@/features/audits/audit-detail-common";
import { buildAuditOverviewFields } from "@/features/audits/audit-detail-format";
import type { AuditDTO } from "@/features/audits/request-audits-api";
import { formatNumber } from "@/shared/lib/format";
import { formatUSDTicksWithEstimate } from "@/shared/lib/usd";

export function AuditOverviewPanel({ audit }: { audit: AuditDTO }) {
  const { t, i18n } = useTranslation();
  const fields = useMemo(() => {
    const cost = formatUSDTicksWithEstimate(audit.costInUsdTicks, audit.estimatedCostInUsdTicks, t("audits.estimated"));
    return buildAuditOverviewFields(audit, (value) => formatNumber(value, i18n.language), cost, t);
  }, [audit, i18n.language, t]);
  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {fields.map((field) => (
        <OverviewField
          key={`${field.label}:${field.value}`}
          className={field.fullWidth ? "sm:col-span-2" : undefined}
          label={field.label}
          value={field.value}
          copy={field.copy}
        />
      ))}
    </div>
  );
}
