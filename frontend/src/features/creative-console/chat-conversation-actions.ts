import type { FormEvent, KeyboardEvent } from "react";

import type { ModelRouteDTO } from "@/entities/model/types";
import {
  applyAssistantSnapshot,
  applyStoppedAssistant,
  buildChatSession,
  createBlankChatSession,
  createCreativeCacheKey,
  createCreativeMessageId,
  keepOrDropAssistant,
  toRequestMessages,
  upsertChatSession,
  type ConversationMessage,
  type CreativeChatRequest,
} from "@/features/creative-console/chat-session-model";
import { persistChatSessions } from "@/features/creative-console/chat-session-store";
import type {
  CreativeChatStreamController,
  CreativeChatStreamHandlers,
} from "@/features/creative-console/use-creative-chat-stream";
import type {
  ChatHistoryFields,
  ChatHistorySetters,
  ChatSettings,
  ChatTranscriptFields,
  ChatTranscriptSetters,
} from "@/features/creative-console/use-creative-chat-store";

export type ChatActionFields = ChatHistoryFields &
  ChatTranscriptFields &
  ChatSettings & {
    model: string;
    modelOptions: ModelRouteDTO[];
    onModelChange: (model: string) => void;
  };

export type ChatActionSetters = ChatHistorySetters & ChatTranscriptSetters;

export type ChatActionContext = {
  apiKey: string;
  model: string;
  storageScope: string;
  fields: ChatActionFields;
  setters: ChatActionSetters;
  stream: CreativeChatStreamController;
};

type ChatRequestParams = {
  history: ConversationMessage[];
  assistantMessage: ConversationMessage;
  cacheKey: string;
  cancelPrevious?: boolean;
};

export function createAssistantPlaceholder(id: string): ConversationMessage {
  return { id, role: "assistant", content: "", reasoning: "", tools: [] };
}

/** 流式回调只管消息与流状态，不读组件闭包状态，避免过期快照覆盖新消息。 */
export function createChatStreamHandlers(setters: ChatTranscriptSetters): CreativeChatStreamHandlers {
  return {
    onSnapshot: (messageId, snapshot) => {
      setters.setMessages((current) => applyAssistantSnapshot(current, messageId, snapshot));
    },
    onSuccess: (messageId, snapshot) => {
      setters.setMessages((current) => applyAssistantSnapshot(current, messageId, snapshot));
      setters.setStreamingMessageId("");
    },
    onFailure: (messageId, snapshot, aborted) => {
      setters.setMessages((current) => keepOrDropAssistant(current, messageId, snapshot, aborted));
      setters.setStreamingMessageId("");
    },
    onStop: (messageId, snapshot) => {
      setters.setMessages((current) => applyStoppedAssistant(current, messageId, snapshot));
      setters.setStreamingMessageId("");
    },
  };
}

export function clearChatEditState(context: ChatActionContext): void {
  context.setters.setEditingMessageId(null);
  context.setters.setEditDraft("");
}

function clearChatEditStateAtOrAfter(context: ChatActionContext, index: number): void {
  const { editingMessageId, messages } = context.fields;
  if (!editingMessageId) return;
  const editIndex = messages.findIndex((message) => message.id === editingMessageId);
  if (editIndex < 0 || editIndex >= index) clearChatEditState(context);
}

export function invalidatePromptCache(context: ChatActionContext): string {
  const next = createCreativeCacheKey();
  context.setters.setPromptCacheKey(next);
  return next;
}

function beginChatRequest(context: ChatActionContext, params: ChatRequestParams): void {
  if (params.cancelPrevious) context.stream.cancel();
  context.setters.setStreamingMessageId(params.assistantMessage.id);
  const request: CreativeChatRequest = {
    messages: toRequestMessages(params.history),
    promptCacheKey: params.cacheKey,
    reasoningEffort: context.fields.reasoningEffort,
    webSearch: context.fields.webSearch,
    xSearch: context.fields.xSearch,
    assistantMessageId: params.assistantMessage.id,
    apiKey: context.apiKey,
    model: context.model,
  };
  context.stream.start(request);
}

