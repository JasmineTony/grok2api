import type { ReactNode } from "react";

import { ChatComposer } from "@/features/creative-console/chat-composer";
import { ChatMessageList } from "@/features/creative-console/chat-message-list";
import { ChatToolbar } from "@/features/creative-console/chat-toolbar";
import { ChatTruncateDialog } from "@/features/creative-console/chat-truncate-dialog";
import type { CreativePanelProps } from "@/features/creative-console/creative-panel-contract";
import { useCreativeChat } from "@/features/creative-console/use-creative-chat";

export function ChatPanel({
  apiKey,
  model,
  modelOptions,
  onModelChange,
  storageScope,
  toolbarElement,
}: CreativePanelProps & { storageScope: string; toolbarElement: HTMLDivElement | null }): ReactNode {
  const controller = useCreativeChat({ apiKey, model, modelOptions, onModelChange, storageScope });
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ChatToolbar controller={controller} toolbarElement={toolbarElement} />
      <ChatMessageList controller={controller} />
      <ChatComposer controller={controller} />
      <ChatTruncateDialog controller={controller} />
    </div>
  );
}
