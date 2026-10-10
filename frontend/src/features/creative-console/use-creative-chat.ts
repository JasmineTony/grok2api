import type { ModelRouteDTO } from "@/entities/model/types";
import {
  createChatActionContext,
  createChatOperations,
  createChatStreamHandlers,
  type ChatActionFields,
  type ChatActionSetters,
} from "@/features/creative-console/chat-conversation-actions";
import { useCreativeChatStream } from "@/features/creative-console/use-creative-chat-stream";
import {
  useChatHistoryStore,
  useChatSessionPersistence,
  useChatSessionSaver,
  useChatSessionSnapshot,
  useChatSettings,
  useChatTranscriptStore,
} from "@/features/creative-console/use-creative-chat-store";

export type CreativeChatController = ChatActionFields &
  ChatActionSetters &
  ReturnType<typeof createChatOperations> & {
    isStreaming: boolean;
    streamError: string;
    canSubmit: boolean;
  };

/**
 * 聊天面板的业务状态：会话历史持久化、消息分支操作与流式请求编排。
 * 分支裁剪规则保持拆分前语义：删除/重生成/编辑用户消息都从目标位置截断，并需二次确认。
 */
export function useCreativeChat(input: {
  apiKey: string;
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
  storageScope: string;
}): CreativeChatController {
  const history = useChatHistoryStore(input.storageScope, input.model);
  const transcript = useChatTranscriptStore(history.fields.sessions[0] ?? null);
  const settings = useChatSettings({
    model: input.model,
    modelOptions: input.modelOptions,
    onModelChange: input.onModelChange,
    initialModel: history.fields.sessions[0]?.model ?? "",
    reasoningEffort: transcript.fields.reasoningEffort,
  });
  const saveSession = useChatSessionSaver(input.storageScope, history.setters.setSessions);
  const session = useChatSessionSnapshot({
    messages: transcript.fields.messages,
    sessionId: history.fields.sessionId,
    sessionCreatedAt: history.fields.sessionCreatedAt,
    model: input.model,
    promptCacheKey: transcript.fields.promptCacheKey,
    reasoningEffort: settings.reasoningEffort,
    webSearch: transcript.fields.webSearch,
    xSearch: transcript.fields.xSearch,
  });
  useChatSessionPersistence({ session, save: saveSession });
  const stream = useCreativeChatStream(createChatStreamHandlers(transcript.setters));
  const context = createChatActionContext({
    apiKey: input.apiKey,
    model: input.model,
    storageScope: input.storageScope,
    modelOptions: input.modelOptions,
    onModelChange: input.onModelChange,
    history,
    transcript,
    settings,
    stream,
  });
  return {
    ...context.fields,
    ...context.setters,
    ...createChatOperations(context),
    isStreaming: stream.isPending,
    streamError: stream.errorMessage,
    canSubmit: Boolean(input.apiKey && input.model && transcript.fields.prompt.trim()),
  };
}
