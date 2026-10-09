import type { TFunction } from "i18next";

import type { ProviderScopeValue, TierScopeValue } from "@/features/client-keys/client-keys-api";

/** 账号范围展示标签的唯一来源：表格摘要与表单摘要共用，避免两套文案。 */
export function providerScopeLabels(t: TFunction): Record<ProviderScopeValue, string> {
  return { all: t("keys.allProviders"), grok_build: "Build", grok_web: "Web", grok_console: "Console" };
}

export function tierScopeLabels(t: TFunction): Record<TierScopeValue, string> {
  return { all: t("keys.allTiers"), free: "Free", super: "Super" };
}

export function providerScopeValues(scope: ProviderScopeValue[]): Exclude<ProviderScopeValue, "all">[] {
  return scope.filter((value): value is Exclude<ProviderScopeValue, "all"> => value !== "all");
}

export function tierScopeValues(scope: TierScopeValue[]): Exclude<TierScopeValue, "all">[] {
  return scope.filter((value): value is Exclude<TierScopeValue, "all"> => value !== "all");
}

export function providerScopeSummary(t: TFunction, scope: ProviderScopeValue[]): string {
  if (scope.includes("all")) return t("keys.allProviders");
  const labels = providerScopeLabels(t);
  return providerScopeValues(scope)
    .map((value) => labels[value])
    .join(" · ");
}

export function tierScopeSummary(t: TFunction, scope: TierScopeValue[]): string {
  if (scope.includes("all")) return t("keys.allTiers");
  const labels = tierScopeLabels(t);
  return tierScopeValues(scope)
    .map((value) => labels[value])
    .join(" · ");
}

export function modelScopeSummary(t: TFunction, mode: "all" | "restricted", count: number): string {
  return mode === "all" ? t("keys.allModels") : t("keys.selectedModels", { count });
}
