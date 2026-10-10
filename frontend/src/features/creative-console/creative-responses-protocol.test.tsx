import { CreativeApiError, type ChatToolActivity } from "@/features/creative-console/creative-api-core";
import {
  applyResponsesStreamPayload,
  consumeResponsesFrame,
  createResponsesStreamEmitter,
  createResponsesStreamState,
  readResponseReasoning,
  readResponseText,
  readResponseTools,
  readSSEDataBlock,
  snapshotResponsesStream,
  splitSSEFrames,
  type ResponsesStreamState,
} from "@/features/creative-console/creative-responses-protocol";
import { describe, expect, it, vi, type Mock } from "vitest";

type Harness = {
  state: ResponsesStreamState;
  emit: Mock<() => void>;
  consume: (payload: Record<string, unknown>, status?: number) => void;
};

function createHarness(): Harness {
  const state = createResponsesStreamState();
  const emit = vi.fn<() => void>();
  return {
    state,
    emit,
    consume: (payload, status = 200) => applyResponsesStreamPayload(state, payload, status, emit),
  };
}

function toolSnapshot(state: ResponsesStreamState): ChatToolActivity[] {
  return snapshotResponsesStream(state).tools;
}

describe("SSE 分帧", () => {
  it("事件块只拼接 data 行，并去掉冒号后的缩进", () => {
    expect(readSSEDataBlock("event: message\ndata:   第一行\ndata:第二行\nid: 7")).toBe("第一行\n第二行");
    expect(readSSEDataBlock("event: message")).toBe("");
  });

  it("按空行切出完整事件块，未结束的尾巴单独返回", () => {
    expect(splitSSEFrames("a\n\nb\n\nc")).toEqual({ frames: ["a", "b"], remainder: "c" });
    expect(splitSSEFrames("a\r\nb")).toEqual({ frames: [], remainder: "a\r\nb" });
  });

  it("空数据与结束标记不产生回调，非法 JSON 被忽略", () => {
    const { state, emit } = createHarness();
    consumeResponsesFrame(state, "event: message", 200, emit);
    consumeResponsesFrame(state, "data: [DONE]", 200, emit);
    consumeResponsesFrame(state, "data: 42", 200, emit);
    consumeResponsesFrame(state, "data: {oops", 200, emit);
    expect(emit).not.toHaveBeenCalled();
  });

  it("合法事件块解析后写入状态并回调一次", () => {
    const { state, emit } = createHarness();
    consumeResponsesFrame(state, 'data: {"type":"response.output_text.delta","delta":"你好"}', 200, emit);
    expect(state.text).toBe("你好");
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("文本事件", () => {
  it("增量分片累加，最终文本覆盖", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.output_text.delta", delta: "一" });
    consume({ type: "response.output_text.delta", delta: "二" });
    expect(state.text).toBe("一二");

    consume({ type: "response.output_text.done", text: "完整答案" });
    expect(state.text).toBe("完整答案");
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it("delta 不是字符串时既不写状态也不回调", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.output_text.delta", delta: 5 });
    expect(state.text).toBe("");
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("推理事件", () => {
  it("两种推理分片类型都累加，done 覆盖", () => {
    const { state, consume } = createHarness();
    consume({ type: "response.reasoning_summary_text.delta", delta: "摘要" });
    consume({ type: "response.reasoning_text.delta", delta: "正文" });
    expect(state.reasoning).toBe("摘要正文");

    consume({ type: "response.reasoning_text.done", text: "最终推理" });
    expect(state.reasoning).toBe("最终推理");
  });

  it("done 缺少文本或 delta 缺少内容时保持已有推理", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.reasoning_summary_text.delta", delta: "已有" });
    emit.mockClear();

    consume({ type: "response.reasoning_summary_text.done", text: 3 });
    consume({ type: "response.reasoning_text.delta", delta: null });
    expect(state.reasoning).toBe("已有");
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("输出项事件", () => {
  it("未知事件类型不写状态也不回调", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.unknown_event" });
    consume({ type: "garbage" });
    expect(snapshotResponsesStream(state)).toEqual({ text: "", reasoning: "", tools: [] });
    expect(emit).not.toHaveBeenCalled();
  });

  it("缺少 item 或 item 不是对象时忽略该事件", () => {
    const { emit, consume } = createHarness();
    consume({ type: "response.output_item.added" });
    consume({ type: "response.output_item.added", item: "x" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("message 项在 done 时用内容文本覆盖，added 时保留流式文本", () => {
    const { state, consume } = createHarness();
    consume({ type: "response.output_text.delta", delta: "流式" });
    consume({
      type: "response.output_item.added",
      item: { type: "message", content: [{ type: "output_text", text: "未完成" }] },
    });
    expect(state.text).toBe("流式");

    consume({
      type: "response.output_item.done",
      item: { type: "message", content: [{ type: "output_text", text: "最终文本" }] },
    });
    expect(state.text).toBe("最终文本");
  });

  it("reasoning 项优先使用 summary，缺失时回退 content", () => {
    const { state, consume } = createHarness();
    consume({
      type: "response.output_item.done",
      item: { type: "reasoning", summary: [{ text: "摘要推理" }], content: [{ text: "正文推理" }] },
    });
    expect(state.reasoning).toBe("摘要推理");

    consume({ type: "response.output_item.done", item: { type: "reasoning", content: [{ text: "正文推理" }] } });
    expect(state.reasoning).toBe("正文推理");
  });

  it("工具项的 id、名称与状态按可用字段回退", () => {
    const { state, consume } = createHarness();
    consume({ type: "response.output_item.added", item: { type: "web_search_call" } });
    expect(toolSnapshot(state)).toEqual([
      { id: "web_search_call-tool", type: "web_search_call", name: "web_search", status: "in_progress", detail: "" },
    ]);

    consume({
      type: "response.output_item.done",
      item: { type: "custom_tool", id: "t1", name: "custom_tool", status: "searching", query: "查询词" },
    });
    expect(toolSnapshot(state)[1]).toMatchObject({ id: "t1", status: "in_progress", detail: "查询词" });

    consume({
      type: "response.output_item.done",
      item: { type: "function_call", call_id: "c1", status: "incomplete", input: "参数" },
    });
    expect(toolSnapshot(state)[2]).toMatchObject({ id: "c1", name: "function", status: "failed", detail: "参数" });

    consume({ type: "response.output_item.done", item: { type: "web_search", id: "t3", status: "completed" } });
    expect(toolSnapshot(state)[3]).toMatchObject({ id: "t3", name: "web_search", status: "completed" });
  });

  it("item.type 为空字符串时不写入工具项，但仍回调刷新", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.output_item.added", item: { type: "   ", id: "t1" } });
    expect(toolSnapshot(state)).toEqual([]);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("工具参数事件", () => {
  it("参数分片累加，未注册的工具先建占位项", () => {
    const { state, consume } = createHarness();
    consume({ type: "response.function_call_arguments.delta", item_id: "t1", delta: "abc" });
    consume({ type: "response.function_call_arguments.delta", item_id: "t1", delta: "def" });
    expect(toolSnapshot(state)).toEqual([
      { id: "t1", type: "function_call", name: "tool", status: "in_progress", detail: "abcdef" },
    ]);
  });

  it("done 用 arguments 或 input 覆盖，缺失时保留原有明细", () => {
    const { state, consume } = createHarness();
    consume({ type: "response.function_call_arguments.delta", call_id: "c1", delta: "增量" });
    consume({ type: "response.function_call_arguments.done", call_id: "c1", arguments: '{"a":1}' });
    expect(toolSnapshot(state)[0].detail).toBe('{"a":1}');

    consume({ type: "response.custom_tool_call_input.done", item_id: "c1", input: "自定义输入" });
    expect(toolSnapshot(state)[0].detail).toBe("自定义输入");

    consume({ type: "response.custom_tool_call_input.done", item_id: "c1" });
    expect(toolSnapshot(state)[0].detail).toBe("自定义输入");
  });

  it("缺少 id 的参数事件不写状态但仍然回调", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.function_call_arguments.delta", delta: "abc" });
    expect(toolSnapshot(state)).toEqual([]);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("信封与失败事件", () => {
  it("created 与 in_progress 不回调", () => {
    const { emit, consume } = createHarness();
    consume({ type: "response.created" });
    consume({ type: "response.in_progress" });
    expect(emit).not.toHaveBeenCalled();
  });

  it("completed 合并最终文本、推理与工具", () => {
    const { state, emit, consume } = createHarness();
    consume({
      type: "response.completed",
      response: {
        output: [
          { type: "message", content: [{ text: "最终答案" }] },
          { type: "reasoning", summary: [{ text: "最终推理" }] },
          { type: "web_search_call", id: "t1", name: "web_search", status: "completed" },
        ],
      },
    });

    expect(state.text).toBe("最终答案");
    expect(state.reasoning).toBe("最终推理");
    expect(toolSnapshot(state)[0]).toMatchObject({ id: "t1", status: "completed" });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("completed 缺少 response 字段时只回调不写状态", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.completed", response: "x" });
    expect(snapshotResponsesStream(state)).toEqual({ text: "", reasoning: "", tools: [] });
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("incomplete 先回调再抛错，错误信息带 incomplete_details.reason", () => {
    const { state, emit, consume } = createHarness();
    consume({ type: "response.output_text.delta", delta: "半截" });
    emit.mockClear();

    expect(() =>
      consume({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }, 502),
    ).toThrowError(CreativeApiError);

    expect(emit).toHaveBeenCalledTimes(1);
    expect(state.text).toBe("半截");
    try {
      consume({ type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } }, 502);
    } catch (error) {
      expect(error).toMatchObject({
        status: 502,
        code: "incomplete_response",
        message: "The response was incomplete: max_output_tokens",
      });
    }
  });

  it("incomplete 缺少原因时使用默认文案", () => {
    const { consume } = createHarness();
    expect(() => consume({ type: "response.incomplete", response: {} })).toThrowError(
      "The response ended before completion",
    );
  });

  it("failed 使用 response.error 的错误码与文案", () => {
    const { consume } = createHarness();
    try {
      consume({ type: "response.failed", response: { error: { message: "上游失败", code: "upstream_error" } } }, 500);
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toMatchObject({ status: 500, code: "upstream_error", message: "上游失败" });
    }
  });

  it("error 事件读取顶层 error 字段，缺失文案时回退默认值", () => {
    const { consume } = createHarness();
    try {
      consume({ type: "error", error: { message: "限流", code: "rate_limited" } }, 429);
      throw new Error("应当抛错");
    } catch (error) {
      expect(error).toMatchObject({ status: 429, code: "rate_limited", message: "限流" });
    }

    expect(() => consume({ type: "error" })).toThrowError("The Responses API stream failed");
  });
});

describe("最终响应解析", () => {
  it("output_text 优先且去空白，空白时回退 output 数组", () => {
    expect(readResponseText({ output_text: "  文本  " })).toBe("文本");
    expect(
      readResponseText({ output_text: "   ", output: [{ type: "message", content: [{ text: "回退文本" }] }] }),
    ).toBe("回退文本");
    expect(readResponseText("x")).toBe("");
    expect(readResponseText({ output: [{ type: "web_search_call" }, "x"] })).toBe("");
  });

  it("内容支持字符串、字符串数组与对象数组三种形态", () => {
    expect(readResponseText({ output: [{ type: "message", content: "纯文本" }] })).toBe("纯文本");
    expect(readResponseText({ output: [{ type: "message", content: ["一", "二"] }] })).toBe("一\n二");
    expect(readResponseText({ output: [{ type: "message", content: [{ content: "字段内容" }] }] })).toBe("字段内容");
    expect(
      readResponseText({
        output: [
          { type: "message", content: [7] },
          { type: "message", content: [{ text: "有效" }] },
        ],
      }),
    ).toBe("有效");
  });

  it("推理只取 reasoning 项，工具只取非消息项并标记完成", () => {
    expect(readResponseReasoning("x")).toBe("");
    expect(readResponseReasoning({ output: [{ type: "message", content: "x" }] })).toBe("");
    expect(
      readResponseReasoning({
        output: [
          { type: "reasoning", content: [{ text: "推理一" }] },
          { type: "reasoning", summary: [{ text: "推理二" }] },
        ],
      }),
    ).toBe("推理一\n推理二");

    expect(readResponseTools("x")).toEqual([]);
    expect(
      readResponseTools({
        output: [
          { type: "message", content: "x" },
          { type: "web_search_call", id: "t1", name: "web_search" },
          { type: "  " },
        ],
      }),
    ).toEqual([{ id: "t1", type: "web_search_call", name: "web_search", status: "completed", detail: "" }]);
  });
});

describe("流式状态与回调", () => {
  it("快照返回状态副本，回调可选", () => {
    const state = createResponsesStreamState();
    state.text = "文本";
    expect(snapshotResponsesStream(state)).toEqual({ text: "文本", reasoning: "", tools: [] });

    const silent = createResponsesStreamEmitter(state);
    expect(() => silent()).not.toThrow();

    const onUpdate = vi.fn();
    createResponsesStreamEmitter(state, onUpdate)();
    expect(onUpdate).toHaveBeenCalledWith({ text: "文本", reasoning: "", tools: [] });
  });
});
