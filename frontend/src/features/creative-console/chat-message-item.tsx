import {
  BrainCircuit,
  CheckCircle2,
  Globe,
  Loader2,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Message, MessageContent, MessageFooter } from "@/components/ui/message";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { AssistantContent } from "@/features/creative-console/chat-markdown";
import type { ConversationMessage } from "@/features/creative-console/chat-session-model";
import type { ChatToolActivity } from "@/features/creative-console/creative-console-api";
import { IconActionButton, XSocialIcon } from "@/features/creative-console/creative-widgets";
import { cn } from "@/shared/lib/cn";

export type ChatMessageItemProps = {
  message: ConversationMessage;
  loading?: boolean;
  busy?: boolean;
  editing?: boolean;
  editDraft?: string;
  onEditDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRegenerate: () => void;
  onStop: () => void;
  onDelete: () => void;
};

export function ChatMessageItem(props: ChatMessageItemProps): ReactNode {
  const { t } = useTranslation();
  const { message, loading = false, busy = false, editing = false } = props;
  const isUser = message.role === "user";
  return (
    <Message align={isUser ? "end" : "start"}>
      <MessageContent className={cn(!isUser && "w-full max-w-full")}>
        {!isUser && message.reasoning ? <AssistantReasoning reasoning={message.reasoning} /> : null}
        {!isUser && message.tools?.length ? <ToolActivityList tools={message.tools} /> : null}
        <ChatMessageBody {...props} isUser={isUser} />
        {loading ? (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Spinner />
            {t("creativeConsole.streaming")}
          </div>
        ) : null}
        {editing ? null : (
          <ChatMessageActions
            canStop={loading && !editing}
            canRegenerate={!isUser && (!busy || loading)}
            canEdit={!loading && !busy}
            canDelete={!loading && !busy}
            onStop={props.onStop}
            onRegenerate={props.onRegenerate}
            onStartEdit={props.onStartEdit}
            onDelete={props.onDelete}
          />
        )}
      </MessageContent>
    </Message>
  );
}

function ChatMessageBody({
  message,
  editing,
  editDraft = "",
  isUser,
  onEditDraftChange,
  onEditKeyDown,
  onCancelEdit,
  onSaveEdit,
}: ChatMessageItemProps & { isUser: boolean }): ReactNode {
  if (editing) {
    return (
      <ChatMessageEditForm
        isUser={isUser}
        draft={editDraft}
        onDraftChange={onEditDraftChange}
        onKeyDown={onEditKeyDown}
        onCancel={onCancelEdit}
        onSave={onSaveEdit}
      />
    );
  }
  if (!message.content && !isUser) return null;
  if (isUser) {
    return (
      <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-sm leading-6">
        {message.content}
      </div>
    );
  }
  return <AssistantContent content={message.content} />;
}

function ChatMessageEditForm({
  isUser,
  draft,
  onDraftChange,
  onKeyDown,
  onCancel,
  onSave,
}: {
  isUser: boolean;
  draft: string;
  onDraftChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancel: () => void;
  onSave: () => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className={cn("w-full space-y-2", isUser ? "max-w-full" : "")}>
      <Textarea
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onKeyDown}
        className="min-h-24 resize-y bg-background/70 text-sm"
        autoFocus
        aria-label={t("creativeConsole.editMessage")}
      />
      {!isUser ? (
        <p className="text-[11px] leading-4 text-muted-foreground">{t("creativeConsole.localEditNote")}</p>
      ) : null}
      <div className={cn("flex items-center gap-2", isUser && "justify-end")}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("creativeConsole.cancelEdit")}
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={!draft.trim()}>
          {isUser ? t("creativeConsole.saveAndRegenerate") : t("creativeConsole.saveEdit")}
        </Button>
      </div>
    </div>
  );
}

type ChatMessageActionsProps = {
  canStop: boolean;
  canRegenerate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  onStop: () => void;
  onRegenerate: () => void;
  onStartEdit: () => void;
  onDelete: () => void;
};

type MessageAction = { label: string; onSelect: () => void; icon: ReactNode; destructive?: boolean };

