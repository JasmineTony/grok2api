import { afterEach, describe, expect, it, vi } from "vitest";

import { CreativeApiError, resolveMediaURL } from "@/features/creative-console/creative-api-core";
import { createChatResponse, streamResponses } from "@/features/creative-console/creative-chat-api";
import { generateImage } from "@/features/creative-console/creative-image-api";
import { createVideo, editVideo, extendVideo, getVideo } from "@/features/creative-console/creative-video-api";
import { listVoices, synthesizeSpeech, transcribeSpeech } from "@/features/creative-console/creative-voice-api";
import {
  consumeResponsesFrame,
  createResponsesStreamState,
  readSSEDataBlock,
  snapshotResponsesStream,
  splitSSEFrames,
} from "@/features/creative-console/creative-responses-protocol";

type StreamProbe = { cancelled: boolean };

function sseResponse(chunks: string[], probe?: StreamProbe): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
    cancel() {
      if (probe) probe.cancelled = true;
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function jsonResponse(payload: unknown, status = 200, statusText?: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function requestBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("responses 流式协议", () => {
  it("按空行分帧并保留未完成的分片尾巴", () => {
    const first = splitSSEFrames('data: {"a":1}\n\ndata: {"b"');
    expect(first.frames).toEqual(['data: {"a":1}']);
    expect(first.remainder).toBe('data: {"b"');

    const second = splitSSEFrames(`${first.remainder}:2}\n\n`);
    expect(second.frames).toEqual(['data: {"b":2}']);
    expect(second.remainder).toBe("");
  });

  it("拼接多行 data 并忽略 [DONE]", () => {
    expect(readSSEDataBlock("data: a\ndata: b")).toBe("a\nb");
    expect(readSSEDataBlock("event: ping")).toBe("");
  });

  it("文本、推理与工具明细按事件顺序累积，非法事件不影响状态", () => {
    const state = createResponsesStreamState();
    const emit = vi.fn();
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "你" })}`,
      200,
      emit,
    );
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "好" })}`,
      200,
      emit,
    );
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({ type: "response.reasoning_text.delta", delta: "想" })}`,
      200,
      emit,
    );
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({ type: "response.output_item.added", item: { type: "web_search_call", id: "t1" } })}`,
      200,
      emit,
    );
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({ type: "response.function_call_arguments.delta", item_id: "t1", delta: "q" })}`,
      200,
      emit,
    );
    consumeResponsesFrame(state, "data: [DONE]", 200, emit);
    consumeResponsesFrame(state, "data: not-json", 200, emit);
    consumeResponsesFrame(state, "", 200, emit);

    const snapshot = snapshotResponsesStream(state);
    expect(snapshot.text).toBe("你好");
    expect(snapshot.reasoning).toBe("想");
    expect(snapshot.tools).toEqual([
      { id: "t1", type: "web_search_call", name: "web_search", status: "in_progress", detail: "q" },
    ]);
    expect(emit).toHaveBeenCalledTimes(5);
  });

  it("output_item.done 的消息正文覆盖累积文本，reasoning 与工具按 id 合并", () => {
    const state = createResponsesStreamState();
    const emit = vi.fn();
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "旧" })}`,
      200,
      emit,
    );
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({
        type: "response.output_item.done",
        item: { type: "message", content: [{ type: "output_text", text: "最终" }] },
      })}`,
      200,
      emit,
    );
    consumeResponsesFrame(
      state,
      `data: ${JSON.stringify({
        type: "response.output_item.done",
        item: { type: "reasoning", summary: [{ type: "summary_text", text: "推理结论" }] },
      })}`,
      200,
      emit,
    );
    consumeResponsesFrame(state, `data: ${JSON.stringify({ type: "response.output_item.added" })}`, 200, emit);

    const snapshot = snapshotResponsesStream(state);
    expect(snapshot.text).toBe("最终");
    expect(snapshot.reasoning).toBe("推理结论");
    expect(emit).toHaveBeenCalledTimes(3);
  });

  it("response.failed 与 error 事件抛出带错误码的协议错误", () => {
    const state = createResponsesStreamState();
    const failure = ((): unknown => {
      try {
        consumeResponsesFrame(
          state,
          `data: ${JSON.stringify({ type: "response.failed", response: { error: { code: "boom", message: "失败" } } })}`,
          200,
          vi.fn(),
        );
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toMatchObject({ code: "boom", message: "失败" });
    expect(() =>
      consumeResponsesFrame(state, `data: ${JSON.stringify({ type: "error", message: "上游断开" })}`, 200, vi.fn()),
    ).toThrowError("上游断开");
  });

  it("response.incomplete 先发出已到达的内容再抛错", () => {
    const state = createResponsesStreamState();
    const emit = vi.fn();
    expect(() =>
      consumeResponsesFrame(
        state,
        `data: ${JSON.stringify({
          type: "response.incomplete",
          response: { output_text: "半截", incomplete_details: { reason: "max_output_tokens" } },
        })}`,
        200,
        emit,
      ),
    ).toThrowError(/max_output_tokens/);
    expect(snapshotResponsesStream(state).text).toBe("半截");
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe("streamResponses 请求与结束语义", () => {
  it("createChatResponse 按 reasoning / 工具开关构造请求体", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toBeInstanceOf(Headers);
      return sseResponse([frame({ type: "response.output_text.delta", delta: "x" })]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const body = requestBody(
      await createChatResponse({
        apiKey: "k",
        model: "grok-4",
        messages: [{ role: "user", content: "hi" }],
        promptCacheKey: "cache-1",
        reasoningEffort: "high",
        webSearch: true,
        xSearch: true,
      }).then(() => fetchMock.mock.calls[0]),
    );
    expect(body).toMatchObject({
      model: "grok-4",
      prompt_cache_key: "cache-1",
      reasoning: { effort: "high", summary: "auto" },
      tools: [{ type: "web_search" }, { type: "x_search" }],
      stream: true,
      store: false,
    });
  });

  it("reasoning=none 与默认 auto 使用不同的 reasoning 字段", async () => {
    const fetchMock = vi.fn(async () => sseResponse([frame({ type: "response.output_text.delta", delta: "x" })]));
    vi.stubGlobal("fetch", fetchMock);
    const base = {
      apiKey: "k",
      model: "grok-4",
      messages: [],
      webSearch: false,
      xSearch: false,
    };
    await createChatResponse({ ...base, reasoningEffort: "none" });
    expect(requestBody(fetchMock.mock.calls[0]).reasoning).toEqual({ effort: "none" });
    await createChatResponse({ ...base, reasoningEffort: "auto" });
    expect(requestBody(fetchMock.mock.calls[1]).reasoning).toEqual({ summary: "auto" });
  });

  it("分片跨 chunk 仍能重组，并统一 \\r\\n", async () => {
    const payload = frame({ type: "response.output_text.delta", delta: "重组成功" });
    const head = payload.slice(0, 12);
    const tail = payload.slice(12);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        sseResponse([`data: {"type":"response.output_text.delta","delta":"拼接"}\r\n\r\n`, head, tail]),
      ),
    );

    const updates: string[] = [];
    const result = await streamResponses("k", { anything: true }, (snapshot) => updates.push(snapshot.text));
    expect(result.text).toBe("拼接重组成功");
    expect(updates).toEqual(["拼接", "拼接重组成功"]);
  });

  it("非 SSE 响应按 JSON 兜底解析，空输出报 invalid_response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ output_text: "  直接返回  ", output: [{ type: "reasoning", summary: "想" }] })),
    );
    const result = await streamResponses("k", {});
    expect(result).toEqual({
      text: "直接返回",
      reasoning: "想",
      tools: [],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );
    await expect(streamResponses("k", {})).rejects.toThrowError("did not return any displayable output");
  });

  it("HTTP 失败用响应里的 code/message，非 JSON 时退回状态文本", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { code: "rate_limited", message: "太频繁" } }, 429)),
    );
    await expect(streamResponses("k", {})).rejects.toMatchObject({ status: 429, code: "rate_limited" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>bad</html>", { status: 502, statusText: "Bad Gateway" })),
    );
    const error = await streamResponses("k", {}).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(CreativeApiError);
    expect((error as CreativeApiError).message).toBe("<html>bad</html>");
  });

  it("错误事件抛出前主动关闭读取器，避免连接悬挂", async () => {
    const probe: StreamProbe = { cancelled: false };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(frame({ type: "response.failed", message: "炸了" })));
          },
          cancel() {
            probe.cancelled = true;
          },
        });
        return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }),
    );

    await expect(streamResponses("k", {})).rejects.toThrowError("炸了");
    expect(probe.cancelled).toBe(true);
  });

  it("中止时以 AbortError 结束，且不再继续回调", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        let step = 0;
        const body = new ReadableStream<Uint8Array>({
          async pull(streamController) {
            if (step === 0) {
              step = 1;
              streamController.enqueue(encoder.encode(frame({ type: "response.output_text.delta", delta: "第一段" })));
              return;
            }
            await new Promise<void>((resolve) => {
              init?.signal?.addEventListener("abort", () => resolve(), { once: true });
            });
            streamController.error(new DOMException("aborted", "AbortError"));
          },
        });
        return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
      }),
    );

    const updates: string[] = [];
    const pending = streamResponses("k", {}, (snapshot) => updates.push(snapshot.text), controller.signal);
    await vi.waitFor(() => expect(updates).toEqual(["第一段"]));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(updates).toEqual(["第一段"]);
  });
});

describe("图像、视频与语音协议", () => {
  it("图像生成请求体与媒体地址解析保持同源相对路径", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: [{ url: "https://proxy.local/v1/media/images/a.png", revised_prompt: "改过" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const images = await generateImage({
      apiKey: "k",
      model: "grok-imagine-image-2.0",
      prompt: "一只猫",
      count: 2,
      aspectRatio: "16:9",
      resolution: "2k",
      quality: "low",
    });
    expect(images).toEqual([{ url: "/v1/media/images/a.png", revisedPrompt: "改过" }]);
    expect(requestBody(fetchMock.mock.calls[0])).toEqual({
      model: "grok-imagine-image-2.0",
      prompt: "一只猫",
      n: 2,
      aspect_ratio: "16:9",
      resolution: "2k",
      quality: "low",
      response_format: "url",
      stream: false,
    });
  });

  it("图像空结果与 b64 兜底", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [] })),
    );
    await expect(
      generateImage({ apiKey: "k", model: "m", prompt: "p", count: 1, aspectRatio: "1:1", resolution: "1k" }),
    ).rejects.toMatchObject({ code: "invalid_response" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ data: [{ b64_json: "AAA" }] })),
    );
    const images = await generateImage({
      apiKey: "k",
      model: "m",
      prompt: "p",
      count: 1,
      aspectRatio: "1:1",
      resolution: "1k",
    });
    expect(images[0].url).toBe("data:image/png;base64,AAA");
  });

  it("视频生成/编辑/续写都返回 request_id，缺失时报无效响应", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ request_id: " req-1 " }));
    vi.stubGlobal("fetch", fetchMock);
    const base = { apiKey: "k", model: "grok-imagine-video", prompt: "动起来" };

    expect(
      await createVideo({ ...base, imageURL: "https://x/y.png", duration: 6, aspectRatio: "16:9", resolution: "720p" }),
    ).toBe("req-1");
    expect(requestBody(fetchMock.mock.calls[0]).image).toEqual({ url: "https://x/y.png" });
    expect(await editVideo({ ...base, videoFileID: "file-2" })).toBe("req-1");
    expect(requestBody(fetchMock.mock.calls[1]).video).toEqual({ file_id: "file-2" });
    expect(await extendVideo({ ...base, videoURL: "https://x/v.mp4", duration: 4 })).toBe("req-1");
    expect(requestBody(fetchMock.mock.calls[2])).toMatchObject({ duration: 4, video: { url: "https://x/v.mp4" } });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({})),
    );
    await expect(createVideo({ ...base, duration: 6, aspectRatio: "16:9", resolution: "720p" })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("视频状态归一化进度、失败原因与完成地址", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "failed", progress: 180, error: { code: "e1", message: "生成失败" } })),
    );
    const failed = await getVideo({ apiKey: "k", requestId: "r/1" });
    expect(failed).toEqual({
      status: "failed",
      model: undefined,
      progress: 100,
      error: { code: "e1", message: "生成失败" },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "done", video: { url: "/v1/media/images/v.mp4", duration: 6 } })),
    );
    const done = await getVideo({ apiKey: "k", requestId: "r1" });
    expect(done.progress).toBe(100);
    expect(done.video).toEqual({ url: "/v1/media/images/v.mp4", duration: 6, respectModeration: undefined });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "unknown" })),
    );
    await expect(getVideo({ apiKey: "k", requestId: "r1" })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("音色列表读取 voice_id 并容忍缺失字段", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ voices: [{ voice_id: "eve" }, { voice_id: "ara", name: "Ara", language: "en" }] }),
      ),
    );
    expect(await listVoices({ apiKey: "k", model: "grok-voice-latest" })).toEqual([
      { voiceId: "eve", name: "eve", language: undefined },
      { voiceId: "ara", name: "Ara", language: "en" },
    ]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ voices: [{}] })),
    );
    await expect(listVoices({ apiKey: "k" })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("TTS 支持 JSON base64 与二进制音频两种返回", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ audio: "QUJD", content_type: "audio/wav", duration: 1.25 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );
    expect(await synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" })).toEqual({
      url: "data:audio/wav;base64,QUJD",
      contentType: "audio/wav",
      duration: 1.25,
    });

    const createObjectURL = vi.fn(() => "blob:tts");
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "Content-Type": "audio/mpeg" } }),
      ),
    );
    expect(await synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" })).toEqual({
      url: "blob:tts",
      contentType: "audio/mpeg",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ error: { message: "语音失败" } }, 400)),
    );
    await expect(
      synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" }),
    ).rejects.toThrowError("语音失败");
  });

  it("STT 提交表单并解析字级时间戳", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.body).toBeInstanceOf(FormData);
      return jsonResponse({
        text: "你好",
        language: "zh",
        duration: 2,
        words: [{ text: "你好", start: 0, end: 1, speaker: 0 }, { bad: true }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeSpeech({
      apiKey: "k",
      model: "grok-stt",
      file: new File(["audio"], "a.mp3", { type: "audio/mpeg" }),
      language: "zh",
    });
    expect(result).toEqual({
      text: "你好",
      language: "zh",
      duration: 2,
      words: [{ text: "你好", start: 0, end: 1, speaker: 0 }],
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ text: 42 })),
    );
    await expect(
      transcribeSpeech({ apiKey: "k", model: "m", file: new File(["a"], "a.mp3"), language: undefined }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("共享工具", () => {
  it("resolveMediaURL 保留同源相对路径、data/blob 与外部绝对地址", () => {
    expect(resolveMediaURL("  /v1/media/images/a.png?x=1 ")).toBe("/v1/media/images/a.png?x=1");
    expect(resolveMediaURL("data:image/png;base64,AAA")).toBe("data:image/png;base64,AAA");
    expect(resolveMediaURL("blob:x")).toBe("blob:x");
    expect(resolveMediaURL("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(resolveMediaURL("not a url")).toBe("/not%20a%20url");
  });
});
