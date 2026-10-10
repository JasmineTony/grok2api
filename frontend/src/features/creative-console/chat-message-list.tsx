import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { ChatMessageItem } from "@/features/creative-console/chat-message-item";
import { WelcomeState } from "@/features/creative-console/creative-widgets";
import type { CreativeChatController } from "@/features/creative-console/use-creative-chat";
import { cn } from "@/shared/lib/cn";

/** 消息列表：只负责滚动容器与把控制器状态映射到消息项，不承载分支裁剪规则。 */
export function ChatMessageList({ controller }: { controller: CreativeChatController }): ReactNode {
  const { t } = useTranslation();
  const empty = controller.messages.length === 0 && !controller.isStreaming;
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport aria-label={t("creativeConsole.messageList")} data-testid="chat-message-viewport">
          <MessageScrollerContent
            className={cn("w-full px-3 py-6 sm:px-6", empty && "justify-center")}
            data-testid="chat-message-list"
          >
            {empty ? <WelcomeState title={t("creativeConsole.welcome")} testId="chat-welcome-state" /> : null}
            {controller.messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === "user"}
                data-testid={`chat-message-row-${message.id}`}
              >
                <ChatMessageItem
                  message={message}
                  loading={controller.isStreaming && controller.streamingMessageId === message.id}
                  busy={controller.isStreaming}
                  editing={controller.editingMessageId === message.id}
                  editDraft={controller.editingMessageId === message.id ? controller.editDraft : ""}
                  onEditDraftChange={controller.setEditDraft}
                  onStartEdit={() => controller.startEditMessage(message.id)}
                  onCancelEdit={controller.cancelEditMessage}
                  onSaveEdit={() => controller.saveEditMessage(message.id)}
                  onEditKeyDown={(event) => controller.handleEditKeyDown(event, message.id)}
                  onRegenerate={() => controller.regenerateAssistant(message.id)}
                  onStop={controller.stopGenerating}
                  onDelete={() => controller.deleteMessage(message.id)}
                />
              </MessageScrollerItem>
            ))}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton aria-label={t("creativeConsole.scrollToLatest")} data-testid="chat-scroll-to-latest" />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}
