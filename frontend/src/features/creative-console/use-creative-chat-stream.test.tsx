import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatStreamSnapshot } from "@/features/creative-console/creative-console-api";
import { useCreativeChatStream } from "@/features/creative-console/use-creative-chat-stream";

const apiMock = vi.hoisted(() => ({ createChatResponse: vi.fn() }));

vi.mock("@/features/creative-console/creative-console-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/creative-console/creative-console-api")>()),
  createChatResponse: apiMock.createChatResponse,
}));

type Deferred = {
  resolve: (snapshot: ChatStreamSnapshot) => void;
  reject: (error: unknown) => void;
};

function deferred(): Deferred {
  let resolve!: (snapshot: ChatStreamSnapshot) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ChatStreamSnapshot>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  void promise.catch(() => undefined);
  apiMock.createChatResponse.mockReturnValueOnce(promise);
  return { resolve, reject };
}

const frames: Array<() => void> = [];
let frameId = 0;

function runFrames(): void {
  while (frames.length > 0) {
    const frame = frames.shift();
    frame?.();
  }
}

function snapshot(text: string): ChatStreamSnapshot {
  return { text, reasoning: "", tools: [] };
}

function request(assistantMessageId = "a1") {
  return {
    messages: [{ role: "user" as const, content: "hi" }],
    promptCacheKey: "cache",
    reasoningEffort: "auto" as const,
    webSearch: false,
    xSearch: false,
    assistantMessageId,
    apiKey: "k",
    model: "m",
  };
}

function createHandlers() {
  return {
    onSnapshot: vi.fn(),
    onSuccess: vi.fn(),
    onFailure: vi.fn(),
    onStop: vi.fn(),
  };
}

function emitUpdate(index = 0, text = "分片"): void {
  const options = apiMock.createChatResponse.mock.calls[index][0] as {
    onUpdate?: (value: ChatStreamSnapshot) => void;
  };
  options.onUpdate?.(snapshot(text));
}

beforeEach(() => {
  frames.length = 0;
  frameId = 0;
  apiMock.createChatResponse.mockReset();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frameId += 1;
    frames.push(() => callback(frameId));
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    const index = frames.findIndex((_, position) => position === id - 1);
    if (index >= 0) frames.splice(index, 1);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useCreativeChatStream 生命周期", () => {
  it("同一帧内的多个分片只触发一次快照回调", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));

    act(() => result.current.start(request()));
    act(() => {
      emitUpdate(0, "一");
      emitUpdate(0, "一二");
      emitUpdate(0, "一二三");
    });

    expect(handlers.onSnapshot).not.toHaveBeenCalled();
    act(() => runFrames());
    expect(handlers.onSnapshot).toHaveBeenCalledTimes(1);
    expect(handlers.onSnapshot).toHaveBeenCalledWith("a1", snapshot("一二三"));

    act(() => pending.resolve(snapshot("一二三")));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(handlers.onSuccess).toHaveBeenCalledWith("a1", snapshot("一二三"));
  });

  it("成功后再到达的分片不再写入状态", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request()));
    act(() => pending.resolve(snapshot("完成")));
    await waitFor(() => expect(result.current.isPending).toBe(false));

    act(() => {
      emitUpdate(0, "迟到");
      runFrames();
    });
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
  });

  it("真实失败保留已收到的部分内容并展示错误文案", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request()));
    act(() => {
      emitUpdate(0, "半截");
      runFrames();
    });

    act(() => pending.reject(new Error("网络中断")));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(handlers.onFailure).toHaveBeenCalledWith("a1", snapshot("半截"), false);
    expect(result.current.errorMessage).toBe("网络中断");
  });

  it("中止请求时丢弃占位消息且不展示错误", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request()));
    const signal = (apiMock.createChatResponse.mock.calls[0][0] as { signal?: AbortSignal }).signal;
    expect(signal?.aborted).toBe(false);

    act(() => result.current.cancel());
    expect(signal?.aborted).toBe(true);
    act(() => pending.reject(new DOMException("aborted", "AbortError")));
    await waitFor(() => expect(handlers.onFailure).not.toHaveBeenCalled());
    expect(result.current.errorMessage).toBe("");

    act(() => result.current.reset());
    expect(result.current.isPending).toBe(false);
  });

  it("取消后旧请求的结果与帧回调都不再写入状态", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request()));
    act(() => {
      emitUpdate(0, "取消前");
      vi.stubGlobal("cancelAnimationFrame", () => undefined);
    });

    act(() => result.current.cancel());
    act(() => runFrames());
    expect(handlers.onSnapshot).not.toHaveBeenCalled();

    act(() => pending.resolve(snapshot("过期")));
    await Promise.resolve();
    expect(handlers.onSuccess).not.toHaveBeenCalled();
  });

  it("stop 用取消前的快照回调，并结束 pending", async () => {
    const handlers = createHandlers();
    deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request("a9")));
    act(() => {
      emitUpdate(0, "已收到");
      runFrames();
    });

    act(() => result.current.stop());
    expect(handlers.onStop).toHaveBeenCalledWith("a9", snapshot("已收到"));
    expect(result.current.isPending).toBe(false);
    expect(result.current.errorMessage).toBe("");

    act(() => result.current.stop());
    expect(handlers.onStop).toHaveBeenCalledTimes(1);
  });

  it("卸载时中止在途请求，不再回调", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result, unmount } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request()));
    unmount();

    act(() => pending.resolve(snapshot("卸载后")));
    await Promise.resolve();
    expect(handlers.onSuccess).not.toHaveBeenCalled();
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
  });

  it("StrictMode 下同一请求只发起一次", async () => {
    const handlers = createHandlers();
    deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers), { wrapper: StrictMode });
    act(() => result.current.start(request()));
    expect(apiMock.createChatResponse).toHaveBeenCalledTimes(1);
  });

  it("reset 清空错误并释放请求，迟到的失败不再回写", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request("a1")));
    expect(result.current.isPending).toBe(true);

    act(() => result.current.reset());
    expect(result.current.errorMessage).toBe("");
    expect(result.current.isPending).toBe(false);

    act(() => pending.reject(new Error("迟到失败")));
    await waitFor(() => expect(handlers.onFailure).not.toHaveBeenCalled());
    expect(result.current.errorMessage).toBe("");
  });

  it("成功时空闲的待刷新帧被取消，不会重复回写快照", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request("a1")));
    act(() => emitUpdate(0, "最后一帧"));

    act(() => pending.resolve(snapshot("最终")));
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(handlers.onSuccess).toHaveBeenCalledWith("a1", snapshot("最终"));
    act(() => runFrames());
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
  });

  it("请求自身以 AbortError 结束时按中止处理，不展示错误文案", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request("a1")));
    act(() => {
      emitUpdate(0, "已收到");
      runFrames();
    });

    act(() => pending.reject(new DOMException("aborted", "AbortError")));
    await waitFor(() => expect(result.current.isPending).toBe(false));

    expect(handlers.onFailure).toHaveBeenCalledWith("a1", snapshot("已收到"), true);
    expect(result.current.errorMessage).toBe("");
  });
});

describe("回调帧清理", () => {
  it("请求失败时取消尚未执行的刷新帧", async () => {
    const handlers = createHandlers();
    const pending = deferred();
    const { result } = renderHook(() => useCreativeChatStream(handlers));
    act(() => result.current.start(request("a1")));
    act(() => emitUpdate(0, "最后一帧"));

    act(() => pending.reject(new Error("网络中断")));
    await waitFor(() => expect(result.current.isPending).toBe(false));

    act(() => runFrames());
    expect(handlers.onSnapshot).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe("网络中断");
  });
});
