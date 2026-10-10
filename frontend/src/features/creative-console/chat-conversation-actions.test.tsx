import type { ModelRouteDTO } from "@/entities/model/types";
import {
  cancelChatMessageEdit,
  clearChatConversation,
  clearChatEditState,
  confirmChatTruncate,
  createAssistantPlaceholder,
  createChatOperations,
  createChatStreamHandlers,
  deleteChatMessage,
  handleChatEditKeyDown,
  handleChatPromptKeyDown,
  invalidatePromptCache,
  persistCurrentChatSession,
  regenerateChatAnswer,
  saveChatEditMessage,
  startChatMessageEdit,
  startNewChatConversation,
  stopChatGeneration,
  submitChatMessage,
  switchChatConversation,
  type ChatActionContext,
  type ChatActionFields,
  type ChatActionSetters,
} from "@/features/creative-console/chat-conversation-actions";
import type {
  ChatSession,
  ConversationMessage,
  CreativeChatRequest,
  PendingTruncateAction,
} from "@/features/creative-console/chat-session-model";
import { chatHistoryStorageKey } from "@/features/creative-console/chat-session-store";
import type { ChatStreamSnapshot } from "@/features/creative-console/creative-api-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormEvent, KeyboardEvent } from "react";

const modelOptions: ModelRouteDTO[] = [
  {
    id: "m1",
    publicId: "grok-4",
    capability: "chat",
    provider: "grok_web",
    upstreamModel: "grok-4",
  },
] as ModelRouteDTO[];

type HarnessOptions = {
  apiKey?: string;
  model?: string;
  storageScope?: string;
  sessions?: ChatSession[];
  sessionId?: string;
  sessionCreatedAt?: number;
  promptCacheKey?: string;
  prompt?: string;
  messages?: ConversationMessage[];
  editingMessageId?: string | null;
  editDraft?: string;
  pendingTruncate?: PendingTruncateAction | null;
  streamingMessageId?: string;
  modelOptions?: ModelRouteDTO[];
  onModelChange?: (model: string) => void;
};

type Harness = {
  context: ChatActionContext;
  fields: ChatActionFields;
  requests: CreativeChatRequest[];
  stream: ChatActionContext["stream"] & {
    cancel: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
  };
  setPending: (pending: boolean) => void;
  onModelChange: (model: string) => void;
};

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id: "m1", role: "assistant", content: "正文", ...overrides };
}

function snapshot(overrides: Partial<ChatStreamSnapshot> = {}): ChatStreamSnapshot {
  return { text: "", reasoning: "", tools: [], ...overrides };
}

