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
import type { ReactElement } from "react";

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

type AuditSummarySectionProps = { loading: boolean; display: AuditSummaryDisplay };

export function AuditSummarySection({ loading, display }: AuditSummarySectionProps): ReactElement {
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
      <AuditSummaryTokenMetrics loading={loading} display={display} />
    </section>
  );
}

/** 令牌四宫格单独成组件：保持既有 aria 结构与 DOM 不变，同时让父组件满足 REV-2 的 50 行上限。 */
function AuditSummaryTokenMetrics({ loading, display }: AuditSummarySectionProps): ReactElement {
  const { t } = useTranslation();
  return (
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
  );
}
