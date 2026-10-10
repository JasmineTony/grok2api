import { useMemo } from "react";

import type { DashboardDTO } from "@/features/dashboard/dashboard-api";
import {
  buildProviderStripes,
  collectProviderUsage,
  type ProviderUsage,
} from "@/features/dashboard/dashboard-provider-format";

export type ProviderUsageModel = {
  providers: ProviderUsage[];
  stripes: Array<ProviderUsage | null>;
  totalRequests: number;
  averageSuccessRate: number;
};

/** Provider 用量模型：三类 Provider 对齐、请求总数、平均成功率与色带。 */
export function useProviderUsage(dashboard: DashboardDTO | undefined): ProviderUsageModel {
  const providers = useMemo(() => collectProviderUsage(dashboard?.providers), [dashboard?.providers]);
  const totalRequests = providers.reduce((total, item) => total + item.requests, 0);
  const totalSuccessfulRequests = providers.reduce((total, item) => total + item.successfulRequests, 0);
  const averageSuccessRate = totalRequests > 0 ? (totalSuccessfulRequests / totalRequests) * 100 : 0;
  const stripes = useMemo(() => buildProviderStripes(providers, totalRequests), [providers, totalRequests]);
  return { providers, stripes, totalRequests, averageSuccessRate };
}
