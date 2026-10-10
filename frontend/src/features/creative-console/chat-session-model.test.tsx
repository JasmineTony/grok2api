import type { ModelRouteDTO } from "@/entities/model/types";
import type { ChatStreamSnapshot } from "@/features/creative-console/creative-api-core";
import {
  applyAssistantSnapshot,
  applyStoppedAssistant,
  buildChatSession,
  chatHistoryMaxSessions,
  createBlankChatSession,
  createChatSessionTitle,
  createCreativeCacheKey,
  createCreativeMessageId,
  currentTimestamp,
  formatChatSessionTime,
  hasChatStreamContent,
  isAbortError,
  isFixedReasoningConsoleModel,
  isUsableKey,
  keepOrDropAssistant,
  toRequestMessages,
  upsertChatSession,
  validDuration,
  type ChatSession,
  type ConversationMessage,
} from "@/features/creative-console/chat-session-model";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";
import { afterEach, describe, expect, it, vi } from "vitest";

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return { id: "m1", role: "assistant", content: "正文", ...overrides };
}

function snapshot(overrides: Partial<ChatStreamSnapshot> = {}): ChatStreamSnapshot {
  return { text: "", reasoning: "", tools: [], ...overrides };
}

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "标题",
    createdAt: 1,
    updatedAt: 2,
    model: "grok-4",
    promptCacheKey: "cache",
    reasoningEffort: "auto",
    webSearch: false,
    xSearch: false,
    messages: [],
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("创作台标识生成", () => {
  it("有 crypto.randomUUID 时直接使用，没有时回退到时间戳加序号且不重复", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const first = createCreativeMessageId();
    const second = createCreativeMessageId();
    const third = createCreativeMessageId();
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);

    vi.stubGlobal("crypto", {});
    const fallbackFirst = createCreativeMessageId();
    const fallbackSecond = createCreativeMessageId();
    expect(fallbackFirst).toMatch(/^creative-[0-9a-z]+-[0-9a-z]+$/);
    expect(fallbackSecond).not.toBe(fallbackFirst);
    expect(createCreativeCacheKey()).toMatch(/^creative-console-creative-/);
  });

  it("缓存键带创作台前缀，时间戳取当前时间", () => {
    expect(createCreativeCacheKey()).toMatch(/^creative-console-/);
    vi.spyOn(Date, "now").mockReturnValue(123);
    expect(currentTimestamp()).toBe(123);
  });
});

describe("会话构造", () => {
  it("空白会话带默认推理开关与独立缓存键", () => {
    vi.spyOn(Date, "now").mockReturnValue(5_000);
    const blank = createBlankChatSession("grok-4");
    expect(blank).toMatchObject({
      title: "",
      createdAt: 5_000,
      updatedAt: 5_000,
      model: "grok-4",
      reasoningEffort: "auto",
      webSearch: false,
      xSearch: false,
      messages: [],
    });
    expect(blank.id).not.toBe("");
    expect(blank.promptCacheKey).toMatch(/^creative-console-/);
  });

  it("快照会话用首条用户提问作标题，更新时间取当前时间", () => {
    vi.spyOn(Date, "now").mockReturnValue(9_000);
    const built = buildChatSession({
      id: "session-1",
      createdAt: 1,
      model: "grok-4",
      promptCacheKey: "cache",
      reasoningEffort: "high",
      webSearch: true,
      xSearch: true,
      messages: [message({ id: "u1", role: "user", content: "第一句提问" })],
    });
    expect(built).toMatchObject({
      id: "session-1",
      title: "第一句提问",
      createdAt: 1,
      updatedAt: 9_000,
      reasoningEffort: "high",
      webSearch: true,
      xSearch: true,
    });
  });

  it("标题压缩空白、超过 48 字截断，没有用户消息时回退为 Conversation", () => {
    expect(createChatSessionTitle([message({ role: "user", content: "  多   空格\t提问 " })])).toBe("多 空格 提问");
    expect(createChatSessionTitle([message({ role: "user", content: "字".repeat(49) })])).toBe(`${"字".repeat(48)}…`);
    expect(createChatSessionTitle([message({ role: "assistant" })])).toBe("Conversation");
    expect(createChatSessionTitle([message({ role: "user", content: "   " })])).toBe("Conversation");
  });

  it("同 id 会话被替换并置于最前，新增会话超过上限时丢掉最旧的", () => {
    const existing = Array.from({ length: chatHistoryMaxSessions }, (_, index) =>
      session({ id: `session-${index}`, updatedAt: index + 1 }),
    );

    const next = upsertChatSession(existing, session({ id: "session-10", updatedAt: 10_000 }));
    expect(next).toHaveLength(chatHistoryMaxSessions);
    expect(next[0].id).toBe("session-10");
    expect(next.filter((item) => item.id === "session-10")).toHaveLength(1);

    const appended = upsertChatSession(existing, session({ id: "session-new", updatedAt: 10_000 }));
    expect(appended).toHaveLength(chatHistoryMaxSessions);
    expect(appended[0].id).toBe("session-new");
    expect(appended.some((item) => item.id === "session-0")).toBe(false);
    expect(appended.at(-1)?.id).toBe("session-1");
  });
});

