import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";

import type { ModelRouteDTO } from "@/entities/model/types";
import {
  buildChatSession,
  createBlankChatSession,
  isFixedReasoningConsoleModel,
  upsertChatSession,
  type ChatSession,
  type ConversationMessage,
  type PendingTruncateAction,
} from "@/features/creative-console/chat-session-model";
import { loadChatSessions, persistChatSessions } from "@/features/creative-console/chat-session-store";
import type { ReasoningEffort } from "@/features/creative-console/creative-console-api";

export type ChatHistoryFields = {
  sessions: ChatSession[];
  sessionId: string;
  sessionCreatedAt: number;
};

export type ChatTranscriptFields = {
  webSearch: boolean;
  xSearch: boolean;
  reasoningEffort: ReasoningEffort;
  promptCacheKey: string;
  prompt: string;
  messages: ConversationMessage[];
  editingMessageId: string | null;
  editDraft: string;
  pendingTruncate: PendingTruncateAction | null;
  streamingMessageId: string;
};

export type ChatHistorySetters = {
  setSessions: Dispatch<SetStateAction<ChatSession[]>>;
  setSessionId: Dispatch<SetStateAction<string>>;
  setSessionCreatedAt: Dispatch<SetStateAction<number>>;
};

export type ChatTranscriptSetters = {
  setWebSearch: Dispatch<SetStateAction<boolean>>;
  setXSearch: Dispatch<SetStateAction<boolean>>;
  setReasoningEffort: Dispatch<SetStateAction<ReasoningEffort>>;
  setPromptCacheKey: Dispatch<SetStateAction<string>>;
  setPrompt: Dispatch<SetStateAction<string>>;
  setMessages: Dispatch<SetStateAction<ConversationMessage[]>>;
  setEditingMessageId: Dispatch<SetStateAction<string | null>>;
  setEditDraft: Dispatch<SetStateAction<string>>;
  setPendingTruncate: Dispatch<SetStateAction<PendingTruncateAction | null>>;
  setStreamingMessageId: Dispatch<SetStateAction<string>>;
};

export type ChatSettings = {
  fixedReasoningModel: boolean;
  reasoningEffort: ReasoningEffort;
  reasoningEffortOptions: ReasoningEffort[];
};

const reasoningEfforts: ReasoningEffort[] = ["auto", "none", "low", "medium", "high", "xhigh"];

/** 会话历史：以生效密钥为存储作用域，首个历史会话或空白会话作为当前会话。 */
export function useChatHistoryStore(
  storageScope: string,
  model: string,
): { fields: ChatHistoryFields; setters: ChatHistorySetters } {
  const [initial] = useState(() => {
    const sessions = loadChatSessions(storageScope);
    return { sessions, active: sessions[0] ?? createBlankChatSession(model) };
  });
  const [sessions, setSessions] = useState<ChatSession[]>(initial.sessions);
  const [sessionId, setSessionId] = useState(initial.active.id);
  const [sessionCreatedAt, setSessionCreatedAt] = useState(initial.active.createdAt);
  return {
    fields: { sessions, sessionId, sessionCreatedAt },
    setters: { setSessions, setSessionId, setSessionCreatedAt },
  };
}

/**
 * 当前会话的输入与消息状态：切换会话时整体替换，不跨会话复用。
 * 初始值取自挂载时恢复的历史会话，保证刷新后能看到上次的对话与开关。
 */
export function useChatTranscriptStore(initialSession: ChatSession | null): {
  fields: ChatTranscriptFields;
  setters: ChatTranscriptSetters;
} {
  const [webSearch, setWebSearch] = useState(initialSession?.webSearch ?? false);
  const [xSearch, setXSearch] = useState(initialSession?.xSearch ?? false);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>(initialSession?.reasoningEffort ?? "auto");
  const [promptCacheKey, setPromptCacheKey] = useState(initialSession?.promptCacheKey ?? "");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<ConversationMessage[]>(initialSession?.messages ?? []);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [pendingTruncate, setPendingTruncate] = useState<PendingTruncateAction | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState("");
  return {
    fields: {
      webSearch,
      xSearch,
      reasoningEffort,
      promptCacheKey,
      prompt,
      messages,
      editingMessageId,
      editDraft,
      pendingTruncate,
      streamingMessageId,
    },
    setters: {
      setWebSearch,
      setXSearch,
      setReasoningEffort,
      setPromptCacheKey,
      setPrompt,
      setMessages,
      setEditingMessageId,
      setEditDraft,
      setPendingTruncate,
      setStreamingMessageId,
    },
  };
}

/** 历史会话携带的模型只在首次可解析时回填一次，避免覆盖运营当前选择。 */
export function useChatSettings(params: {
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
  initialModel: string;
  reasoningEffort: ReasoningEffort;
}): ChatSettings {
  const { initialModel, model, modelOptions, onModelChange, reasoningEffort } = params;
  const restoredRef = useRef(false);
  const selectedRoute = useMemo(() => modelOptions.find((option) => option.publicId === model), [model, modelOptions]);
  const fixedReasoningModel = isFixedReasoningConsoleModel(selectedRoute);
  useEffect(() => {
    if (restoredRef.current || modelOptions.length === 0) return;
    restoredRef.current = true;
    if (initialModel && modelOptions.some((option) => option.publicId === initialModel)) onModelChange(initialModel);
  }, [initialModel, modelOptions, onModelChange]);
  return {
    fixedReasoningModel,
    reasoningEffort: fixedReasoningModel ? "auto" : reasoningEffort,
    reasoningEffortOptions: fixedReasoningModel ? ["auto"] : reasoningEfforts,
  };
}

/** 会话快照只在输入、消息或模型相关值变化时重建，供防抖持久化比较依赖。 */
export function useChatSessionSnapshot(params: {
  messages: ConversationMessage[];
  sessionId: string;
  sessionCreatedAt: number;
  model: string;
  promptCacheKey: string;
  reasoningEffort: ReasoningEffort;
  webSearch: boolean;
  xSearch: boolean;
}): ChatSession {
  const { messages, sessionCreatedAt, sessionId, model, promptCacheKey, reasoningEffort, webSearch, xSearch } = params;
  return useMemo(
    () =>
      buildChatSession({
        id: sessionId,
        createdAt: sessionCreatedAt,
        model,
        promptCacheKey,
        reasoningEffort,
        webSearch,
        xSearch,
        messages,
      }),
    [messages, model, promptCacheKey, reasoningEffort, sessionCreatedAt, sessionId, webSearch, xSearch],
  );
}

/** 会话快照变化后按 300ms 防抖写入本地历史；重复变化或卸载都会清掉未触发的定时器。 */
export function useChatSessionPersistence(params: {
  session: ChatSession;
  save: (session: ChatSession) => void;
}): void {
  const { save, session } = params;
  useEffect(() => {
    if (session.messages.length === 0) return;
    const timer = window.setTimeout(() => save(session), 300);
    return () => window.clearTimeout(timer);
  }, [save, session]);
}

/** 历史会话列表写入：与存储作用域绑定，scope 变化时跟随切换。 */
export function useChatSessionSaver(
  storageScope: string,
  setSessions: Dispatch<SetStateAction<ChatSession[]>>,
): (session: ChatSession) => void {
  return useMemo(
    () => (session: ChatSession) => {
      setSessions((current) => persistChatSessions(storageScope, upsertChatSession(current, session)));
    },
    [setSessions, storageScope],
  );
}
