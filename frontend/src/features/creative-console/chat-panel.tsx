import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Globe, Sparkle, Square } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import { Textarea } from "@/components/ui/textarea";
import {
  type ChatSession,
  type ConversationMessage,
  createBlankChatSession,
  createChatSessionTitle,
  createCreativeCacheKey,
  createCreativeMessageId,
  currentTimestamp,
  loadChatSessions,
  persistChatSessions,
  upsertChatSession,
} from "@/features/creative-console/chat-history";
import { ChatToolbarPortal } from "@/features/creative-console/chat-toolbar-portal";
import {
  ChatTruncateDialog,
  type PendingTruncateAction,
} from "@/features/creative-console/chat-truncate-dialog";
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
  requestSeq: number;
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
  const { t } = useTranslation();
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
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingTruncate, setPendingTruncate] = useState<PendingTruncateAction | null>(null);
  const streamSnapshotRef = useRef<ChatStreamSnapshot>({ text: "", reasoning: "", tools: [] });
  const streamFrameRef = useRef<number | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  // requestSeq starts at 1 and increases; 0 means no active request owns the stream callbacks.
  const requestSeqRef = useRef(0);
  const activeRequestSeqRef = useRef(0);
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
      cancelActiveRequest();
    },
    [],
  );

  function isActiveRequest(requestSeq: number): boolean {
    return activeRequestSeqRef.current === requestSeq;
  }

  function cancelActiveRequest(): void {
    if (streamFrameRef.current !== null) {
      cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
    }
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    // 0 = no active request owns stream callbacks.
    activeRequestSeqRef.current = 0;
    streamSnapshotRef.current = { text: "", reasoning: "", tools: [] };
  }

  function invalidatePromptCache(): string {
    const next = createCreativeCacheKey();
    setPromptCacheKey(next);
    return next;
  }

  function toRequestMessages(items: ConversationMessage[]): ChatMessage[] {
    return items
      .filter((message) => message.role === "user" || message.role === "assistant")
      .filter((message) => message.content.trim())
      .map(({ role, content }) => ({ role, content }));
  }

  function clearEditState(): void {
    setEditingMessageId(null);
    setEditDraft("");
  }

  function clearEditStateIfAtOrAfter(index: number): void {
    if (!editingMessageId) return;
    const editIndex = messages.findIndex((message) => message.id === editingMessageId);
    if (editIndex < 0 || editIndex >= index) clearEditState();
  }

  function renderStreamSnapshot(messageId: string, requestSeq: number): void {
    if (streamFrameRef.current !== null) return;
    streamFrameRef.current = requestAnimationFrame(() => {
      streamFrameRef.current = null;
      if (!isActiveRequest(requestSeq)) return;
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
      activeRequestSeqRef.current = request.requestSeq;
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
          if (!isActiveRequest(request.requestSeq)) return;
          streamSnapshotRef.current = snapshot;
          renderStreamSnapshot(request.assistantMessageId, request.requestSeq);
        },
      });
    },
    onSuccess: (result, request) => {
      if (!isActiveRequest(request.requestSeq)) return;
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
      activeRequestSeqRef.current = 0;
    },
    onError: (error, request) => {
      if (!isActiveRequest(request.requestSeq)) return;
      if (streamFrameRef.current !== null) cancelAnimationFrame(streamFrameRef.current);
      streamFrameRef.current = null;
      const snapshot = streamSnapshotRef.current;
      const aborted = isAbortError(error);
      setMessages((current) =>
        current.flatMap((message) => {
          if (message.id !== request.assistantMessageId) return [message];
          // Drop empty/aborted assistant placeholders; keep partial text from real failures.
          if (
            aborted ||
            (!snapshot.text.trim() && !snapshot.reasoning.trim() && snapshot.tools.length === 0)
          )
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
      activeRequestSeqRef.current = 0;
    },
  });

  function beginAssistantRequest(params: {
    history: ConversationMessage[];
    assistantMessage: ConversationMessage;
    cacheKey: string;
    cancelPrevious?: boolean;
  }): void {
    if (!apiKey || !model) return;
    if (params.cancelPrevious) cancelActiveRequest();
    const requestSeq = ++requestSeqRef.current;
    const requestMessages = toRequestMessages(params.history);
    mutation.reset();
    mutation.mutate({
      messages: requestMessages,
      promptCacheKey: params.cacheKey,
      reasoningEffort,
      webSearch,
      xSearch,
      assistantMessageId: params.assistantMessage.id,
      apiKey,
      model,
      requestSeq,
    });
  }

  function stopGenerating(): void {
    if (!mutation.isPending) return;
    const assistantMessageId = mutation.variables?.assistantMessageId;
    const snapshot = streamSnapshotRef.current;
    cancelActiveRequest();
    if (assistantMessageId) {
      setMessages((current) =>
        current.flatMap((message) => {
          if (message.id !== assistantMessageId) return [message];
          const updated = hasChatStreamContent(snapshot)
            ? {
                ...message,
                content: snapshot.text,
                reasoning: snapshot.reasoning,
                tools: snapshot.tools,
              }
            : message;
          if (!updated.content.trim() && !updated.reasoning?.trim() && !updated.tools?.length)
            return [];
          return [updated];
        }),
      );
    }
    mutation.reset();
  }

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
    const history = [...messages, userMessage];
    setMessages([...history, assistantMessage]);
    setPrompt("");
    clearEditState();
    beginAssistantRequest({ history, assistantMessage, cacheKey: promptCacheKey });
  }

  function applyRegenerateAssistant(messageId: string): void {
    if (!apiKey || !model) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0 || messages[index]?.role !== "assistant") return;
    const history = messages.slice(0, index);
    if (!history.some((message) => message.role === "user" && message.content.trim())) return;
    // Allow interrupt-regenerate: cancel the in-flight stream first, then start a new one.
    const cacheKey = invalidatePromptCache();
    const assistantMessage: ConversationMessage = {
      id: messageId,
      role: "assistant",
      content: "",
      reasoning: "",
      tools: [],
    };
    setMessages([...history, assistantMessage]);
    clearEditState();
    beginAssistantRequest({ history, assistantMessage, cacheKey, cancelPrevious: true });
  }

  function regenerateAssistant(messageId: string): void {
    if (!apiKey || !model) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0 || messages[index]?.role !== "assistant") return;
    const trailingCount = messages.length - index - 1;
    if (trailingCount > 0) {
      setPendingTruncate({ kind: "regenerate", messageId, trailingCount });
      return;
    }
    applyRegenerateAssistant(messageId);
  }

  function startEditMessage(messageId: string): void {
    if (mutation.isPending) return;
    const target = messages.find((message) => message.id === messageId);
    if (!target) return;
    setEditingMessageId(messageId);
    setEditDraft(target.content);
  }

  function cancelEditMessage(): void {
    clearEditState();
  }

  function applyUserEditAndRegenerate(messageId: string, nextContent: string): void {
    if (!apiKey || !model) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const target = messages[index];
    if (!target || target.role !== "user") return;
    const cacheKey = invalidatePromptCache();
    const historyPrefix = messages.slice(0, index);
    const userMessage: ConversationMessage = { ...target, content: nextContent };
    const assistantMessage: ConversationMessage = {
      id: createCreativeMessageId(),
      role: "assistant",
      content: "",
      reasoning: "",
      tools: [],
    };
    const history = [...historyPrefix, userMessage];
    setMessages([...history, assistantMessage]);
    clearEditState();
    beginAssistantRequest({ history, assistantMessage, cacheKey, cancelPrevious: true });
  }

  function applyDeleteMessage(messageId: string): void {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    cancelActiveRequest();
    invalidatePromptCache();
    // Drop the selected message and every turn after it so the transcript stays a single continuous branch.
    const nextMessages = messages.slice(0, index);
    setMessages(nextMessages);
    if (nextMessages.length === 0) {
      setSessions((current) => {
        const next = current.filter((session) => session.id !== sessionId);
        return persistChatSessions(storageScope, next);
      });
    }
    clearEditStateIfAtOrAfter(index);
    mutation.reset();
  }

  function saveEditMessage(messageId: string): void {
    if (mutation.isPending) return;
    const nextContent = editDraft.trim();
    if (!nextContent) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const target = messages[index];
    if (!target) return;

    if (target.role === "assistant") {
      // Local-only edit for assistant replies; keep subsequent turns intact.
      // Clear reasoning/tools so they cannot contradict the edited body.
      if (index < messages.length - 1) invalidatePromptCache();
      setMessages((current) =>
        current.map((message) => {
          if (message.id !== messageId) return message;
          const next = { ...message, content: nextContent };
          delete next.reasoning;
          delete next.tools;
          return next;
        }),
      );
      clearEditState();
      return;
    }

    // Editing a user message truncates the branch and re-requests a new reply.
    if (!apiKey || !model) return;
    const trailingCount = messages.length - index - 1;
    if (trailingCount > 0) {
      setPendingTruncate({ kind: "edit-user", messageId, content: nextContent, trailingCount });
      return;
    }
    applyUserEditAndRegenerate(messageId, nextContent);
  }

  function deleteMessage(messageId: string): void {
    if (mutation.isPending) return;
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const trailingCount = messages.length - index - 1;
    if (trailingCount > 0) {
      setPendingTruncate({ kind: "delete", messageId, trailingCount });
      return;
    }
    applyDeleteMessage(messageId);
  }

  function confirmPendingTruncate(): void {
    if (!pendingTruncate) return;
    const action = pendingTruncate;
    setPendingTruncate(null);
    if (action.kind === "delete") {
      applyDeleteMessage(action.messageId);
      return;
    }
    if (action.kind === "regenerate") {
      applyRegenerateAssistant(action.messageId);
      return;
    }
    applyUserEditAndRegenerate(action.messageId, action.content);
  }

  function clearConversation(): void {
    cancelActiveRequest();
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
    clearEditState();
    setPendingTruncate(null);
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
    clearEditState();
    setPendingTruncate(null);
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
    clearEditState();
    setPendingTruncate(null);
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

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, messageId: string): void {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditMessage();
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveEditMessage(messageId);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <ChatToolbarPortal
        toolbarElement={toolbarElement}
        sessions={sessions}
        sessionId={sessionId}
        pending={mutation.isPending}
        onNewConversation={startNewConversation}
        onClearConversation={clearConversation}
        onSwitchConversation={switchConversation}
      />
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
                    busy={mutation.isPending}
                    editing={editingMessageId === message.id}
                    editDraft={editingMessageId === message.id ? editDraft : ""}
                    onEditDraftChange={setEditDraft}
                    onStartEdit={() => startEditMessage(message.id)}
                    onCancelEdit={cancelEditMessage}
                    onSaveEdit={() => saveEditMessage(message.id)}
                    onEditKeyDown={(event) => handleEditKeyDown(event, message.id)}
                    onRegenerate={() => regenerateAssistant(message.id)}
                    onStop={stopGenerating}
                    onDelete={() => deleteMessage(message.id)}
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
            {mutation.isPending ? (
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label={t("creativeConsole.stopGenerating")}
                onClick={stopGenerating}
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                aria-label={t("creativeConsole.send")}
                disabled={!apiKey || !model || !prompt.trim()}
              >
                <ArrowUp />
              </Button>
            )}
          </div>
        </div>
        {mutation.isError ? (
          <div className="mt-1 px-2 text-[11px] text-destructive">{mutation.error.message}</div>
        ) : null}
      </form>

      <ChatTruncateDialog
        pending={pendingTruncate}
        onClose={() => setPendingTruncate(null)}
        onConfirm={confirmPendingTruncate}
      />
    </div>
  );
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

function hasChatStreamContent(snapshot: ChatStreamSnapshot): boolean {
  return Boolean(snapshot.text.trim() || snapshot.reasoning.trim() || snapshot.tools.length);
}