export function submitChatMessage(context: ChatActionContext, event?: FormEvent): void {
  event?.preventDefault();
  const userText = context.fields.prompt.trim();
  if (!context.apiKey || !context.model || !userText || context.stream.isPending) return;
  const userMessage: ConversationMessage = { id: createCreativeMessageId(), role: "user", content: userText };
  const assistantMessage = createAssistantPlaceholder(createCreativeMessageId());
  const history = [...context.fields.messages, userMessage];
  context.setters.setMessages([...history, assistantMessage]);
  context.setters.setPrompt("");
  clearChatEditState(context);
  beginChatRequest(context, { history, assistantMessage, cacheKey: context.fields.promptCacheKey });
}

export function stopChatGeneration(context: ChatActionContext): void {
  context.stream.stop();
}

function applyRegenerateChatAnswer(context: ChatActionContext, messageId: string): void {
  if (!context.apiKey || !context.model) return;
  const index = context.fields.messages.findIndex((message) => message.id === messageId);
  const target = context.fields.messages[index];
  if (index < 0 || target.role !== "assistant") return;
  const history = context.fields.messages.slice(0, index);
  if (!history.some((message) => message.role === "user" && message.content.trim())) return;
  // 允许打断当前流：先取消在途请求，再以同一消息 ID 重新发起。
  const cacheKey = invalidatePromptCache(context);
  const assistantMessage = createAssistantPlaceholder(messageId);
  context.setters.setMessages([...history, assistantMessage]);
  clearChatEditState(context);
  beginChatRequest(context, { history, assistantMessage, cacheKey, cancelPrevious: true });
}

export function regenerateChatAnswer(context: ChatActionContext, messageId: string): void {
  if (!context.apiKey || !context.model) return;
  const index = context.fields.messages.findIndex((message) => message.id === messageId);
  const target = context.fields.messages[index];
  if (index < 0 || target.role !== "assistant") return;
  const trailingCount = context.fields.messages.length - index - 1;
  if (trailingCount > 0) {
    context.setters.setPendingTruncate({ kind: "regenerate", messageId, trailingCount });
    return;
  }
  applyRegenerateChatAnswer(context, messageId);
}

export function startChatMessageEdit(context: ChatActionContext, messageId: string): void {
  if (context.stream.isPending) return;
  const target = context.fields.messages.find((message) => message.id === messageId);
  if (!target) return;
  context.setters.setEditingMessageId(messageId);
  context.setters.setEditDraft(target.content);
}

export function cancelChatMessageEdit(context: ChatActionContext): void {
  clearChatEditState(context);
}

function applyUserEditAndRegenerate(context: ChatActionContext, messageId: string, nextContent: string): void {
  if (!context.apiKey || !context.model) return;
  const index = context.fields.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  const target = context.fields.messages[index];
  if (target.role !== "user") return;
  const cacheKey = invalidatePromptCache(context);
  const userMessage: ConversationMessage = { ...target, content: nextContent };
  const assistantMessage = createAssistantPlaceholder(createCreativeMessageId());
  const history = [...context.fields.messages.slice(0, index), userMessage];
  context.setters.setMessages([...history, assistantMessage]);
  clearChatEditState(context);
  beginChatRequest(context, { history, assistantMessage, cacheKey, cancelPrevious: true });
}

export function saveChatEditMessage(context: ChatActionContext, messageId: string): void {
  if (context.stream.isPending) return;
  const nextContent = context.fields.editDraft.trim();
  if (!nextContent) return;
  const index = context.fields.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  const target = context.fields.messages[index];
  if (target.role === "assistant") {
    // 助手回复只做本地编辑，保留后续轮次；清空 reasoning/tools 以避免与正文矛盾。
    if (index < context.fields.messages.length - 1) invalidatePromptCache(context);
    context.setters.setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, content: nextContent, reasoning: undefined, tools: undefined }
          : message,
      ),
    );
    clearChatEditState(context);
    return;
  }
  if (!context.apiKey || !context.model) return;
  const trailingCount = context.fields.messages.length - index - 1;
  if (trailingCount > 0) {
    context.setters.setPendingTruncate({ kind: "edit-user", messageId, content: nextContent, trailingCount });
    return;
  }
  applyUserEditAndRegenerate(context, messageId, nextContent);
}

