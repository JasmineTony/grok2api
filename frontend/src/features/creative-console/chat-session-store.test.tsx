import {
  chatHistoryStorageKey,
  loadChatSessions,
  parseChatSession,
  parseConversationMessage,
  persistChatSessions,
} from "@/features/creative-console/chat-session-store";
import type { ChatSession } from "@/features/creative-console/chat-session-model";
import { afterEach, describe, expect, it, vi } from "vitest";

/** 体积预算为 4MiB 且按 UTF-16 双字节估算，因此超过 2Mi 字符的单个会话必然超限。 */
const oversizeContent = "x".repeat(2_200_000);

function createSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "标题",
    createdAt: 1_000,
    updatedAt: 2_000,
    model: "grok-4",
    promptCacheKey: "cache-1",
    reasoningEffort: "auto",
    webSearch: false,
    xSearch: false,
    messages: [{ id: "message-1", role: "user", content: "你好" }],
    ...overrides,
  };
}

function writeRaw(scope: string, value: string): void {
  window.localStorage.setItem(chatHistoryStorageKey(scope), value);
}

/** jsdom 的 localStorage 是代理对象，只有替换 window 上的取值器才能稳定模拟存储故障。 */
function stubStorage(overrides: { setItem?: Storage["setItem"]; removeItem?: Storage["removeItem"] } = {}): Storage {
  const storage = {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
    ...overrides,
  } as unknown as Storage;
  vi.spyOn(window, "localStorage", "get").mockReturnValue(storage);
  return storage;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("聊天历史存储键", () => {
  it("作用域做 URL 编码，避免特殊字符串到其它键", () => {
    expect(chatHistoryStorageKey("a b/中文")).toBe("grok2api:creative-console:chat-history:a%20b%2F%E4%B8%AD%E6%96%87");
  });
});

describe("聊天历史读取", () => {
  it("没有浏览器存储环境时读取为空、写入原样返回", () => {
    const sessions = [createSession()];
    vi.stubGlobal("window", undefined);
    expect(loadChatSessions("scope-1")).toEqual([]);
    expect(persistChatSessions("scope-1", sessions)).toBe(sessions);
    vi.unstubAllGlobals();
  });

  it("非法 JSON 或非数组内容按空历史处理，不抛出", () => {
    writeRaw("scope-1", "{oops");
    expect(loadChatSessions("scope-1")).toEqual([]);
    writeRaw("scope-1", JSON.stringify({ id: "session-1" }));
    expect(loadChatSessions("scope-1")).toEqual([]);
  });

  it("跳过结构非法的条目，按 updatedAt 倒序返回并最多保留 50 个会话", () => {
    const sessions = Array.from({ length: 51 }, (_, index) =>
      createSession({
        id: `session-${index}`,
        updatedAt: index + 1,
        messages: [{ id: `message-${index}`, role: "user", content: `提问${index}` }],
      }),
    );
    writeRaw("scope-1", JSON.stringify([...sessions, { id: "no-messages", updatedAt: 99 }, "not-a-record"]));

    const loaded = loadChatSessions("scope-1");
    expect(loaded).toHaveLength(50);
    expect(loaded[0].id).toBe("session-50");
    expect(loaded.at(-1)?.id).toBe("session-1");
  });

  it("历史会话的标题、时间、模型与开关字段缺失或非法时按协议回退", () => {
    writeRaw(
      "scope-1",
      JSON.stringify([
        {
          id: "session-1",
          title: "   ",
          createdAt: 0,
          updatedAt: -1,
          model: 7,
          promptCacheKey: "",
          reasoningEffort: "super",
          webSearch: "true",
          xSearch: true,
          messages: [{ id: "", role: "user", content: "  第一句   提问 " }],
        },
      ]),
    );

    const [session] = loadChatSessions("scope-1");
    expect(session.title).toBe("第一句 提问");
    expect(session.model).toBe("");
    expect(session.reasoningEffort).toBe("auto");
    expect(session.webSearch).toBe(false);
    expect(session.xSearch).toBe(true);
    expect(session.promptCacheKey).toMatch(/^creative-console-/);
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBe(session.createdAt);
    expect(session.messages[0].id).not.toBe("");
  });

  it("完整字段的历史会话按原值保留", () => {
    writeRaw("scope-1", JSON.stringify([createSession({ xSearch: true, reasoningEffort: "high" })]));
    const [session] = loadChatSessions("scope-1");
    expect(session).toMatchObject({
      id: "session-1",
      title: "标题",
      createdAt: 1_000,
      updatedAt: 2_000,
      model: "grok-4",
      promptCacheKey: "cache-1",
      reasoningEffort: "high",
      xSearch: true,
    });
  });
});

describe("聊天历史写入", () => {
  it("写入后可以读回，超过 50 个会话只保留输入顺序的前 50 个", () => {
    const sessions = Array.from({ length: 52 }, (_, index) =>
      createSession({
        id: `session-${index}`,
        updatedAt: index + 1,
        messages: [{ id: `message-${index}`, role: "user", content: `提问${index}` }],
      }),
    );
    const retained = persistChatSessions("scope-1", sessions);

    expect(retained.map((session) => session.id)).toEqual(sessions.slice(0, 50).map((session) => session.id));
    expect(JSON.parse(window.localStorage.getItem(chatHistoryStorageKey("scope-1")) ?? "[]")).toHaveLength(50);
    expect(loadChatSessions("scope-1")).toHaveLength(50);
  });

  it("单个会话超出体积预算时逐个丢弃，最终清空该作用域而不是写入超限数据", () => {
    const storage = stubStorage();
    const retained = persistChatSessions("scope-1", [
      createSession({ id: "huge", messages: [{ id: "message-1", role: "user", content: oversizeContent }] }),
    ]);

    expect(retained).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(chatHistoryStorageKey("scope-1"));
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("体积超限时丢弃末尾会话后写入剩余部分，读数与写入一致", () => {
    const retained = persistChatSessions("scope-1", [
      createSession({ id: "small" }),
      createSession({ id: "huge", messages: [{ id: "message-1", role: "user", content: oversizeContent }] }),
    ]);

    expect(retained.map((session) => session.id)).toEqual(["small"]);
    expect(loadChatSessions("scope-1").map((session) => session.id)).toEqual(["small"]);
  });

  it("存储写入与清理都失败时返回空列表，不把未落盘的会话当成已保存", () => {
    const storage = stubStorage({
      setItem: vi.fn(() => {
        throw new Error("quota exceeded");
      }),
      removeItem: vi.fn(() => {
        throw new Error("storage unavailable");
      }),
    });

    expect(persistChatSessions("scope-1", [createSession()])).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(chatHistoryStorageKey("scope-1"));
  });
});

describe("会话与消息解析", () => {
  it("拒绝非对象、缺 id、缺 messages 与没有有效消息的历史条目", () => {
    expect(parseChatSession(null)).toEqual([]);
    expect(parseChatSession("session")).toEqual([]);
    expect(parseChatSession([])).toEqual([]);
    expect(parseChatSession({ messages: [] })).toEqual([]);
    expect(parseChatSession({ id: "session-1", messages: "x" })).toEqual([]);
    expect(parseChatSession({ id: "session-1", messages: [{ role: "system", content: "x" }] })).toEqual([]);
  });

  it("拒绝角色非法、缺少正文的消息，并保留推理内容", () => {
    expect(parseConversationMessage(null)).toEqual([]);
    expect(parseConversationMessage({ role: "system", content: "x" })).toEqual([]);
    expect(parseConversationMessage({ role: "user" })).toEqual([]);

    const [message] = parseConversationMessage({ id: "m1", role: "assistant", content: "答案", reasoning: "推理" });
    expect(message.reasoning).toBe("推理");
    expect(message.tools).toBeUndefined();
  });

  it("工具明细丢弃非法条目、把非法状态归为 completed，并保留合法状态", () => {
    const [message] = parseConversationMessage({
      id: "m1",
      role: "assistant",
      content: "答案",
      reasoning: 5,
      tools: [
        { id: "t1", type: "web_search_call", name: "web_search", status: "in_progress", detail: "查询" },
        { id: "t2", type: "function_call", name: "fn", status: "unknown", detail: 9 },
        { id: "t3", name: "fn" },
        42,
      ],
    });

    expect(message.reasoning).toBeUndefined();
    expect(message.tools).toEqual([
      { id: "t1", type: "web_search_call", name: "web_search", status: "in_progress", detail: "查询" },
      { id: "t2", type: "function_call", name: "fn", status: "completed", detail: "" },
    ]);
  });

  it("非数组的工具字段视为没有工具，failed 状态原样保留", () => {
    expect(parseConversationMessage({ id: "m1", role: "user", content: "x", tools: "x" })[0].tools).toBeUndefined();
    expect(
      parseConversationMessage({
        id: "m1",
        role: "user",
        content: "x",
        tools: [{ id: "t1", type: "function_call", name: "fn", status: "failed" }],
      })[0].tools,
    ).toEqual([{ id: "t1", type: "function_call", name: "fn", status: "failed", detail: "" }]);
  });
});