function keyEvent(init: { key: string; shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }) {
  return {
    key: init.key,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLTextAreaElement>;
}

function formEvent(): FormEvent {
  return { preventDefault: vi.fn() } as unknown as FormEvent;
}

/** 用真实可变的 fields + 支持函数式更新的 setter 模拟组件状态，断言的是状态变化而不是调用次数。 */
function createHarness(options: HarnessOptions = {}): Harness {
  const fields: ChatActionFields = {
    sessions: options.sessions ?? [],
    sessionId: options.sessionId ?? "session-1",
    sessionCreatedAt: options.sessionCreatedAt ?? 1,
    webSearch: false,
    xSearch: false,
    reasoningEffort: "auto",
    promptCacheKey: options.promptCacheKey ?? "cache-1",
    prompt: options.prompt ?? "",
    messages: options.messages ?? [],
    editingMessageId: options.editingMessageId ?? null,
    editDraft: options.editDraft ?? "",
    pendingTruncate: options.pendingTruncate ?? null,
    streamingMessageId: options.streamingMessageId ?? "",
    model: options.model ?? "grok-4",
    modelOptions: options.modelOptions ?? modelOptions,
    onModelChange: options.onModelChange ?? vi.fn(),
    fixedReasoningModel: false,
    reasoningEffortOptions: ["auto", "none", "high"],
  };

  const set = <K extends keyof ChatActionFields>(
    key: K,
    value: ChatActionFields[K] | ((current: ChatActionFields[K]) => ChatActionFields[K]),
  ): void => {
    const current = fields[key];
    fields[key] =
      typeof value === "function" ? (value as (item: ChatActionFields[K]) => ChatActionFields[K])(current) : value;
  };

  const setters: ChatActionSetters = {
    setSessions: (value) => set("sessions", value),
    setSessionId: (value) => set("sessionId", value),
    setSessionCreatedAt: (value) => set("sessionCreatedAt", value),
    setWebSearch: (value) => set("webSearch", value),
    setXSearch: (value) => set("xSearch", value),
    setReasoningEffort: (value) => set("reasoningEffort", value),
    setPromptCacheKey: (value) => set("promptCacheKey", value),
    setPrompt: (value) => set("prompt", value),
    setMessages: (value) => set("messages", value),
    setEditingMessageId: (value) => set("editingMessageId", value),
    setEditDraft: (value) => set("editDraft", value),
    setPendingTruncate: (value) => set("pendingTruncate", value),
    setStreamingMessageId: (value) => set("streamingMessageId", value),
  };

  const requests: CreativeChatRequest[] = [];
  const stream = {
    isPending: false,
    errorMessage: "",
    cancel: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
    start: (request: CreativeChatRequest) => requests.push(request),
  };

  return {
    context: {
      apiKey: options.apiKey ?? "secret-key",
      model: options.model ?? "grok-4",
      storageScope: options.storageScope ?? "scope-1",
      fields,
      setters,
      stream,
    },
    fields,
    requests,
    stream,
    setPending: (pending: boolean) => {
      stream.isPending = pending;
    },
    onModelChange: fields.onModelChange,
  };
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("流式回调与占位消息", () => {
  it("助手占位消息只带 id", () => {
    expect(createAssistantPlaceholder("a1")).toEqual({
      id: "a1",
      role: "assistant",
      content: "",
      reasoning: "",
      tools: [],
    });
  });

  it("增量快照写回目标消息，成功后清空流式消息 id", () => {
    const harness = createHarness({ messages: [message({ id: "a1" })], streamingMessageId: "a1" });
    const handlers = createChatStreamHandlers(harness.context.setters);

    handlers.onSnapshot("a1", snapshot({ text: "增量", reasoning: "推理" }));
    expect(harness.fields.messages[0]).toMatchObject({ content: "增量", reasoning: "推理" });
    expect(harness.fields.streamingMessageId).toBe("a1");

    handlers.onSuccess("a1", snapshot({ text: "完成" }));
    expect(harness.fields.messages[0].content).toBe("完成");
    expect(harness.fields.streamingMessageId).toBe("");
  });

  it("失败回调保留部分内容、中止时丢弃占位并清空流式消息 id", () => {
    const failed = createHarness({ messages: [message({ id: "a1" })], streamingMessageId: "a1" });
    const handlers = createChatStreamHandlers(failed.context.setters);
    handlers.onFailure("a1", snapshot({ text: "半截" }), false);
    expect(failed.fields.messages).toHaveLength(1);
    expect(failed.fields.messages[0].content).toBe("半截");
    expect(failed.fields.streamingMessageId).toBe("");

    const aborted = createHarness({ messages: [message({ id: "a1" })], streamingMessageId: "a1" });
    createChatStreamHandlers(aborted.context.setters).onFailure("a1", snapshot({ text: "半截" }), true);
    expect(aborted.fields.messages).toEqual([]);
    expect(aborted.fields.streamingMessageId).toBe("");
  });

  it("停止回调写入已收到内容并清空流式消息 id", () => {
    const harness = createHarness({ messages: [message({ id: "a1" })], streamingMessageId: "a1" });
    createChatStreamHandlers(harness.context.setters).onStop("a1", snapshot({ text: "已收到" }));
    expect(harness.fields.messages[0].content).toBe("已收到");
    expect(harness.fields.streamingMessageId).toBe("");
  });
});

describe("编辑态与缓存键", () => {
  it("清空编辑态重置草稿；轮换缓存键会写入新值", () => {
    const harness = createHarness({ editingMessageId: "m1", editDraft: "草稿" });
    clearChatEditState(harness.context);
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.fields.editDraft).toBe("");

    const next = invalidatePromptCache(harness.context);
    expect(next).toMatch(/^creative-console-/);
    expect(harness.fields.promptCacheKey).toBe(next);
    expect(next).not.toBe("cache-1");
  });
});

describe("发送消息", () => {
  it("缺少密钥、模型、正文或请求在途时都不发送", () => {
    const event = formEvent();
    const missingKey = createHarness({ apiKey: "", prompt: "你好" });
    submitChatMessage(missingKey.context, event);
    expect(missingKey.requests).toEqual([]);
    expect(missingKey.fields.messages).toEqual([]);

    const missingModel = createHarness({ model: "", prompt: "你好" });
    submitChatMessage(missingModel.context);
    expect(missingModel.requests).toEqual([]);

    const emptyPrompt = createHarness({ prompt: "   " });
    submitChatMessage(emptyPrompt.context);
    expect(emptyPrompt.requests).toEqual([]);

    const pending = createHarness({ prompt: "你好" });
    pending.setPending(true);
    submitChatMessage(pending.context);
    expect(pending.requests).toEqual([]);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("发送后追加用户消息与助手占位、清空输入与编辑态，并按会话设置发起请求", () => {
    const harness = createHarness({
      prompt: "  你好  ",
      messages: [message({ id: "u0", role: "user", content: "上一轮" })],
      editingMessageId: "u0",
      editDraft: "草稿",
    });

    submitChatMessage(harness.context);

    expect(harness.fields.messages).toHaveLength(3);
    expect(harness.fields.messages[1]).toMatchObject({ role: "user", content: "你好" });
    expect(harness.fields.messages[2]).toMatchObject({ role: "assistant", content: "" });
    expect(harness.fields.prompt).toBe("");
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.fields.editDraft).toBe("");
    expect(harness.fields.streamingMessageId).toBe(harness.fields.messages[2].id);

    expect(harness.requests).toHaveLength(1);
    expect(harness.requests[0]).toMatchObject({
      messages: [
        { role: "user", content: "上一轮" },
        { role: "user", content: "你好" },
      ],
      promptCacheKey: "cache-1",
      reasoningEffort: "auto",
      webSearch: false,
      xSearch: false,
      assistantMessageId: harness.fields.messages[2].id,
      apiKey: "secret-key",
      model: "grok-4",
    });
  });

  it("停止生成直接委托流控制器", () => {
    const harness = createHarness();
    stopChatGeneration(harness.context);
    expect(harness.stream.stop).toHaveBeenCalledTimes(1);
  });
});

describe("重新生成回答", () => {
  const history: ConversationMessage[] = [
    message({ id: "u1", role: "user", content: "提问" }),
    message({ id: "a1", content: "回答" }),
  ];

  it("缺少密钥或模型、目标不存在或目标不是助手消息时都不发起请求", () => {
    const noKey = createHarness({ apiKey: "", messages: history });
    regenerateChatAnswer(noKey.context, "a1");
    expect(noKey.requests).toEqual([]);

    const noModel = createHarness({ model: "", messages: history });
    regenerateChatAnswer(noModel.context, "a1");
    expect(noModel.requests).toEqual([]);

    const missing = createHarness({ messages: history });
    regenerateChatAnswer(missing.context, "missing");
    expect(missing.requests).toEqual([]);

    const userTarget = createHarness({ messages: history });
    regenerateChatAnswer(userTarget.context, "u1");
    expect(userTarget.requests).toEqual([]);

    const noUserBefore = createHarness({ messages: [message({ id: "a1" })] });
    regenerateChatAnswer(noUserBefore.context, "a1");
    expect(noUserBefore.requests).toEqual([]);
  });

  it("保留后续轮次时先请求二次确认，不做任何截断", () => {
    const harness = createHarness({ messages: [...history, message({ id: "u2", role: "user", content: "追问" })] });
    regenerateChatAnswer(harness.context, "a1");

    expect(harness.fields.pendingTruncate).toEqual({ kind: "regenerate", messageId: "a1", trailingCount: 1 });
    expect(harness.fields.messages).toHaveLength(3);
    expect(harness.requests).toEqual([]);
  });

  it("末轮重新生成会取消在途请求、轮换缓存键并以同一消息 id 重建占位", () => {
    const harness = createHarness({ messages: history, editingMessageId: "a1", editDraft: "旧草稿" });
    regenerateChatAnswer(harness.context, "a1");

    expect(harness.stream.cancel).toHaveBeenCalledTimes(1);
    expect(harness.fields.messages).toHaveLength(2);
    expect(harness.fields.messages[1]).toMatchObject({ id: "a1", role: "assistant", content: "" });
    expect(harness.fields.promptCacheKey).not.toBe("cache-1");
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.requests[0]).toMatchObject({
      assistantMessageId: "a1",
      promptCacheKey: harness.fields.promptCacheKey,
    });
    expect(harness.requests[0].messages).toEqual([{ role: "user", content: "提问" }]);
  });
});

describe("编辑消息", () => {
  it("流式请求在途或目标不存在时不进入编辑态", () => {
    const pending = createHarness({ messages: [message({ id: "m1" })] });
    pending.setPending(true);
    startChatMessageEdit(pending.context, "m1");
    expect(pending.fields.editingMessageId).toBeNull();

    const missing = createHarness({ messages: [message({ id: "m1" })] });
    startChatMessageEdit(missing.context, "missing");
    expect(missing.fields.editingMessageId).toBeNull();
  });

  it("进入编辑态带入原正文，取消编辑清空草稿", () => {
    const harness = createHarness({ messages: [message({ id: "m1", content: "原正文" })] });
    startChatMessageEdit(harness.context, "m1");
    expect(harness.fields.editingMessageId).toBe("m1");
    expect(harness.fields.editDraft).toBe("原正文");

    cancelChatMessageEdit(harness.context);
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.fields.editDraft).toBe("");
  });

  it("保存编辑时忽略在途请求、空草稿与不存在的消息", () => {
    const pending = createHarness({ messages: [message({ id: "m1" })], editDraft: "新内容" });
    pending.setPending(true);
    saveChatEditMessage(pending.context, "m1");
    expect(pending.fields.messages[0].content).toBe("正文");

    const blank = createHarness({ messages: [message({ id: "m1" })], editDraft: "   " });
    saveChatEditMessage(blank.context, "m1");
    expect(blank.fields.messages[0].content).toBe("正文");

    const missing = createHarness({ messages: [message({ id: "m1" })], editDraft: "新内容" });
    saveChatEditMessage(missing.context, "missing");
    expect(missing.requests).toEqual([]);
  });

  it("助手回复只做本地编辑，保留后续轮次并清空推理与工具明细", () => {
    const harness = createHarness({
      messages: [
        message({ id: "u1", role: "user", content: "提问" }),
        message({
          id: "a1",
          content: "回答",
          reasoning: "推理",
          tools: [{ id: "t1", type: "web_search_call", name: "web_search", status: "completed", detail: "" }],
        }),
        message({ id: "u2", role: "user", content: "追问" }),
      ],
      editDraft: "本地改写",
      editingMessageId: "a1",
    });

    saveChatEditMessage(harness.context, "a1");

    expect(harness.fields.messages).toHaveLength(3);
    expect(harness.fields.messages[1]).toMatchObject({ id: "a1", content: "本地改写" });
    expect(harness.fields.messages[1].reasoning).toBeUndefined();
    expect(harness.fields.messages[1].tools).toBeUndefined();
    expect(harness.fields.promptCacheKey).not.toBe("cache-1");
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.requests).toEqual([]);
  });

  it("本地编辑末轮助手回复不轮换缓存键", () => {
    const harness = createHarness({
      messages: [message({ id: "u1", role: "user", content: "提问" }), message({ id: "a1", content: "回答" })],
      editDraft: "本地改写",
    });
    saveChatEditMessage(harness.context, "a1");
    expect(harness.fields.promptCacheKey).toBe("cache-1");
  });

  it("编辑用户消息时保留后续轮次需要确认，末轮则截断后重新请求", () => {
    const trailing = createHarness({
      messages: [
        message({ id: "u1", role: "user", content: "提问" }),
        message({ id: "a1", content: "回答" }),
        message({ id: "u2", role: "user", content: "追问" }),
      ],
      editDraft: "改写后的提问",
    });
    saveChatEditMessage(trailing.context, "u1");
    expect(trailing.fields.pendingTruncate).toEqual({
      kind: "edit-user",
      messageId: "u1",
      content: "改写后的提问",
      trailingCount: 2,
    });
    expect(trailing.requests).toEqual([]);

    const lastTurn = createHarness({
      messages: [message({ id: "u1", role: "user", content: "提问" })],
      editDraft: "改写后的提问",
    });
    saveChatEditMessage(lastTurn.context, "u1");

    expect(lastTurn.stream.cancel).toHaveBeenCalledTimes(1);
    expect(lastTurn.fields.messages).toHaveLength(2);
    expect(lastTurn.fields.messages[0]).toMatchObject({ id: "u1", content: "改写后的提问" });
    expect(lastTurn.requests[0].messages).toEqual([{ role: "user", content: "改写后的提问" }]);
  });

  it("编辑用户消息但没有可用密钥时不发起重新生成", () => {
    const harness = createHarness({
      apiKey: "",
      messages: [message({ id: "u1", role: "user", content: "提问" })],
      editDraft: "改写后的提问",
    });
    saveChatEditMessage(harness.context, "u1");
    expect(harness.requests).toEqual([]);
    expect(harness.fields.messages).toHaveLength(1);
    expect(harness.fields.messages[0].content).toBe("提问");
  });
});

