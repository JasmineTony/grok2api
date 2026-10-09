import type { TFunction } from "i18next";
import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  MessagesSquare,
  MessageSquareText,
  Mic,
  Paintbrush,
  Radio,
  SquareTerminal,
} from "lucide-react";

import type { ModelEndpointCapability, ModelRouteDTO, ModelRouteGroupDTO } from "@/entities/model/types";

// 模型页的展示模型与文案映射：从 models-page.tsx 拆出，保持纯函数以便独立验证。

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

export const endpointCapabilityMetadata = {
  completions: {
    icon: MessageSquareText,
    method: "POST",
    path: "/v1/chat/completions",
    color: "text-sky-600 dark:text-sky-400",
  },
  responses: {
    icon: SquareTerminal,
    method: "POST",
    path: "/v1/responses",
    color: "text-violet-600 dark:text-violet-400",
  },
  messages: {
    icon: MessagesSquare,
    method: "POST",
    path: "/v1/messages",
    color: "text-orange-600 dark:text-orange-400",
  },
  image: {
    icon: ImageIcon,
    method: "POST",
    path: "/v1/images/generations",
    color: "text-emerald-600 dark:text-emerald-400",
  },
  image_edit: {
    icon: Paintbrush,
    method: "POST",
    path: "/v1/images/edits",
    color: "text-amber-700 dark:text-amber-400",
  },
  video: {
    icon: Clapperboard,
    method: "POST",
    path: "/v1/videos/generations",
    color: "text-rose-600 dark:text-rose-400",
  },
  tts: { icon: AudioLines, method: "POST", path: "/v1/tts", color: "text-cyan-700 dark:text-cyan-400" },
  stt: { icon: Mic, method: "POST", path: "/v1/stt", color: "text-teal-700 dark:text-teal-400" },
  realtime: { icon: Radio, method: "GET", path: "/v1/realtime", color: "text-sky-700 dark:text-sky-400" },
} as const;

export function newModelRouteGroup(value: ModelRouteGroupDTO, t: TFunction): ModelRouteGroup {
  const routes = value.routes;
  const first = routes[0];
  const enabledCount = routes.filter((route) => route.enabled).length;
  const boundCount = routes.filter((route) => route.bindingMode).length;
  const supportedValues = routes.map((route) => route.supportedAccounts);
  const totalValues = routes.map((route) => route.totalAccounts);
  const supportedMin = Math.min(...supportedValues);
  const supportedMax = Math.max(...supportedValues);
  const totalMin = Math.min(...totalValues);
  const totalMax = Math.max(...totalValues);
  const syncedTimes = routes
    .map((route) => route.lastSyncedAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    key: value.key,
    routes,
    publicId: first.publicId,
    provider: first.provider,
    upstreamModel: first.upstreamModel,
    capabilities: value.endpointCapabilities,
    enabledState: enabledCount === routes.length ? "enabled" : enabledCount === 0 ? "disabled" : "mixed",
    bindingState: boundCount === routes.length ? "bound" : boundCount === 0 ? "automatic" : "mixed",
    supportedMax,
    supportedLabel: supportedMin === supportedMax ? String(supportedMax) : `${supportedMin}–${supportedMax}`,
    totalLabel: totalMin === totalMax ? String(totalMax) : `${totalMin}–${totalMax}`,
    supportTitle: routes
      .map(
        (route) =>
          `${capabilityLabel(route.capability, t)}: ${t("models.supportSummary", { supported: route.supportedAccounts, total: route.totalAccounts })}`,
      )
      .join("\n"),
    lastSyncedAt: syncedTimes.at(-1),
  };
}

export function capabilityLabel(capability: ModelRouteDTO["capability"], t: TFunction): string {
  if (capability === "responses" || capability === "chat") return t("models.capabilityConversation");
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
    tts: t("models.capabilityTTS"),
    stt: t("models.capabilitySTT"),
    realtime: t("models.capabilityRealtime"),
  }[capability];
}

export function providerLabel(provider: ModelRouteDTO["provider"], t: TFunction): string {
  if (provider === "grok_web") return t("models.providerGrokWeb");
  if (provider === "grok_console") return t("console.name");
  return t("models.providerGrokBuild");
}

export function providerDotClassName(provider: ModelRouteDTO["provider"]): string {
  if (provider === "grok_web") return "bg-quota-product-2";
  if (provider === "grok_console") return "bg-quota-product-4";
  return "bg-quota-product-1";
}
