import type {
  ChatMessage,
  ChatToolActivity,
  ReasoningEffort,
} from "@/features/creative-console/creative-console-api";
import {
  readStorageString,
  removeStorageValue,
  writeStorageString,
} from "@/shared/storage/safe-storage";

export type ConversationMessage = ChatMessage & {
  id: string;
  reasoning?: string;
  tools?: ChatToolActivity[];
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  messages: ConversationMessage[];
};

const storagePrefix = "grok2api:creative-console:chat-history:";
const maxSessions = 50;
const maxBytes = 4 * 1024 * 1024;

export function createCreativeMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const random = new Uint32Array(2);
  globalThis.crypto?.getRandomValues?.(random);
  return `creative-${Date.now().toString(36)}-${random[0]?.toString(36) ?? "0"}${random[1]?.toString(36) ?? "0"}`;
}

export function createCreativeCacheKey(): string {
  return `creative-console-${createCreativeMessageId()}`;
}

export function currentTimestamp(): number {
  return Date.now();
}

export function createBlankChatSession(model: string): ChatSession {
  const now = currentTimestamp();
  return {
    id: createCreativeMessageId(),
    title: "",
    createdAt: now,
    updatedAt: now,
    model,
    promptCacheKey: createCreativeCacheKey(),
    reasoningEffort: "auto",
    webSearch: false,
    xSearch: false,
    messages: [],
  };
}

export function createChatSessionTitle(messages: ConversationMessage[]): string {
  const title =
    messages
      .find((message) => message.role === "user")
      ?.content.replace(/\s+/g, " ")
      .trim() ?? "";
  return title.length > 48 ? `${title.slice(0, 48)}?` : title || "Conversation";
}

export function upsertChatSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  return [session, ...sessions.filter((item) => item.id !== session.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, maxSessions);
}

export function loadChatSessions(scope: string): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(readStorageString(storageKey(scope)) ?? "[]");
    return Array.isArray(parsed)
      ? parsed
          .flatMap(parseChatSession)
          .sort((left, right) => right.updatedAt - left.updatedAt)
          .slice(0, maxSessions)
      : [];
  } catch {
    return [];
  }
}

export function persistChatSessions(scope: string, sessions: ChatSession[]): ChatSession[] {
  if (typeof window === "undefined") return sessions;
  const retained = sessions.slice(0, maxSessions);
  while (retained.length > 0) {
    try {
      const serialized = JSON.stringify(retained);
      if (serialized.length * 2 > maxBytes) {
        retained.pop();
        continue;
      }
      if (writeStorageString(storageKey(scope), serialized)) return retained;
      retained.pop();
    } catch {
      retained.pop();
    }
  }
  try {
    removeStorageValue(storageKey(scope));
  } catch {
    /* Storage is optional. */
  }
  return retained;
}

export function formatChatSessionTime(value: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function storageKey(scope: string): string {
  return `${storagePrefix}${encodeURIComponent(scope)}`;
}
function parseChatSession(value: unknown): ChatSession[] {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.messages)) return [];
  const messages = value.messages.flatMap(parseConversationMessage);
  if (messages.length === 0) return [];
  const now = currentTimestamp();
  const createdAt = finiteTimestamp(value.createdAt) ?? now;
  return [
    {
      id: value.id,
      title:
        typeof value.title === "string" && value.title.trim()
          ? value.title.trim()
          : createChatSessionTitle(messages),
      createdAt,
      updatedAt: finiteTimestamp(value.updatedAt) ?? createdAt,
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
function parseConversationMessage(value: unknown): ConversationMessage[] {
  if (
    !isRecord(value) ||
    (value.role !== "user" && value.role !== "assistant") ||
    typeof value.content !== "string"
  )
    return [];
  return [
    {
      id: typeof value.id === "string" && value.id ? value.id : createCreativeMessageId(),
      role: value.role,
      content: value.content,
      ...(typeof value.reasoning === "string" ? { reasoning: value.reasoning } : {}),
      ...(Array.isArray(value.tools) ? { tools: value.tools.flatMap(parseToolActivity) } : {}),
    },
  ];
}
function parseToolActivity(value: unknown): ChatToolActivity[] {
  if (
    !isRecord(value) ||
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
  return ["auto", "none", "low", "medium", "high", "xhigh"].includes(String(value));
}
function finiteTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
