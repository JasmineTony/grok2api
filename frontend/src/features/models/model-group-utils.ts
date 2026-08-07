import type { TFunction } from "i18next";

import type {
  ModelEndpointCapability,
  ModelRouteDTO,
  ModelRouteGroupDTO,
} from "@/entities/model/types";

export type ModelDisplayCapability = ModelEndpointCapability;

export type ModelRouteGroup = {
  key: string;
  routes: ModelRouteDTO[];
  publicId: string;
  provider: ModelRouteDTO["provider"];
  upstreamModel: string;
  capabilities: ModelDisplayCapability[];
  enabledState: "enabled" | "disabled" | "mixed";
  bindingState: "automatic" | "bound" | "mixed";
  supportedMax: number;
  supportedLabel: string;
  totalLabel: string;
  supportTitle: string;
  lastSyncedAt?: string;
};

export function newModelRouteGroup(value: ModelRouteGroupDTO, t: TFunction): ModelRouteGroup {
  const routes = value.routes;
  const first = routes[0];
  if (!first) throw new Error("model route group must contain at least one route");
  const enabledCount = routes.filter((route) => route.enabled).length;
  const boundCount = routes.filter((route) => route.bindingMode).length;
  const supportedValues = routes.map((route) => route.supportedAccounts);
  const totalValues = routes.map((route) => route.totalAccounts);
  const supportedMin = Math.min(...supportedValues);
  const supportedMax = Math.max(...supportedValues);
  const totalMin = Math.min(...totalValues);
  const totalMax = Math.max(...totalValues);
  const lastSyncedAt = routes
    .map((route) => route.lastSyncedAt)
    .filter((candidate): candidate is string => Boolean(candidate))
    .reduce<string | undefined>(
      (latest, candidate) => (latest === undefined || candidate > latest ? candidate : latest),
      undefined,
    );
  return {
    key: value.key,
    routes,
    publicId: first.publicId,
    provider: first.provider,
    upstreamModel: first.upstreamModel,
    capabilities: value.endpointCapabilities,
    enabledState:
      enabledCount === routes.length ? "enabled" : enabledCount === 0 ? "disabled" : "mixed",
    bindingState: boundCount === routes.length ? "bound" : boundCount === 0 ? "automatic" : "mixed",
    supportedMax,
    supportedLabel:
      supportedMin === supportedMax ? String(supportedMax) : `${supportedMin}–${supportedMax}`,
    totalLabel: totalMin === totalMax ? String(totalMax) : `${totalMin}–${totalMax}`,
    supportTitle: routes
      .map(
        (route) =>
          `${capabilityLabel(route.capability, t)}: ${t("models.supportSummary", { supported: route.supportedAccounts, total: route.totalAccounts })}`,
      )
      .join("\n"),
    ...(lastSyncedAt !== undefined ? { lastSyncedAt } : {}),
  };
}

export function capabilityLabel(capability: ModelRouteDTO["capability"], t: TFunction): string {
  if (capability === "responses" || capability === "chat")
    return t("models.capabilityConversation");
  return displayCapabilityLabel(capability, t);
}

export function displayCapabilityLabel(capability: ModelDisplayCapability, t: TFunction): string {
  return {
    completions: t("models.capabilityCompletions"),
    responses: t("models.capabilityResponses"),
    messages: t("models.capabilityMessages"),
    image: t("models.capabilityImage"),
    image_edit: t("models.capabilityImageEdit"),
    video: t("models.capabilityVideo"),
  }[capability];
}
