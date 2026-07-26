import { Check, History, SquarePen, Trash2 } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type ChatSession, formatChatSessionTime } from "@/features/creative-console/chat-history";

type ChatToolbarPortalProps = {
  toolbarElement: HTMLDivElement | null;
  sessions: ChatSession[];
  sessionId: string;
  pending: boolean;
  onNewConversation: () => void;
  onClearConversation: () => void;
  onSwitchConversation: (targetId: string) => void;
};

export function ChatToolbarPortal({
  toolbarElement,
  sessions,
  sessionId,
  pending,
  onNewConversation,
  onClearConversation,
  onSwitchConversation,
}: ChatToolbarPortalProps) {
  const { t, i18n } = useTranslation();
  if (!toolbarElement) return null;

  return createPortal(
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={t("creativeConsole.newConversation")}
            onClick={onNewConversation}
            disabled={pending}
          >
            <SquarePen />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("creativeConsole.newConversation")}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={t("creativeConsole.clearCurrent")}
            onClick={onClearConversation}
            disabled={sessions.length === 0 || pending}
          >
            <Trash2 />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t("creativeConsole.clearCurrent")}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label={t("creativeConsole.history")}
            disabled={pending}
          >
            <History />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-80">
          <DropdownMenuLabel>{t("creativeConsole.history")}</DropdownMenuLabel>
          {sessions.length === 0 ? (
            <div className="px-2 py-5 text-center text-xs text-muted-foreground">
              {t("creativeConsole.noHistory")}
            </div>
          ) : (
            sessions.map((session) => (
              <DropdownMenuItem
                key={session.id}
                className="min-h-12 gap-2"
                onSelect={() => onSwitchConversation(session.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{session.title}</div>
                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {session.model || t("creativeConsole.model")} ·{" "}
                    {formatChatSessionTime(session.updatedAt, i18n.language)}
                  </div>
                </div>
                {session.id === sessionId ? <Check className="text-muted-foreground" /> : null}
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>,
    toolbarElement,
  );
}
