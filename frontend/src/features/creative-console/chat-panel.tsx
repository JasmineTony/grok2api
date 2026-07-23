import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Check, Globe, History, Loader2, Sparkle, SquarePen, Trash2 } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
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
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  type ChatSession,
  type ConversationMessage,
  createBlankChatSession,
  createChatSessionTitle,
  createCreativeCacheKey,
  createCreativeMessageId,
  currentTimestamp,
  formatChatSessionTime,
  loadChatSessions,
  persistChatSessions,
  upsertChatSession,
} from "@/features/creative-console/chat-history";
import {
  type ChatMessage,
  type ChatStreamSnapshot,
  createChatResponse,
  type ReasoningEffort,
} from "@/features/creative-console/creative-console-api";
import {
  ChatMessageItem,
  CompactIconSelect,
  CompactModelSelect,
  WelcomeState,
  XSocialIcon,
} from "@/features/creative-console/creative-console-components";
import type { CreativePanelProps } from "@/features/creative-console/creative-console-types";
import { useApiClient } from "@/shared/api/use-api-client";
import { cn } from "@/shared/lib/cn";

type ChatRequest = {
  messages: ChatMessage[];
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  assistantMessageId: string;
  apiKey: string;
  model: string;
};

const composerClassName =
  "overflow-hidden rounded-2xl bg-secondary/45 ring-1 ring-transparent transition-colors focus-within:bg-secondary/60 focus-within:ring-ring";