describe("删除消息", () => {
  it("流式请求在途或目标不存在时不删除", () => {
    const pending = createHarness({ messages: [message({ id: "m1" })] });
    pending.setPending(true);
    deleteChatMessage(pending.context, "m1");
    expect(pending.fields.messages).toHaveLength(1);
    expect(pending.stream.cancel).not.toHaveBeenCalled();

    const missing = createHarness({ messages: [message({ id: "m1" })] });
    deleteChatMessage(missing.context, "missing");
    expect(missing.fields.messages).toHaveLength(1);
  });

  it("删除带后续轮次的消息先请求二次确认", () => {
    const harness = createHarness({ messages: [message({ id: "m1" }), message({ id: "m2", role: "user" })] });
    deleteChatMessage(harness.context, "m1");
    expect(harness.fields.pendingTruncate).toEqual({ kind: "delete", messageId: "m1", trailingCount: 1 });
    expect(harness.fields.messages).toHaveLength(2);
  });

  it("删除末轮消息会取消请求、截断消息并轮换缓存键", () => {
    const harness = createHarness({
      messages: [message({ id: "u1", role: "user", content: "提问" }), message({ id: "a1", content: "回答" })],
      editingMessageId: "a1",
      editDraft: "草稿",
    });

    deleteChatMessage(harness.context, "a1");

    expect(harness.stream.cancel).toHaveBeenCalledTimes(1);
    expect(harness.stream.reset).toHaveBeenCalledTimes(1);
    expect(harness.fields.messages.map((item) => item.id)).toEqual(["u1"]);
    expect(harness.fields.promptCacheKey).not.toBe("cache-1");
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.fields.editDraft).toBe("");
  });

  it("编辑更早的消息时删除末轮不清空编辑态", () => {
    const harness = createHarness({
      messages: [message({ id: "u1", role: "user", content: "提问" }), message({ id: "a1", content: "回答" })],
      editingMessageId: "u1",
      editDraft: "改写中",
    });

    deleteChatMessage(harness.context, "a1");

    expect(harness.fields.editingMessageId).toBe("u1");
    expect(harness.fields.editDraft).toBe("改写中");
  });

  it("删除最后一条消息时同时把该会话从历史与本地存储移除", () => {
    const session: ChatSession = {
      id: "session-1",
      title: "标题",
      createdAt: 1,
      updatedAt: 2,
      model: "grok-4",
      promptCacheKey: "cache-1",
      reasoningEffort: "auto",
      webSearch: false,
      xSearch: false,
      messages: [message({ id: "a1" })],
    };
    const harness = createHarness({ sessions: [session], messages: [message({ id: "a1" })] });

    deleteChatMessage(harness.context, "a1");

    expect(harness.fields.messages).toEqual([]);
    expect(harness.fields.sessions).toEqual([]);
    expect(window.localStorage.getItem(chatHistoryStorageKey("scope-1"))).toBeNull();
  });
});

