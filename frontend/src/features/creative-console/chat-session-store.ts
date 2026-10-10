import type { ChatToolActivity, ReasoningEffort } from "@/features/creative-console/creative-api-core";
import {
  chatHistoryMaxSessions,
  createChatSessionTitle,
  createCreativeCacheKey,
  createCreativeMessageId,
  type ChatSession,
  type ConversationMessage,
} from "@/features/creative-console/chat-session-model";

const chatHistoryStoragePrefix = "grok2api:creative-console:chat-history:";
const chatHistoryMaxBytes = 4 * 1024 * 1024;

export function chatHistoryStorageKey(scope: string): string {
  return `${chatHistoryStoragePrefix}${encodeURIComponent(scope)}`;
}

export function loadChatSessions(scope: string): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(chatHistoryStorageKey(scope)) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .flatMap(parseChatSession)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, chatHistoryMaxSessions);
  } catch {
    return [];
  }
}

export function persistChatSessions(scope: string, sessions: ChatSession[]): ChatSession[] {
  if (typeof window === "undefined") return sessions;
  const retained = sessions.slice(0, chatHistoryMaxSessions);
  while (retained.length > 0) {
    try {
      const serialized = JSON.stringify(retained);
      if (serialized.length * 2 > chatHistoryMaxBytes) {
        retained.pop();
        continue;
      }
      window.localStorage.setItem(chatHistoryStorageKey(scope), serialized);
      return retained;
    } catch {
      retained.pop();
    }
  }
  try {
    window.localStorage.removeItem(chatHistoryStorageKey(scope));
  } catch {
    // 存储不可用时保留内存中的会话，不阻断对话。
  }
  return retained;
}

export function parseChatSession(value: unknown): ChatSession[] {
  if (!isLocalRecord(value) || typeof value.id !== "string" || !Array.isArray(value.messages)) return [];
  const messages = value.messages.flatMap(parseConversationMessage);
  if (messages.length === 0) return [];
  const now = Date.now();
  const createdAt = finiteTimestamp(value.createdAt) ?? now;
  const updatedAt = finiteTimestamp(value.updatedAt) ?? createdAt;
  return [
    {
      id: value.id,
      title:
        typeof value.title === "string" && value.title.trim() ? value.title.trim() : createChatSessionTitle(messages),
      createdAt,
      updatedAt,
      model: typeof value.model === "string" ? value.model : "",
      promptCacheKey:
        typeof value.promptCacheKey === "string" && value.promptCacheKey
          ? value.promptCacheKey
          : createCreativeCacheKey(),
      reasoningEffort: isReasoningEffort(value.reasoningEffort) ? value.reasoningEffort : "auto",
      webSearch: value.webSearch === true,
      xSearch: value.xSearch === true,
      messages,
    },
  ];
}

export function parseConversationMessage(value: unknown): ConversationMessage[] {
  if (
    !isLocalRecord(value) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string"
  )
    return [];
  return [
    {
      id: typeof value.id === "string" && value.id ? value.id : createCreativeMessageId(),
      role: value.role,
      content: value.content,
      reasoning: typeof value.reasoning === "string" ? value.reasoning : undefined,
      tools: Array.isArray(value.tools) ? value.tools.flatMap(parseChatToolActivity) : undefined,
    },
  ];
}

function parseChatToolActivity(value: unknown): ChatToolActivity[] {
  if (
    !isLocalRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    typeof value.name !== "string"
  )
    return [];
  const status =
    value.status === "completed" || value.status === "failed" || value.status === "in_progress"
      ? value.status
      : "completed";
  return [
    {
      id: value.id,
      type: value.type,
      name: value.name,
      status,
      detail: typeof value.detail === "string" ? value.detail : "",
    },
  ];
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return (
    value === "auto" ||
    value === "none" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
  );
}

function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function isLocalRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
