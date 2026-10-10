import type { TFunction } from "i18next";

import type { DashboardDTO } from "@/features/dashboard/dashboard-api";

export type ProviderKey = "grok_build" | "grok_web" | "grok_console";

export type ProviderDescriptor = { key: ProviderKey; color: string; dot: string };

export type ProviderUsage = ProviderDescriptor & {
  requests: number;
  successfulRequests: number;
  tokens: number;
};

export const STRIPE_COUNT = 40;

export const PROVIDERS: ProviderDescriptor[] = [
  { key: "grok_build", color: "bg-quota-product-1", dot: "bg-quota-product-1" },
  { key: "grok_web", color: "bg-quota-product-2", dot: "bg-quota-product-2" },
  { key: "grok_console", color: "bg-quota-product-4", dot: "bg-quota-product-4" },
];

/** 把 dashboard.providers 对齐到三类 Provider，缺失的计 0。 */
export function collectProviderUsage(providers: DashboardDTO["providers"] | undefined): ProviderUsage[] {
  return PROVIDERS.map((provider) => {
    const usage = providers?.find((item) => item.provider === provider.key);
    return {
      ...provider,
      requests: usage?.requests ?? 0,
      successfulRequests: usage?.successfulRequests ?? 0,
      tokens: usage?.tokens ?? 0,
    };
  });
}

/** 按请求占比把 STRIPE_COUNT 条色带映射到 Provider；无请求时全部为空。 */
export function buildProviderStripes<T extends { requests: number }>(
  providers: T[],
  totalRequests: number,
): Array<T | null> {
  if (totalRequests <= 0) return Array.from({ length: STRIPE_COUNT }, () => null);
  const boundaries: number[] = [];
  let cumulative = 0;
  for (const provider of providers) {
    cumulative += provider.requests;
    boundaries.push(cumulative / totalRequests);
  }
  return Array.from({ length: STRIPE_COUNT }, (_, index) => {
    const position = (index + 0.5) / STRIPE_COUNT;
    const providerIndex = boundaries.findIndex((boundary) => position <= boundary);
    return providers[providerIndex >= 0 ? providerIndex : providers.length - 1] ?? null;
  });
}

export function providerLabel(provider: ProviderKey, t: TFunction): string {
  if (provider === "grok_build") return t("models.providerGrokBuild");
  if (provider === "grok_web") return t("models.providerGrokWeb");
  return t("console.name");
}

/** tooltip 水平位置钳制在视口内，避免贴边溢出。 */
export function clampTooltipX(value: number): number {
  const inset = Math.min(136, Math.max(8, window.innerWidth / 2 - 8));
  return Math.min(window.innerWidth - inset, Math.max(inset, value));
}
