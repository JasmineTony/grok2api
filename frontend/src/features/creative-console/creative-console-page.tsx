import { ExternalLink, Sparkle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ChatPanel } from "@/features/creative-console/chat-panel";
import { CreativeConsoleAlerts, CreativeConsoleHeader } from "@/features/creative-console/creative-console-header";
import { ImagePanel } from "@/features/creative-console/image-panel";
import { useCreativeConsole } from "@/features/creative-console/use-creative-console";
import { VideoPanel } from "@/features/creative-console/video-panel";
import { VoicePanel } from "@/features/creative-console/voice-panel";
import { PageHeader } from "@/shared/components/page-header";

/**
 * 创作台页面：只做组合与布局。
 * 密钥/模型/模式状态在 useCreativeConsole，四个面板各自独立持有会话与生成状态；
 * chat 面板以生效密钥为 key 重新挂载，避免跨密钥复用会话状态。
 */
export function CreativeConsolePage(): ReactNode {
  const { t } = useTranslation();
  const controller = useCreativeConsole();
  const [chatToolbarElement, setChatToolbarElement] = useState<HTMLDivElement | null>(null);
  const storageScope = controller.effectiveKeyId || "default";
  return (
    <div
      className="flex h-[calc(100dvh-5rem)] min-h-[36rem] flex-col gap-5 overflow-hidden"
      data-testid="creative-console-page"
    >
      <PageHeader title={t("creativeConsole.title")} description={t("creativeConsole.description")} />
      <CreativeConsolePromotion />
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CreativeConsoleHeader controller={controller} onToolbarElement={setChatToolbarElement} />
        <CreativeConsoleAlerts controller={controller} />
        <div className="min-h-0 flex-1">
          <div className="h-full" hidden={controller.mode !== "chat"} data-testid="creative-panel-chat">
            <ChatPanel
              key={storageScope}
              storageScope={storageScope}
              toolbarElement={chatToolbarElement}
              {...controller.panelProps("chat")}
            />
          </div>
          <div className="h-full" hidden={controller.mode !== "image"} data-testid="creative-panel-image">
            <ImagePanel {...controller.panelProps("image")} />
          </div>
          <div className="h-full" hidden={controller.mode !== "video"} data-testid="creative-panel-video">
            <VideoPanel {...controller.panelProps("video")} />
          </div>
          <div className="h-full" hidden={controller.mode !== "voice"} data-testid="creative-panel-voice">
            <VoicePanel {...controller.panelProps("voice")} />
          </div>
        </div>
      </section>
    </div>
  );
}

function CreativeConsolePromotion(): ReactNode {
  const { t } = useTranslation();
  return (
    <aside
      className="flex shrink-0 flex-col gap-2 rounded-lg bg-secondary/45 px-4 py-2.5 text-xs leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4"
      data-testid="creative-console-promotion"
    >
      <div className="flex min-w-0 items-center gap-3">
        <Sparkle className="size-4 shrink-0 text-foreground/70" />
        <p>{t("creativeConsole.promotion", { product: "DEEIX Chat" })}</p>
      </div>
      <a
        className="inline-flex shrink-0 items-center gap-1.5 self-end font-medium text-foreground hover:underline sm:self-auto"
        href="https://github.com/DEEIX-AI/DEEIX-Chat"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="creative-console-promotion-link"
      >
        {t("creativeConsole.promotionAction")}
        <ExternalLink className="size-3.5" />
      </a>
    </aside>
  );
}