describe("二次确认截断", () => {
  const sessions: ChatSession[] = [
    {
      id: "session-1",
      title: "标题",
      createdAt: 1,
      updatedAt: 2,
      model: "grok-4",
      promptCacheKey: "cache-1",
      reasoningEffort: "auto",
      webSearch: false,
      xSearch: false,
      messages: [],
    },
  ];

  it("没有待确认动作时不做任何事", () => {
    const harness = createHarness({ messages: [message({ id: "m1" })] });
    confirmChatTruncate(harness.context);
    expect(harness.fields.messages).toHaveLength(1);
    expect(harness.fields.pendingTruncate).toBeNull();
  });

  it("确认删除会截断目标及其之后的消息", () => {
    const harness = createHarness({
      messages: [message({ id: "m1", role: "user", content: "提问" }), message({ id: "m2", content: "回答" })],
      pendingTruncate: { kind: "delete", messageId: "m1", trailingCount: 1 },
    });

    confirmChatTruncate(harness.context);

    expect(harness.fields.pendingTruncate).toBeNull();
    expect(harness.fields.messages).toEqual([]);
    expect(harness.fields.sessions).toEqual([]);
  });

  it("确认重新生成会以原消息 id 重建占位并发起请求", () => {
    const harness = createHarness({
      messages: [
        message({ id: "u1", role: "user", content: "提问" }),
        message({ id: "a1", content: "回答" }),
        message({ id: "u2", role: "user", content: "追问" }),
      ],
      pendingTruncate: { kind: "regenerate", messageId: "a1", trailingCount: 1 },
    });

    confirmChatTruncate(harness.context);

    expect(harness.fields.pendingTruncate).toBeNull();
    expect(harness.fields.messages.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(harness.requests[0].assistantMessageId).toBe("a1");
  });

  it("确认编辑用户消息会截断后续轮次并重新请求", () => {
    const harness = createHarness({
      messages: [
        message({ id: "u1", role: "user", content: "提问" }),
        message({ id: "a1", content: "回答" }),
        message({ id: "u2", role: "user", content: "追问" }),
      ],
      pendingTruncate: { kind: "edit-user", messageId: "u1", content: "改写后的提问", trailingCount: 2 },
    });

    confirmChatTruncate(harness.context);

    expect(harness.fields.messages).toHaveLength(2);
    expect(harness.fields.messages[0].id).toBe("u1");
    expect(harness.fields.messages[1]).toMatchObject({ role: "assistant", content: "" });
    expect(harness.fields.messages[0].content).toBe("改写后的提问");
    expect(harness.requests[0].messages).toEqual([{ role: "user", content: "改写后的提问" }]);
  });

  it("确认编辑用户消息但缺少密钥或模型时不写回消息", () => {
    const harness = createHarness({
      model: "",
      sessions,
      messages: [message({ id: "u1", role: "user", content: "提问" })],
      pendingTruncate: { kind: "edit-user", messageId: "u1", content: "改写后的提问", trailingCount: 0 },
    });

    confirmChatTruncate(harness.context);

    expect(harness.fields.messages[0].content).toBe("提问");
    expect(harness.requests).toEqual([]);
  });
});

describe("会话持久化与切换", () => {
  it("没有消息时不写入历史，避免产生空会话", () => {
    const harness = createHarness({ sessions: [], messages: [] });
    persistCurrentChatSession(harness.context);
    expect(harness.fields.sessions).toEqual([]);
    expect(window.localStorage.getItem(chatHistoryStorageKey("scope-1"))).toBeNull();
  });

  it("有消息时把当前会话按标题写入历史列表与本地存储", () => {
    const harness = createHarness({
      sessions: [],
      messages: [message({ id: "u1", role: "user", content: "第一句提问" })],
    });

    persistCurrentChatSession(harness.context);

    expect(harness.fields.sessions).toHaveLength(1);
    expect(harness.fields.sessions[0]).toMatchObject({ id: "session-1", title: "第一句提问", model: "grok-4" });
    expect(window.localStorage.getItem(chatHistoryStorageKey("scope-1"))).toContain("第一句提问");
  });

  it("清空会话会取消在途请求、移除历史并用空白会话重开", () => {
    const session: ChatSession = {
      id: "session-1",
      title: "标题",
      createdAt: 1,
      updatedAt: 2,
      model: "grok-4",
      promptCacheKey: "cache-1",
      reasoningEffort: "high",
      webSearch: true,
      xSearch: true,
      messages: [message({ id: "a1" })],
    };
    const harness = createHarness({
      sessions: [session],
      messages: [message({ id: "a1" })],
      prompt: "半句话",
      editingMessageId: "a1",
      editDraft: "草稿",
      pendingTruncate: { kind: "delete", messageId: "a1", trailingCount: 0 },
    });

    clearChatConversation(harness.context);

    expect(harness.stream.cancel).toHaveBeenCalledTimes(1);
    expect(harness.stream.reset).toHaveBeenCalledTimes(1);
    expect(harness.fields.sessions).toEqual([]);
    expect(harness.fields.sessionId).not.toBe("session-1");
    expect(harness.fields.messages).toEqual([]);
    expect(harness.fields.prompt).toBe("");
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.fields.editDraft).toBe("");
    expect(harness.fields.pendingTruncate).toBeNull();
    expect(harness.fields.promptCacheKey).toMatch(/^creative-console-/);
    expect(window.localStorage.getItem(chatHistoryStorageKey("scope-1"))).toBeNull();
  });

  it("新会话先保存当前会话，再重置推理开关与输入", () => {
    const harness = createHarness({
      sessions: [],
      messages: [message({ id: "u1", role: "user", content: "第一句提问" })],
      prompt: "半句话",
    });
    harness.fields.webSearch = true;
    harness.fields.xSearch = true;
    harness.fields.reasoningEffort = "high";

    startNewChatConversation(harness.context);

    expect(harness.fields.sessions).toHaveLength(1);
    expect(window.localStorage.getItem(chatHistoryStorageKey("scope-1"))).toContain("第一句提问");
    expect(harness.fields.messages).toEqual([]);
    expect(harness.fields.webSearch).toBe(false);
    expect(harness.fields.xSearch).toBe(false);
    expect(harness.fields.reasoningEffort).toBe("auto");
    expect(harness.fields.prompt).toBe("");
    expect(harness.stream.reset).toHaveBeenCalledTimes(1);
  });

  it("流式请求在途时不新建会话", () => {
    const harness = createHarness({ messages: [message({ id: "u1", role: "user", content: "提问" })] });
    harness.setPending(true);
    startNewChatConversation(harness.context);
    expect(harness.fields.messages).toHaveLength(1);
    expect(harness.stream.reset).not.toHaveBeenCalled();
  });

  it("切换会话恢复目标会话的消息、开关与模型，并清空输入与编辑态", () => {
    const onModelChange = vi.fn();
    const target: ChatSession = {
      id: "session-2",
      title: "历史会话",
      createdAt: 7,
      updatedAt: 8,
      model: "grok-4",
      promptCacheKey: "cache-2",
      reasoningEffort: "high",
      webSearch: true,
      xSearch: true,
      messages: [message({ id: "u2", role: "user", content: "历史提问" })],
    };
    const harness = createHarness({
      sessions: [target],
      messages: [],
      prompt: "半句话",
      editingMessageId: "x",
      editDraft: "草稿",
      pendingTruncate: { kind: "delete", messageId: "x", trailingCount: 1 },
      onModelChange,
    });

    switchChatConversation(harness.context, "session-2");

    expect(harness.fields.sessionId).toBe("session-2");
    expect(harness.fields.sessionCreatedAt).toBe(7);
    expect(harness.fields.messages).toEqual(target.messages);
    expect(harness.fields.promptCacheKey).toBe("cache-2");
    expect(harness.fields.reasoningEffort).toBe("high");
    expect(harness.fields.webSearch).toBe(true);
    expect(harness.fields.xSearch).toBe(true);
    expect(harness.fields.prompt).toBe("");
    expect(harness.fields.editingMessageId).toBeNull();
    expect(harness.fields.pendingTruncate).toBeNull();
    expect(harness.stream.reset).toHaveBeenCalledTimes(1);
    expect(onModelChange).toHaveBeenCalledWith("grok-4");
  });

  it("切换会话时旧会话先写入历史，目标模型不在可用列表或缺少缓存键时按回退处理", () => {
    const target: ChatSession = {
      id: "session-2",
      title: "历史会话",
      createdAt: 7,
      updatedAt: 8,
      model: "removed-model",
      promptCacheKey: "",
      reasoningEffort: "auto",
      webSearch: false,
      xSearch: false,
      messages: [message({ id: "u2", role: "user", content: "历史提问" })],
    };
    const onModelChange = vi.fn();
    const harness = createHarness({
      sessions: [target],
      messages: [message({ id: "u1", role: "user", content: "当前提问" })],
      onModelChange,
    });

    switchChatConversation(harness.context, "session-2");

    expect(onModelChange).not.toHaveBeenCalled();
    expect(harness.fields.promptCacheKey).toMatch(/^creative-console-/);
    expect(window.localStorage.getItem(chatHistoryStorageKey("scope-1"))).toContain("当前提问");
  });

  it("在途请求、相同会话或不存在的会话都不切换", () => {
    const pending = createHarness({ sessions: [], messages: [message({ id: "m1" })] });
    pending.setPending(true);
    switchChatConversation(pending.context, "session-2");
    expect(pending.fields.sessionId).toBe("session-1");

    const same = createHarness({ sessions: [] });
    switchChatConversation(same.context, "session-1");
    expect(same.stream.reset).not.toHaveBeenCalled();

    const missing = createHarness({ sessions: [], messages: [message({ id: "m1" })] });
    switchChatConversation(missing.context, "session-9");
    expect(missing.fields.sessionId).toBe("session-1");
    expect(missing.fields.messages).toHaveLength(1);
  });
});

