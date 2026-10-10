import { History, SquarePen, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check } from "lucide-react";
import { formatChatSessionTime, type ChatSession } from "@/features/creative-console/chat-session-model";
import { IconActionButton } from "@/features/creative-console/creative-widgets";
import type { CreativeChatController } from "@/features/creative-console/use-creative-chat";

/** 会话级操作挂载到密钥选择器右侧的插槽（保持原布局，不新增可见容器）。 */
export function ChatToolbar({
  controller,
  toolbarElement,
}: {
  controller: CreativeChatController;
  toolbarElement: HTMLDivElement | null;
}): ReactNode {
  const { t } = useTranslation();
  if (!toolbarElement) return null;
  return createPortal(
    <>
      <IconActionButton
        label={t("creativeConsole.newConversation")}
        onSelect={controller.startNewConversation}
        className="rounded-full"
        disabled={controller.isStreaming}
        testId="chat-new-conversation"
      >
        <SquarePen />
      </IconActionButton>
      <IconActionButton
        label={t("creativeConsole.clearCurrent")}
        onSelect={controller.clearConversation}
        className="rounded-full"
        disabled={controller.messages.length === 0 || controller.isStreaming}
        testId="chat-clear-conversation"
      >
        <Trash2 />
      </IconActionButton>
      <ChatHistoryMenu controller={controller} />
    </>,
    toolbarElement,
  );
}

function ChatHistoryMenu({ controller }: { controller: CreativeChatController }): ReactNode {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="rounded-full"
          aria-label={t("creativeConsole.history")}
          disabled={controller.isStreaming}
          data-testid="chat-history-trigger"
        >
          <History />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80" data-testid="chat-history-menu">
        <DropdownMenuLabel>{t("creativeConsole.history")}</DropdownMenuLabel>
        {controller.sessions.length === 0 ? (
          <div className="px-2 py-5 text-center text-xs text-muted-foreground" data-testid="chat-history-empty">
            {t("creativeConsole.noHistory")}
          </div>
        ) : (
          controller.sessions.map((session) => (
            <ChatHistoryItem
              key={session.id}
              session={session}
              active={session.id === controller.sessionId}
              onSelect={() => controller.switchConversation(session.id)}
            />
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ChatHistoryItem({
  session,
  active,
  onSelect,
}: {
  session: ChatSession;
  active: boolean;
  onSelect: () => void;
}): ReactNode {
  const { t, i18n } = useTranslation();
  return (
    <DropdownMenuItem className="min-h-12 gap-2" onSelect={onSelect} data-testid={`chat-history-session-${session.id}`}>
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">{session.title}</div>
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
          {session.model || t("creativeConsole.model")} · {formatChatSessionTime(session.updatedAt, i18n.language)}
        </div>
      </div>
      {active ? <Check className="text-muted-foreground" /> : null}
    </DropdownMenuItem>
  );
}
