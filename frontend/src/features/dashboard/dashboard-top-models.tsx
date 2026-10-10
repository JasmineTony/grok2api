import { useTranslation } from "react-i18next";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import { DashboardPanel } from "@/features/dashboard/dashboard-panel";
import { TopModelRow } from "@/features/dashboard/dashboard-top-models-row";
import { EmptyState, TableLoadingRow } from "@/shared/components/data-state";

type DashboardTopModelsProps = {
  dashboard?: DashboardDTO;
  locale: string;
  loading: boolean;
};

const COLUMN_COUNT = 4;

/** Top 模型面板：模型、计费、tokens 与请求数四列，空数据展示空态。 */
export function DashboardTopModels({ dashboard, locale, loading }: DashboardTopModelsProps) {
  const { t } = useTranslation();
  const models = dashboard?.topModels ?? [];

  return (
    <DashboardPanel id="dashboard-top-models-title" title={t("dashboard.topModels")} className="h-full">
      <Table className="min-w-[560px] table-fixed [&_tbody_tr]:border-border/60">
        <TopModelsHeader />
        <TableBody>
          {loading ? (
            <TableLoadingRow colSpan={COLUMN_COUNT} />
          ) : models.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={COLUMN_COUNT} className="p-0">
                <EmptyState message={t("dashboard.noTopModels")} />
              </TableCell>
            </TableRow>
          ) : (
            models.map((item) => <TopModelRow key={item.model} item={item} locale={locale} />)
          )}
        </TableBody>
      </Table>
    </DashboardPanel>
  );
}

function TopModelsHeader() {
  const { t } = useTranslation();
  return (
    <TableHeader className="[&_tr]:border-border/70">
      <TableRow className="hover:bg-transparent">
        <TableHead>{t("dashboard.model")}</TableHead>
        <TableHead className="w-28 whitespace-nowrap">
          <span className="flex items-center justify-end gap-1.5">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t("dashboard.billing")}
          </span>
        </TableHead>
        <TableHead className="w-28">
          <span className="flex items-center justify-end gap-1.5">
            <span className="size-1.5 rounded-full bg-violet-500" />
            {t("dashboard.trendTokens")}
          </span>
        </TableHead>
        <TableHead className="w-28">
          <span className="flex items-center justify-end gap-1.5">
            <span className="size-1.5 rounded-full bg-sky-500" />
            {t("dashboard.trendRequests")}
          </span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}