describe("请求消息映射", () => {
  it("只保留有内容的用户与助手消息，并去掉本地字段", () => {
    expect(
      toRequestMessages([
        message({ id: "u1", role: "user", content: "  问题  " }),
        message({ id: "a1", role: "assistant", content: "答案", reasoning: "推理" }),
        message({ id: "a2", role: "assistant", content: "   " }),
      ]),
    ).toEqual([
      { role: "user", content: "  问题  " },
      { role: "assistant", content: "答案" },
    ]);
  });
});

describe("流式快照合并", () => {
  it("只更新目标消息，其余消息保持原引用", () => {
    const untouched = message({ id: "u1", role: "user" });
    const next = applyAssistantSnapshot(
      [untouched, message({ id: "a1" })],
      "a1",
      snapshot({ text: "增量", reasoning: "推理", tools: [] }),
    );
    expect(next[0]).toBe(untouched);
    expect(next[1]).toMatchObject({ content: "增量", reasoning: "推理" });
  });
  it("真实失败保留部分内容，中止或空结果丢弃占位消息", () => {
    const aborted = keepOrDropAssistant([message({ id: "a1" })], "a1", snapshot({ text: "半截" }), true);
    expect(aborted).toEqual([]);

    const empty = keepOrDropAssistant([message({ id: "a1" })], "a1", snapshot(), false);
    expect(empty).toEqual([]);

    const failed = keepOrDropAssistant([message({ id: "a1" })], "a1", snapshot({ text: "半截" }), false);
    expect(failed[0]).toMatchObject({ id: "a1", content: "半截" });

    const replaced = keepOrDropAssistant([message({ id: "a1" })], "a2", snapshot({ text: "其它" }), false);
    expect(replaced[0].content).toBe("正文");
  });

  it("停止生成时用已收到内容覆盖，空占位被移除但保留推理与工具的消息", () => {
    const stopped = applyStoppedAssistant(
      [message({ id: "a1" })],
      "a1",
      snapshot({ text: "已收到", reasoning: "推理" }),
    );
    expect(stopped[0]).toMatchObject({ content: "已收到", reasoning: "推理" });

    const removed = applyStoppedAssistant([message({ id: "a1", content: "" })], "a1", snapshot());
    expect(removed).toEqual([]);

    const kept = applyStoppedAssistant(
      [message({ id: "a1", content: "" })],
      "a1",
      snapshot({ tools: [{ id: "t1", type: "web_search_call", name: "web_search", status: "completed", detail: "" }] }),
    );
    expect(kept).toHaveLength(1);

    const otherOnly = applyStoppedAssistant([message({ id: "a1", content: "" })], "a2", snapshot());
    expect(otherOnly).toHaveLength(1);
  });

  it("内容判定覆盖正文、推理与工具三种来源", () => {
    expect(hasChatStreamContent(snapshot())).toBe(false);
    expect(hasChatStreamContent(snapshot({ text: " " }))).toBe(false);
    expect(hasChatStreamContent(snapshot({ reasoning: "推理" }))).toBe(true);
    expect(
      hasChatStreamContent(
        snapshot({ tools: [{ id: "t1", type: "function_call", name: "fn", status: "completed", detail: "" }] }),
      ),
    ).toBe(true);
  });
});

describe("通用校验", () => {
  it("识别中止错误，其它错误与普通值不算中止", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isAbortError(new Error("网络中断"))).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
  });

  it("密钥可用性看启用状态与过期时间", () => {
    const base = { expiresAt: undefined } as unknown as ClientKeyDTO;
    expect(isUsableKey({ ...base, enabled: false })).toBe(false);
    expect(isUsableKey({ ...base, enabled: true })).toBe(true);
    expect(isUsableKey({ ...base, enabled: true, expiresAt: new Date(Date.now() + 60_000).toISOString() })).toBe(true);
    expect(isUsableKey({ ...base, enabled: true, expiresAt: new Date(Date.now() - 60_000).toISOString() })).toBe(false);
  });

  it("时长只接受 1..15 的整数", () => {
    expect(validDuration("1")).toBe(true);
    expect(validDuration("15")).toBe(true);
    expect(validDuration("0")).toBe(false);
    expect(validDuration("16")).toBe(false);
    expect(validDuration("1.5")).toBe(false);
    expect(validDuration("abc")).toBe(false);
  });

  it("只有 console 的固定推理模型被识别为固定推理", () => {
    const fixed = {
      id: "m1",
      publicId: "grok-4.20-0309-reasoning",
      provider: "grok_console",
      upstreamModel: "grok-4.20-0309-reasoning",
    } as ModelRouteDTO;
    expect(isFixedReasoningConsoleModel(fixed)).toBe(true);
    expect(isFixedReasoningConsoleModel({ ...fixed, upstreamModel: "grok-4" })).toBe(false);
    expect(isFixedReasoningConsoleModel({ ...fixed, provider: "grok_web" })).toBe(false);
    expect(isFixedReasoningConsoleModel(undefined)).toBe(false);
  });

  it("会话时间按语言环境格式化", () => {
    const timestamp = Date.UTC(2026, 0, 2, 3, 4);
    expect(formatChatSessionTime(timestamp, "zh")).toContain("2");
    expect(formatChatSessionTime(timestamp, "en-US")).toMatch(/Jan/);
  });
});