type Translate = (key: string) => string;

function buildMessageActions(props: ChatMessageActionsProps, t: Translate): MessageAction[] {
  const actions: MessageAction[] = [];
  if (props.canStop) {
    actions.push({
      label: t("creativeConsole.stopGenerating"),
      onSelect: props.onStop,
      icon: <Square className="size-3.5 fill-current" />,
    });
  }
  if (props.canRegenerate) {
    actions.push({
      label: t("creativeConsole.regenerate"),
      onSelect: props.onRegenerate,
      icon: <RefreshCw className="size-3.5" />,
    });
  }
  if (props.canEdit) {
    actions.push({
      label: t("creativeConsole.editMessage"),
      onSelect: props.onStartEdit,
      icon: <Pencil className="size-3.5" />,
    });
  }
  if (props.canDelete) {
    actions.push({
      label: t("creativeConsole.deleteMessage"),
      onSelect: props.onDelete,
      icon: <Trash2 className="size-3.5" />,
      destructive: true,
    });
  }
  return actions;
}

function MessageActionButtons({ actions }: { actions: MessageAction[] }): ReactNode {
  return (
    <>
      {actions.map((action) => (
        <IconActionButton
          key={action.label}
          label={action.label}
          onSelect={action.onSelect}
          className="size-7 rounded-full"
          destructive={action.destructive}
        >
          {action.icon}
        </IconActionButton>
      ))}
    </>
  );
}

function ChatMessageActions(props: ChatMessageActionsProps): ReactNode {
  const { t } = useTranslation();
  const actions = buildMessageActions(props, t);
  if (actions.length === 0) return null;
  return (
    <MessageFooter className="gap-0.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100 [@media(hover:hover)]:group-focus-within/message:opacity-100">
      <MessageActionButtons actions={actions} />
    </MessageFooter>
  );
}

function AssistantReasoning({ reasoning }: { reasoning: string }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="w-full rounded-xl bg-secondary/45 px-3 py-2.5 text-xs text-muted-foreground">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-foreground/75">
        <BrainCircuit className="size-3.5" />
        {t("creativeConsole.thinkingProcess")}
      </div>
      <div className="whitespace-pre-wrap break-words leading-5">{reasoning}</div>
    </div>
  );
}

function ToolActivityList({ tools }: { tools: ChatToolActivity[] }): ReactNode {
  return (
    <div className="flex w-full flex-col gap-1.5">
      {tools.map((tool) => (
        <ToolActivityItem key={tool.id} tool={tool} />
      ))}
    </div>
  );
}

function ToolActivityItem({ tool }: { tool: ChatToolActivity }): ReactNode {
  const { t } = useTranslation();
  const isWebSearch = tool.name === "web_search" || tool.type === "web_search_call";
  const isXSearch = tool.name === "x_search" || tool.type === "x_search_call";
  const label = isWebSearch
    ? t("creativeConsole.toolNames.webSearch")
    : isXSearch
      ? t("creativeConsole.toolNames.xSearch")
      : tool.name;
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-xl bg-secondary/45 px-3 py-2.5 text-xs">
      <span className="mt-0.5 text-muted-foreground">
        {isWebSearch ? (
          <Globe className="size-3.5" />
        ) : isXSearch ? (
          <XSocialIcon className="size-3.5" />
        ) : (
          <Wrench className="size-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">
            {t("creativeConsole.toolCall")} · {label}
          </span>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground">
            <ToolStatusIcon status={tool.status} />
            {t(`creativeConsole.toolStatus.${tool.status}`)}
          </span>
        </div>
        {tool.detail ? (
          <div className="mt-1 line-clamp-2 break-all leading-5 text-muted-foreground" title={tool.detail}>
            {tool.detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToolStatusIcon({ status }: { status: ChatToolActivity["status"] }): ReactNode {
  if (status === "in_progress") return <Loader2 className="size-3 animate-spin" />;
  if (status === "failed") return <TriangleAlert className="size-3 text-destructive" />;
  return <CheckCircle2 className="size-3" />;
}