describe("键盘操作", () => {
  it("Enter 发送、Shift+Enter 与其它按键不发送", () => {
    const harness = createHarness({ prompt: "回车发送" });
    const shiftEnter = keyEvent({ key: "Enter", shiftKey: true });
    handleChatPromptKeyDown(harness.context, shiftEnter);
    expect(harness.requests).toEqual([]);
    expect(shiftEnter.preventDefault).not.toHaveBeenCalled();

    handleChatPromptKeyDown(harness.context, keyEvent({ key: "a" }));
    expect(harness.requests).toEqual([]);

    const enter = keyEvent({ key: "Enter" });
    handleChatPromptKeyDown(harness.context, enter);
    expect(enter.preventDefault).toHaveBeenCalledTimes(1);
    expect(harness.requests).toHaveLength(1);
  });

  it("编辑框 Escape 取消编辑，Ctrl/Cmd+Enter 保存，其它按键不动", () => {
    const escape = createHarness({ messages: [message({ id: "m1" })], editingMessageId: "m1", editDraft: "草稿" });
    const escapeEvent = keyEvent({ key: "Escape" });
    handleChatEditKeyDown(escape.context, "m1", escapeEvent);
    expect(escapeEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(escape.fields.editingMessageId).toBeNull();

    const save = createHarness({ messages: [message({ id: "m1" })], editDraft: "本地改写" });
    const saveEvent = keyEvent({ key: "Enter", ctrlKey: true });
    handleChatEditKeyDown(save.context, "m1", saveEvent);
    expect(saveEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(save.fields.messages[0].content).toBe("本地改写");

    const meta = createHarness({ messages: [message({ id: "m1" })], editDraft: "本地改写" });
    handleChatEditKeyDown(meta.context, "m1", keyEvent({ key: "Enter", metaKey: true }));
    expect(meta.fields.messages[0].content).toBe("本地改写");

    const plain = createHarness({ messages: [message({ id: "m1" })], editDraft: "本地改写" });
    const plainEvent = keyEvent({ key: "Enter" });
    handleChatEditKeyDown(plain.context, "m1", plainEvent);
    expect(plainEvent.preventDefault).not.toHaveBeenCalled();
    expect(plain.fields.messages[0].content).toBe("正文");

    const other = createHarness({ messages: [message({ id: "m1" })], editDraft: "本地改写" });
    handleChatEditKeyDown(other.context, "m1", keyEvent({ key: "a" }));
    expect(other.fields.messages[0].content).toBe("正文");
  });
});

describe("动作表", () => {
  it("13 个动作都委托到对应实现，使用同一份上下文状态", () => {
    const harness = createHarness({
      messages: [message({ id: "u1", role: "user", content: "提问" }), message({ id: "a1", content: "回答" })],
    });
    const operations = createChatOperations(harness.context);

    operations.startEditMessage("u1");
    expect(harness.fields.editingMessageId).toBe("u1");
    operations.cancelEditMessage();
    expect(harness.fields.editingMessageId).toBeNull();

    operations.stopGenerating();
    expect(harness.stream.stop).toHaveBeenCalledTimes(1);

    operations.deleteMessage("a1");
    expect(harness.fields.messages.map((item) => item.id)).toEqual(["u1"]);

    operations.regenerateAssistant("u1");
    expect(harness.fields.messages).toHaveLength(1);

    operations.startEditMessage("u1");
    operations.handleEditKeyDown(keyEvent({ key: "Escape" }), "u1");
    expect(harness.fields.editingMessageId).toBeNull();

    operations.startEditMessage("u1");
    harness.fields.editDraft = "改写后的提问";
    operations.saveEditMessage("u1");
    expect(harness.fields.messages[0].content).toBe("改写后的提问");
    expect(harness.requests).toHaveLength(1);

    operations.confirmPendingTruncate();
    expect(harness.fields.pendingTruncate).toBeNull();

    harness.fields.prompt = "新的提问";
    operations.submit(formEvent());
    expect(harness.requests).toHaveLength(2);
    expect(harness.requests[1].messages.at(-1)).toEqual({ role: "user", content: "新的提问" });
    expect(harness.fields.messages.at(-1)).toMatchObject({ role: "assistant", content: "" });

    operations.handlePromptKeyDown(keyEvent({ key: "a" }));
    operations.startNewConversation();
    expect(harness.fields.messages).toEqual([]);

    operations.switchConversation("session-1");
    expect(harness.fields.sessionId).toBe("session-1");

    operations.clearConversation();
    expect(harness.fields.messages).toEqual([]);
  });
});
