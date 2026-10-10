import { isRecord, readError } from "@/features/creative-console/creative-api-core";
import {
  listVoices,
  readTranscriptWords,
  readVoices,
  synthesizeSpeech,
  transcribeSpeech,
} from "@/features/creative-console/creative-voice-api";
import { afterEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function captureFetch(response: () => Response) {
  const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("音色列表", () => {
  it("带模型时拼查询参数，不带模型时请求裸路径", async () => {
    const fetchMock = captureFetch(() => jsonResponse({ voices: [] }));
    await listVoices({ apiKey: "k", model: "grok-voice-latest" });
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/tts/voices?model=grok-voice-latest");

    await listVoices({ apiKey: "k" });
    expect(fetchMock.mock.calls[1][0]).toBe("/v1/tts/voices");
  });

  it("名称缺失时回退到 voice_id，语言缺失时不写该字段", () => {
    expect(readVoices({ voices: [{ voice_id: "eve" }, { voice_id: "ara", name: "Ara", language: "en" }] })).toEqual([
      { voiceId: "eve", name: "eve", language: undefined },
      { voiceId: "ara", name: "Ara", language: "en" },
    ]);
  });

  it("违约的列表响应与列表项都按无效响应报错", () => {
    expect(() => readVoices({ voices: "x" })).toThrowError(/invalid|voice list response was invalid/i);
    expect(() => readVoices([{ voice_id: "eve" }])).toThrowError(/invalid|voice list response was invalid/i);
    expect(() => readVoices({ voices: [{ name: "Eve" }] })).toThrowError(/invalid|voice list response was invalid/i);
    try {
      readVoices({ voices: "x" });
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_response", status: 200 });
    }
  });
});

describe("语音合成请求体与返回", () => {
  it("不给倍速时不带 speed 字段，给了则按数字传入", async () => {
    const fetchMock = captureFetch(() => jsonResponse({ audio: "QUJD" }));
    await synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" });
    const withoutSpeed = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(withoutSpeed).not.toHaveProperty("speed");

    await synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh", speed: 1.5 });
    const withSpeed = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as Record<string, unknown>;
    expect(withSpeed.speed).toBe(1.5);
  });

  it("JSON 结果缺少 content_type 与 duration 时使用默认 MIME 且不带时长", async () => {
    captureFetch(() => jsonResponse({ audio: "QUJD" }));
    expect(await synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" })).toEqual({
      url: "data:audio/mpeg;base64,QUJD",
      contentType: "audio/mpeg",
      duration: undefined,
    });
  });

  it("JSON 结果缺少 audio 字段时报无效响应", async () => {
    captureFetch(() => jsonResponse({ text: "没有音频" }));
    await expect(
      synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" }),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("二进制结果缺少 content-type 时按 audio/mpeg 生成对象地址", async () => {
    const createObjectURL = vi.fn(() => "blob:tts-default");
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    captureFetch(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    expect(await synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" })).toEqual({
      url: "blob:tts-default",
      contentType: "audio/mpeg",
    });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it("HTTP 失败时使用响应体里的错误码与文案", async () => {
    captureFetch(() => jsonResponse({ error: { message: "音频失败", code: "tts_failed" } }, 502));
    await expect(
      synthesizeSpeech({ apiKey: "k", model: "m", text: "hi", voiceId: "eve", language: "zh" }),
    ).rejects.toMatchObject({ status: 502, code: "tts_failed", message: "音频失败" });
  });
});

describe("语音转写", () => {
  it("未指定语言时表单不带 language，指定时带上", async () => {
    const fetchMock = captureFetch(() => jsonResponse({ text: "识别结果" }));
    await transcribeSpeech({ apiKey: "k", model: "stt", file: new File(["a"], "a.mp3") });
    const withoutLanguage = fetchMock.mock.calls[0][1]?.body;
    expect(withoutLanguage).toBeInstanceOf(FormData);
    expect((withoutLanguage as FormData).get("language")).toBeNull();
    expect((withoutLanguage as FormData).get("model")).toBe("stt");
    expect((withoutLanguage as FormData).get("format")).toBe("true");

    await transcribeSpeech({ apiKey: "k", model: "stt", file: new File(["a"], "a.mp3"), language: "zh" });
    const withLanguage = fetchMock.mock.calls[1][1]?.body;
    expect(withLanguage).toBeInstanceOf(FormData);
    expect((withLanguage as FormData).get("language")).toBe("zh");
  });

  it("缺少文本字段时按无效响应报错，HTTP 失败时映射错误码", async () => {
    captureFetch(() => jsonResponse({ language: "zh" }));
    await expect(transcribeSpeech({ apiKey: "k", model: "stt", file: new File(["a"], "a.mp3") })).rejects.toMatchObject(
      { code: "invalid_response" },
    );

    captureFetch(() => jsonResponse({ error: { message: "转写失败", code: "stt_failed" } }, 500));
    await expect(transcribeSpeech({ apiKey: "k", model: "stt", file: new File(["a"], "a.mp3") })).rejects.toMatchObject(
      { status: 500, code: "stt_failed", message: "转写失败" },
    );
  });

  it("结果缺少语言与时长时不写该字段，字级时间戳缺失时留空", async () => {
    captureFetch(() => jsonResponse({ text: "识别结果" }));
    expect(await transcribeSpeech({ apiKey: "k", model: "stt", file: new File(["a"], "a.mp3") })).toEqual({
      text: "识别结果",
      language: undefined,
      duration: undefined,
      words: undefined,
    });
  });

  it("非数组的 words 视为没有字级时间戳", () => {
    expect(readTranscriptWords("x")).toBeUndefined();
    expect(readTranscriptWords(undefined)).toBeUndefined();
  });

  it("逐项补全字级时间戳的默认值与说话人", () => {
    expect(
      readTranscriptWords([
        { text: "你好", start: 0.5, end: 1.5, speaker: 2 },
        { text: "世界" },
        { start: 1 },
        { text: 7 },
        "无效",
      ]),
    ).toEqual([
      { text: "你好", start: 0.5, end: 1.5, speaker: 2 },
      { text: "世界", start: 0, end: 0, speaker: undefined },
    ]);
  });
});

describe("共享解析工具契约", () => {
  it("isRecord 与 readError 对非对象输入给出确定结果", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(readError("x")).toEqual({});
  });
});
