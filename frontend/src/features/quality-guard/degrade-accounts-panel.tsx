import { useTranslation } from "react-i18next";

import { DegradeEventsList } from "@/features/quality-guard/degrade-events-list";
import { NodeList } from "@/features/quality-guard/degrade-node-list";
import { SeriesChart } from "@/features/quality-guard/degrade-series-chart";
import { DegradeAccountsCard } from "@/features/quality-guard/degrade-accounts-table";
import { DegradeSummaryMetrics } from "@/features/quality-guard/degrade-summary-metrics";
import { useDegradeAccounts } from "@/features/quality-guard/use-degrade-accounts";
import { ErrorState } from "@/shared/components/data-state";

// 降级账号面板：只负责错误态/空态与区块组装；筛选状态、查询与 mutation 在 useDegradeAccounts，
// 展示拆到 metrics / series / node-list / accounts-table / events-list 五个组件。
// 阈值来自守护 status.config，与拆分前一致（决定「仍在调度」与峰值 TPS 的判定）。

export function DegradeAccountsPanel({
  softTPS,
  hardTPS,
  failClosed,
  minGenMs,
}: {
  softTPS?: number;
  hardTPS?: number;
  failClosed?: boolean;
  minGenMs?: number;
}) {
  const { t } = useTranslation();
  const controller = useDegradeAccounts({ softTPS, hardTPS, failClosed, minGenMs });
  const summary = controller.query.data;

  if (controller.query.isError && !summary)
    return <ErrorState message={controller.query.error.message} onRetry={() => void controller.query.refetch()} />;
  if (!summary) return null;

  return (
    <div className="space-y-4" data-testid="degrade-accounts-panel">
      <DegradeSummaryMetrics summary={summary} />
      <div className="grid items-stretch gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
        <SeriesChart
          series={summary.series}
          empty={t("qualityGuard.degrade.noHits")}
          title={t("qualityGuard.degrade.series")}
        />
        <NodeList
          nodes={summary.nodes}
          empty={t("qualityGuard.degrade.noNodes")}
          title={t("qualityGuard.degrade.nodes")}
        />
      </div>
      <DegradeAccountsCard controller={controller} summary={summary} />
      <DegradeEventsList events={summary.events} />
    </div>
  );
}