function applyDeleteChatMessage(context: ChatActionContext, messageId: string): void {
  const index = context.fields.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  context.stream.cancel();
  invalidatePromptCache(context);
  // 删除该消息及其之后的所有轮次，保持会话是单条连续分支。
  const nextMessages = context.fields.messages.slice(0, index);
  context.setters.setMessages(nextMessages);
  if (nextMessages.length === 0) {
    context.setters.setSessions((current) =>
      persistChatSessions(
        context.storageScope,
        current.filter((item) => item.id !== context.fields.sessionId),
      ),
    );
  }
  clearChatEditStateAtOrAfter(context, index);
  context.stream.reset();
}

export function deleteChatMessage(context: ChatActionContext, messageId: string): void {
  if (context.stream.isPending) return;
  const index = context.fields.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return;
  const trailingCount = context.fields.messages.length - index - 1;
  if (trailingCount > 0) {
    context.setters.setPendingTruncate({ kind: "delete", messageId, trailingCount });
    return;
  }
  applyDeleteChatMessage(context, messageId);
}

export function confirmChatTruncate(context: ChatActionContext): void {
  const action = context.fields.pendingTruncate;
  if (!action) return;
  context.setters.setPendingTruncate(null);
  if (action.kind === "delete") {
    applyDeleteChatMessage(context, action.messageId);
    return;
  }
  if (action.kind === "regenerate") {
    applyRegenerateChatAnswer(context, action.messageId);
    return;
  }
  applyUserEditAndRegenerate(context, action.messageId, action.content);
}

/** 当前会话写入历史列表；没有消息时不写，避免产生空会话。 */
export function persistCurrentChatSession(context: ChatActionContext): void {
  if (context.fields.messages.length === 0) return;
  const session = buildChatSession({
    id: context.fields.sessionId,
    createdAt: context.fields.sessionCreatedAt,
    model: context.model,
    promptCacheKey: context.fields.promptCacheKey,
    reasoningEffort: context.fields.reasoningEffort,
    webSearch: context.fields.webSearch,
    xSearch: context.fields.xSearch,
    messages: context.fields.messages,
  });
  context.setters.setSessions((current) =>
    persistChatSessions(context.storageScope, upsertChatSession(current, session)),
  );
}

function resetChatConversation(context: ChatActionContext, blank: ReturnType<typeof createBlankChatSession>): void {
  context.setters.setSessionId(blank.id);
  context.setters.setSessionCreatedAt(blank.createdAt);
  context.setters.setMessages([]);
  context.setters.setPromptCacheKey(blank.promptCacheKey);
  context.setters.setPrompt("");
  clearChatEditState(context);
  context.setters.setPendingTruncate(null);
  context.stream.reset();
}

export function clearChatConversation(context: ChatActionContext): void {
  context.stream.cancel();
  context.setters.setSessions((current) =>
    persistChatSessions(
      context.storageScope,
      current.filter((session) => session.id !== context.fields.sessionId),
    ),
  );
  resetChatConversation(context, createBlankChatSession(context.model));
}

export function startNewChatConversation(context: ChatActionContext): void {
  if (context.stream.isPending) return;
  persistCurrentChatSession(context);
  const blank = createBlankChatSession(context.model);
  resetChatConversation(context, blank);
  context.setters.setReasoningEffort(blank.reasoningEffort);
  context.setters.setWebSearch(blank.webSearch);
  context.setters.setXSearch(blank.xSearch);
}