export function ChatPanel({
  apiKey,
  model,
  modelOptions,
  onModelChange,
  storageScope,
  toolbarElement,
}: CreativePanelProps & { storageScope: string; toolbarElement: HTMLDivElement | null }) {
  const { t, i18n } = useTranslation();
  const apiClient = useApiClient();
  const [initialHistory] = useState(() => {
    const sessions = loadChatSessions(storageScope);
    return { sessions, active: sessions[0] ?? createBlankChatSession(model) };
  });
  const [sessions, setSessions] = useState<ChatSession[]>(initialHistory.sessions);
  const [sessionId, setSessionId] = useState(initialHistory.active.id);
  const [sessionCreatedAt, setSessionCreatedAt] = useState(initialHistory.active.createdAt);
  const [webSearch, setWebSearch] = useState(initialHistory.active.webSearch);
  const [xSearch, setXSearch] = useState(initialHistory.active.xSearch);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(
    initialHistory.active.reasoningEffort,
  );
  const [promptCacheKey, setPromptCacheKey] = useState(initialHistory.active.promptCacheKey);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>(initialHistory.active.messages);
  const streamSnapshotRef = useRef<ChatStreamSnapshot>({ text: "", reasoning: "", tools: [] });
  const streamFrameRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const restoredInitialModelRef = useRef(false);

  useEffect(() => {
    if (restoredInitialModelRef.current || modelOptions.length === 0) return;
    restoredInitialModelRef.current = true;
    if (
      initialHistory.active.model &&
      modelOptions.some((option) => option.publicId === initialHistory.active.model)
    ) {
      onModelChange(initialHistory.active.model);
    }
  }, [initialHistory.active.model, modelOptions, onModelChange]);

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = window.setTimeout(() => {
      const session: ChatSession = {
        id: sessionId,
        title: createChatSessionTitle(messages),
        createdAt: sessionCreatedAt,
        updatedAt: currentTimestamp(),
        model,
        promptCacheKey,
        reasoningEffort,
        webSearch,
        xSearch,
        messages,
      };
      setSessions((current) => {
        const next = upsertChatSession(current, session);
        return persistChatSessions(storageScope, next);
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    messages,
    model,
    promptCacheKey,
    reasoningEffort,
    sessionCreatedAt,
    sessionId,
    storageScope,
    webSearch,
    xSearch,
  ]);

  useEffect(
    () => () => {
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      requestControllerRef.current?.abort();
    },
    [],
  );

  function renderStreamSnapshot(messageId: string): void {
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = requestAnimationFrame(() => {
      streamFrameRef.current = null;
      const snapshot = streamSnapshotRef.current;
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                content: snapshot.text,
                reasoning: snapshot.reasoning,
                tools: snapshot.tools,
              }
            : message,
        ),
      );
    });
  }

  const mutation = useMutation({
    mutationFn: (request: ChatRequest) => {
      streamSnapshotRef.current = { text: "", reasoning: "", tools: [] };
      const controller = new AbortController();
      requestControllerRef.current = controller;
      return createChatResponse(apiClient, {
        apiKey: request.apiKey,
        model: request.model,
        messages: request.messages,
        ...(request.promptCacheKey ? { promptCacheKey: request.promptCacheKey } : {}),
        reasoningEffort: request.reasoningEffort,
        webSearch: request.webSearch,
        xSearch: request.xSearch,
        signal: controller.signal,
        onUpdate: (snapshot) => {
          streamSnapshotRef.current = snapshot;
          renderStreamSnapshot(request.assistantMessageId);
        },
      });
    },
    onSuccess: (result, request) => {
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      setMessages((current) =>
        current.map((message) =>
          message.id === request.assistantMessageId
            ? { ...message, content: result.text, reasoning: result.reasoning, tools: result.tools }
            : message,
        ),
      );
      requestControllerRef.current = null;
    },
    onError: (_error, request) => {
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      const snapshot = streamSnapshotRef.current;
      setMessages((current) =>
        current.flatMap((message) => {
          if (message.id !== request.assistantMessageId) return [message];
          if (!snapshot.text.trim() && !snapshot.reasoning.trim() && snapshot.tools.length === 0)
            return [];
          return [
            {
              ...message,
              content: snapshot.text,
              reasoning: snapshot.reasoning,
              tools: snapshot.tools,
            },
          ];
        }),
      );
      requestControllerRef.current = null;
    },
  });

  function submit(event?: FormEvent): void {
    event?.preventDefault();
    const userText = prompt.trim();
    if (!apiKey || !model || !userText || mutation.isPending) return;
    const userMessage: ConversationMessage = {
      id: createCreativeMessageId(),
      role: "user",
      content: userText,
    };
    const assistantMessage: ConversationMessage = {
      id: createCreativeMessageId(),
      role: "assistant",
      content: "",
      reasoning: "",
      tools: [],
    };
    const requestMessages: ChatMessage[] = [
      ...messages
        .filter((message) => message.content.trim())
        .map(({ role, content }) => ({ role, content })),
      { role: "user", content: userText },
    ];
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setPrompt("");
    mutation.reset();
    mutation.mutate({
      messages: requestMessages,
      promptCacheKey,
      reasoningEffort,
      webSearch,
      xSearch,
      assistantMessageId: assistantMessage.id,
      apiKey,
      model,
    });
  }

  function clearConversation(): void {
    setSessions((current) => {
      const next = current.filter((session) => session.id !== sessionId);
      return persistChatSessions(storageScope, next);
    });
    const blank = createBlankChatSession(model);
    setSessionId(blank.id);
    setSessionCreatedAt(blank.createdAt);
    setMessages([]);
    setPromptCacheKey(blank.promptCacheKey);
    setPrompt("");
    mutation.reset();
  }

  function startNewConversation(): void {
    if (mutation.isPending) return;
    setSessions((current) => {
      const next =
        messages.length > 0
          ? upsertChatSession(current, {
              id: sessionId,
              title: createChatSessionTitle(messages),
              createdAt: sessionCreatedAt,
              updatedAt: currentTimestamp(),
              model,
              promptCacheKey,
              reasoningEffort,
              webSearch,
              xSearch,
              messages,
            })
          : current;
      return persistChatSessions(storageScope, next);
    });
    const blank = createBlankChatSession(model);
    setSessionId(blank.id);
    setSessionCreatedAt(blank.createdAt);
    setMessages([]);
    setPromptCacheKey(blank.promptCacheKey);
    setReasoningEffort(blank.reasoningEffort);
    setWebSearch(blank.webSearch);
    setXSearch(blank.xSearch);
    setPrompt("");
    mutation.reset();
  }

  function switchConversation(targetId: string): void {
    if (mutation.isPending || targetId === sessionId) return;
    let availableSessions = sessions;
    if (messages.length > 0) {
      availableSessions = upsertChatSession(sessions, {
        id: sessionId,
        title: createChatSessionTitle(messages),
        createdAt: sessionCreatedAt,
        updatedAt: currentTimestamp(),
        model,
        promptCacheKey,
        reasoningEffort,
        webSearch,
        xSearch,
        messages,
      });
    }
    const target = availableSessions.find((session) => session.id === targetId);
    if (!target) return;
    availableSessions = persistChatSessions(storageScope, availableSessions);
    setSessions(availableSessions);
    setSessionId(target.id);
    setSessionCreatedAt(target.createdAt);
    setMessages(target.messages);
    setPromptCacheKey(target.promptCacheKey || createCreativeCacheKey());
    setReasoningEffort(target.reasoningEffort);
    setWebSearch(target.webSearch);
    setXSearch(target.xSearch);
    setPrompt("");
    mutation.reset();
    if (target.model && modelOptions.some((option) => option.publicId === target.model))
      onModelChange(target.model);
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {toolbarElement
        ? createPortal(
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="rounded-full"
                    aria-label={t("creativeConsole.newConversation")}
                    onClick={startNewConversation}
                    disabled={mutation.isPending}
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
                    onClick={clearConversation}
                    disabled={messages.length === 0 || mutation.isPending}
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
                    disabled={mutation.isPending}
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
                        onSelect={() => switchConversation(session.id)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">{session.title}</div>
                          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                            {session.model || t("creativeConsole.model")} ·{" "}
                            {formatChatSessionTime(session.updatedAt, i18n.language)}
                          </div>
                        </div>
                        {session.id === sessionId ? (
                          <Check className="text-muted-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    ))
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>,
            toolbarElement,
          )
        : null}
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label={t("creativeConsole.messageList")}>
            <MessageScrollerContent
              className={cn(
                "w-full px-3 py-6 sm:px-6",
                messages.length === 0 && !mutation.isPending && "justify-center",
              )}
            >
              {messages.length === 0 && !mutation.isPending ? (
                <WelcomeState title={t("creativeConsole.welcome")} />
              ) : null}
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <ChatMessageItem
                    message={message}
                    loading={
                      mutation.isPending && mutation.variables?.assistantMessageId === message.id
                    }
                  />
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton aria-label={t("creativeConsole.scrollToLatest")} />
        </MessageScroller>
      </MessageScrollerProvider>

      <form className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3" onSubmit={submit}>
        <div className={composerClassName}>
          <Textarea
            id="chat-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            placeholder={t("creativeConsole.chatPlaceholder")}
            className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
          />
          <div className="flex items-center justify-between gap-3 px-3 pb-3">
            <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
              <CompactModelSelect value={model} models={modelOptions} onChange={onModelChange} />
              <CompactIconSelect
                value={webSearch ? "on" : "off"}
                options={[
                  { value: "off", label: t("creativeConsole.webSearchOff") },
                  { value: "on", label: t("creativeConsole.webSearchOn") },
                ]}
                onChange={(value) => setWebSearch(value === "on")}
                ariaLabel={t("creativeConsole.webSearch")}
                icon={<Globe />}
                active={webSearch}
              />
              <CompactIconSelect
                value={xSearch ? "on" : "off"}
                options={[
                  { value: "off", label: t("creativeConsole.xSearchOff") },
                  { value: "on", label: t("creativeConsole.xSearchOn") },
                ]}
                onChange={(value) => setXSearch(value === "on")}
                ariaLabel={t("creativeConsole.xSearch")}
                icon={<XSocialIcon />}
                active={xSearch}
              />
              <CompactIconSelect
                value={reasoningEffort}
                options={(
                  ["auto", "none", "low", "medium", "high", "xhigh"] as ReasoningEffort[]
                ).map((effort) => ({
                  value: effort,
                  label: t(`creativeConsole.reasoning.${effort}`),
                }))}
                onChange={(value) => setReasoningEffort(value as ReasoningEffort)}
                ariaLabel={t("creativeConsole.reasoningEffort")}
                icon={<Sparkle />}
                active={reasoningEffort !== "auto" && reasoningEffort !== "none"}
              />
            </div>
            <Button
              type="submit"
              size="icon"
              aria-label={t("creativeConsole.send")}
              disabled={!apiKey || !model || !prompt.trim() || mutation.isPending}
            >
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>
        {mutation.isError ? (
          <div className="mt-1 px-2 text-[11px] text-destructive">{mutation.error.message}</div>
        ) : null}
      </form>
    </div>
  );
}
