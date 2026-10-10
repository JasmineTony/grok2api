import {
  Activity,
  ArrowDown,
  ArrowUp,
  BrainCircuit,
  CircleCheck,
  CircleDollarSign,
  Database,
  WholeWord,
} from "lucide-react";

import { AuditMetric, AuditTokenMetric } from "@/features/audits/audit-metric-cards";
import { useTranslation } from "react-i18next";

export type AuditSummaryDisplay = {
  requests: string;
  requestBreakdown: string;
  totalTokens: string;
  tokenEfficiency: string;
  successRate: string;
  averageDuration: string;
  estimatedCost: string;
  exactEstimatedCost?: string;
  pricingCoverage: string;
  inputTokens: string;
  outputTokens: string;
  cachedTokens: string;
  reasoningTokens: string;
};

export function AuditSummarySection({ loading, display }: { loading: boolean; display: AuditSummaryDisplay }) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2" aria-label={t("audits.usageSummary")}>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <AuditMetric
          icon={Activity}
          loading={loading}
          label={t("audits.totalRequests")}
          value={display.requests}
          detail={display.requestBreakdown}
        />
        <AuditMetric
          icon={WholeWord}
          loading={loading}
          label={t("audits.totalTokens")}
          value={display.totalTokens}
          detail={display.tokenEfficiency}
        />
        <AuditMetric
          icon={CircleCheck}
          loading={loading}
          label={t("audits.successRate")}
          value={display.successRate}
          detail={display.averageDuration}
        />
        <AuditMetric
          icon={CircleDollarSign}
          loading={loading}
          label={t("audits.estimatedCost")}
          value={display.estimatedCost}
          fullValue={display.exactEstimatedCost}
          detail={display.pricingCoverage}
          tooltip={t("audits.pricingDescription")}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <AuditTokenMetric icon={ArrowUp} loading={loading} label={t("audits.input")} value={display.inputTokens} />
        <AuditTokenMetric icon={ArrowDown} loading={loading} label={t("audits.output")} value={display.outputTokens} />
        <AuditTokenMetric icon={Database} loading={loading} label={t("audits.cached")} value={display.cachedTokens} />
        <AuditTokenMetric
          icon={BrainCircuit}
          loading={loading}
          label={t("audits.reasoning")}
          value={display.reasoningTokens}
        />
      </div>
    </section>
  );
}