export function switchChatConversation(context: ChatActionContext, targetId: string): void {
  if (context.stream.isPending || targetId === context.fields.sessionId) return;
  persistCurrentChatSession(context);
  const target = context.fields.sessions.find((session) => session.id === targetId);
  if (!target) return;
  context.setters.setSessions((current) => persistChatSessions(context.storageScope, current));
  context.setters.setSessionId(target.id);
  context.setters.setSessionCreatedAt(target.createdAt);
  context.setters.setMessages(target.messages);
  context.setters.setPromptCacheKey(target.promptCacheKey || createCreativeCacheKey());
  context.setters.setReasoningEffort(target.reasoningEffort);
  context.setters.setWebSearch(target.webSearch);
  context.setters.setXSearch(target.xSearch);
  context.setters.setPrompt("");
  clearChatEditState(context);
  context.setters.setPendingTruncate(null);
  context.stream.reset();
  if (target.model && context.fields.modelOptions.some((option) => option.publicId === target.model)) {
    context.fields.onModelChange(target.model);
  }
}

export function handleChatPromptKeyDown(context: ChatActionContext, event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  submitChatMessage(context);
}

export function handleChatEditKeyDown(
  context: ChatActionContext,
  messageId: string,
  event: KeyboardEvent<HTMLTextAreaElement>,
): void {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelChatMessageEdit(context);
    return;
  }
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    saveChatEditMessage(context, messageId);
  }
}
export type ChatOperations = {
  submit: (event?: FormEvent) => void;
  stopGenerating: () => void;
  startNewConversation: () => void;
  clearConversation: () => void;
  switchConversation: (sessionId: string) => void;
  startEditMessage: (messageId: string) => void;
  cancelEditMessage: () => void;
  saveEditMessage: (messageId: string) => void;
  regenerateAssistant: (messageId: string) => void;
  deleteMessage: (messageId: string) => void;
  confirmPendingTruncate: () => void;
  handlePromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  handleEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, messageId: string) => void;
};

/** 把状态、setter 与流控制器拼成动作上下文，动作只依赖这一份契约。 */
export function createChatActionContext(params: {
  apiKey: string;
  model: string;
  storageScope: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
  history: { fields: ChatHistoryFields; setters: ChatHistorySetters };
  transcript: { fields: ChatTranscriptFields; setters: ChatTranscriptSetters };
  settings: ChatSettings;
  stream: CreativeChatStreamController;
}): ChatActionContext {
  return {
    apiKey: params.apiKey,
    model: params.model,
    storageScope: params.storageScope,
    fields: {
      ...params.history.fields,
      ...params.transcript.fields,
      ...params.settings,
      model: params.model,
      modelOptions: params.modelOptions,
      onModelChange: params.onModelChange,
    },
    setters: { ...params.history.setters, ...params.transcript.setters },
    stream: params.stream,
  };
}

/** 组件只需要一个稳定的动作表，具体分支规则留在上面的纯函数里。 */
export function createChatOperations(context: ChatActionContext): ChatOperations {
  return {
    submit: (event?: FormEvent) => submitChatMessage(context, event),
    stopGenerating: () => stopChatGeneration(context),
    startNewConversation: () => startNewChatConversation(context),
    clearConversation: () => clearChatConversation(context),
    switchConversation: (sessionId: string) => switchChatConversation(context, sessionId),
    startEditMessage: (messageId: string) => startChatMessageEdit(context, messageId),
    cancelEditMessage: () => cancelChatMessageEdit(context),
    saveEditMessage: (messageId: string) => saveChatEditMessage(context, messageId),
    regenerateAssistant: (messageId: string) => regenerateChatAnswer(context, messageId),
    deleteMessage: (messageId: string) => deleteChatMessage(context, messageId),
    confirmPendingTruncate: () => confirmChatTruncate(context),
    handlePromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => handleChatPromptKeyDown(context, event),
    handleEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>, messageId: string) =>
      handleChatEditKeyDown(context, messageId, event),
  };
}
