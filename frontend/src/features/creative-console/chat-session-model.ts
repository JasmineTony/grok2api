import type { ModelRouteDTO } from "@/entities/model/types";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import type {
  ChatMessage,
  ChatStreamSnapshot,
  ChatToolActivity,
  ReasoningEffort,
} from "@/features/creative-console/creative-api-core";

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

export type CreativeChatRequest = {
  messages: ChatMessage[];
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  assistantMessageId: string;
  apiKey: string;
  model: string;
};

export type PendingTruncateAction =
  | { kind: "delete"; messageId: string; trailingCount: number }
  | { kind: "regenerate"; messageId: string; trailingCount: number }
  | { kind: "edit-user"; messageId: string; content: string; trailingCount: number };

export const chatHistoryMaxSessions = 50;

let fallbackMessageID = 0;

export function createCreativeMessageId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackMessageID += 1;
  return `creative-${Date.now().toString(36)}-${fallbackMessageID.toString(36)}`;
}

export function createCreativeCacheKey(): string {
  return `creative-console-${createCreativeMessageId()}`;
}

export function currentTimestamp(): number {
  return Date.now();
}

export function createBlankChatSession(model: string): ChatSession {
  const now = Date.now();
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

export function buildChatSession(input: {
  id: string;
  createdAt: number;
  model: string;
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
  messages: ConversationMessage[];
}): ChatSession {
  return {
    id: input.id,
    title: createChatSessionTitle(input.messages),
    createdAt: input.createdAt,
    updatedAt: currentTimestamp(),
    model: input.model,
    promptCacheKey: input.promptCacheKey,
    reasoningEffort: input.reasoningEffort,
    webSearch: input.webSearch,
    xSearch: input.xSearch,
    messages: input.messages,
  };
}

export function createChatSessionTitle(messages: ConversationMessage[]): string {
  const title =
    messages
      .find((message) => message.role === "user")
      ?.content.replace(/\s+/g, " ")
      .trim() ?? "";
  return title.length > 48 ? `${title.slice(0, 48)}…` : title || "Conversation";
}

export function upsertChatSession(sessions: ChatSession[], session: ChatSession): ChatSession[] {
  return [session, ...sessions.filter((item) => item.id !== session.id)]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, chatHistoryMaxSessions);
}

export function toRequestMessages(items: ConversationMessage[]): ChatMessage[] {
  return items
    .filter((message) => message.role === "user" || message.role === "assistant")
    .filter((message) => message.content.trim())
    .map(({ role, content }) => ({ role, content }));
}

export function applyAssistantSnapshot(
  messages: ConversationMessage[],
  messageId: string,
  snapshot: ChatStreamSnapshot,
): ConversationMessage[] {
  return messages.map((message) =>
    message.id === messageId
      ? { ...message, content: snapshot.text, reasoning: snapshot.reasoning, tools: snapshot.tools }
      : message,
  );
}

/** 真实失败保留已收到的部分内容；中止或空结果丢弃占位消息。 */
export function keepOrDropAssistant(
  messages: ConversationMessage[],
  messageId: string,
  snapshot: ChatStreamSnapshot,
  aborted: boolean,
): ConversationMessage[] {
  return messages.flatMap((message) => {
    if (message.id !== messageId) return [message];
    if (aborted || !hasChatStreamContent(snapshot)) return [];
    return [{ ...message, content: snapshot.text, reasoning: snapshot.reasoning, tools: snapshot.tools }];
  });
}

export function applyStoppedAssistant(
  messages: ConversationMessage[],
  messageId: string,
  snapshot: ChatStreamSnapshot,
): ConversationMessage[] {
  return messages.flatMap((message) => {
    if (message.id !== messageId) return [message];
    const updated = hasChatStreamContent(snapshot)
      ? { ...message, content: snapshot.text, reasoning: snapshot.reasoning, tools: snapshot.tools }
      : message;
    if (!updated.content.trim() && !updated.reasoning?.trim() && !updated.tools?.length) return [];
    return [updated];
  });
}

export function hasChatStreamContent(snapshot: ChatStreamSnapshot): boolean {
  return Boolean(snapshot.text.trim() || snapshot.reasoning.trim() || snapshot.tools.length);
}

export function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

export function isUsableKey(key: ClientKeyDTO): boolean {
  if (!key.enabled) return false;
  return !key.expiresAt || new Date(key.expiresAt).getTime() > Date.now();
}

export function validDuration(value: string): boolean {
  const duration = Number(value);
  return Number.isInteger(duration) && duration >= 1 && duration <= 15;
}

export function isFixedReasoningConsoleModel(model: ModelRouteDTO | undefined): boolean {
  return model?.provider === "grok_console" && model.upstreamModel === "grok-4.20-0309-reasoning";
}

export function formatChatSessionTime(value: number, language: string): string {
  return new Intl.DateTimeFormat(language, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
