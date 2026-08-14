import {
  AudioLines,
  Clapperboard,
  Image as ImageIcon,
  MessageSquareText,
  MessagesSquare,
  Mic,
  Paintbrush,
  Radio,
  SquareTerminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import {
  displayCapabilityLabel,
  type ModelDisplayCapability,
} from "@/features/models/model-group-utils";
import { cn } from "@/shared/lib/cn";

const endpointCapabilityMetadata = {
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
  tts: {
    icon: AudioLines,
    method: "POST",
    path: "/v1/tts",
    color: "text-cyan-700 dark:text-cyan-400",
  },
  stt: {
    icon: Mic,
    method: "POST",
    path: "/v1/stt",
    color: "text-teal-700 dark:text-teal-400",
  },
  realtime: {
    icon: Radio,
    method: "GET",
    path: "/v1/realtime",
    color: "text-sky-700 dark:text-sky-400",
  },
} as const satisfies Record<
  ModelDisplayCapability,
  { icon: typeof MessageSquareText; method: string; path: string; color: string }
>;
export function ModelProvider({ provider }: { provider: ModelRouteDTO["provider"] }) {
  const { t } = useTranslation();
  const label =
    provider === "grok_web"
      ? t("models.providerGrokWeb")
      : provider === "grok_console"
        ? t("console.name")
        : t("models.providerGrokBuild");
  const color =
    provider === "grok_web"
      ? "bg-quota-product-2"
      : provider === "grok_console"
        ? "bg-quota-product-4"
        : "bg-quota-product-1";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
      <span className={cn("size-2 rounded-full", color)} />
      {label}
    </span>
  );
}

export function ModelCapabilities({ capabilities }: { capabilities: ModelDisplayCapability[] }) {
  const { t } = useTranslation();
  return (
    <span className="mx-auto inline-flex max-w-28 flex-wrap items-center justify-center gap-0.5">
      {capabilities.map((capability) => {
        const metadata = endpointCapabilityMetadata[capability];
        const Icon = metadata.icon;
        const label = displayCapabilityLabel(capability, t);
        return (
          <Tooltip key={capability}>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                role="img"
                aria-label={label}
                className={cn(
                  "inline-flex size-5 cursor-help items-center justify-center rounded outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40",
                  metadata.color,
                )}
              >
                <Icon className="size-3.5" strokeWidth={1.8} />
              </span>
            </TooltipTrigger>
            <TooltipContent className="space-y-0.5 text-left">
              <div className="font-medium">{label}</div>
              <code className="block text-[10px] text-primary-foreground/70">
                {metadata.method} {metadata.path}
              </code>
            </TooltipContent>
          </Tooltip>
        );
      })}
    </span>
  );
}
