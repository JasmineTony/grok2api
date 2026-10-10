import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ModelRouteDTO } from "@/entities/model/types";
import { useCreativeVoice } from "@/features/creative-console/use-creative-voice";
import { i18n } from "@/shared/i18n";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  synthesizeSpeech: vi.fn(),
  transcribeSpeech: vi.fn(),
  listVoices: vi.fn(),
}));

vi.mock("@/features/creative-console/creative-console-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/creative-console/creative-console-api")>()),
  ...apiMock,
}));

const voiceModels: ModelRouteDTO[] = [
  { id: "t1", publicId: "grok-voice-latest", capability: "tts", provider: "grok_web", upstreamModel: "tts" },
  { id: "s1", publicId: "grok-stt", capability: "stt", provider: "grok_web", upstreamModel: "stt" },
] as ModelRouteDTO[];

const audioFile = new File(["a"], "a.mp3", { type: "audio/mpeg" });

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </I18nextProvider>
  );
}

/** 用与表单一致的提交入口驱动控制器：按钮禁用条件与提交守卫同源。 */
function submitEvent(): FormEvent {
  return { preventDefault: vi.fn() } as unknown as FormEvent;
}

function renderVoice(initial: { model: string; options: ModelRouteDTO[] }) {
  return renderHook(
    (props: { model: string; options: ModelRouteDTO[] }) =>
      useCreativeVoice({ apiKey: "k", model: props.model, modelOptions: props.options, onModelChange: vi.fn() }),
    { initialProps: initial, wrapper },
  );
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  apiMock.synthesizeSpeech
    .mockReset()
    .mockResolvedValue({ url: "data:audio/wav;base64,QUJD", contentType: "audio/wav" });
  apiMock.transcribeSpeech.mockReset().mockResolvedValue({ text: "识别结果" });
  apiMock.listVoices.mockReset().mockResolvedValue([{ voiceId: "eve", name: "Eve" }]);
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

/**
 * 提交守卫读取的是「点击提交那一刻」的渲染快照，而 mutation 执行时读的是最新一次渲染的入参。
 * 两者之间模型路由或音频被清空时，守卫已经放行，请求侧必须按默认模型或缺少音频处理，
 * 不能发出空模型请求，也不能静默什么都不做。
 */
describe("语音提交期间的模型与音频快照", () => {
  it("提交快照持有 tts 路由、最新渲染已清空时仍以默认语音模型合成", async () => {
    const { result, rerender } = renderVoice({ model: "grok-voice-latest", options: voiceModels });
    act(() => result.current.setPrompt("朗读这段话"));
    const submitWithRoute = result.current.submit;

    rerender({ model: "", options: [] });
    expect(result.current.activeModel).toBe("");

    await act(async () => {
      submitWithRoute(submitEvent());
    });

    await waitFor(() => expect(result.current.ttsResult?.contentType).toBe("audio/wav"));
    expect(apiMock.synthesizeSpeech).toHaveBeenCalledTimes(1);
    expect(apiMock.synthesizeSpeech.mock.calls[0][0]).toMatchObject({
      model: "grok-voice-latest",
      text: "朗读这段话",
    });
  });

  it("提交快照持有 stt 路由、最新渲染已清空时仍以默认转写模型提交", async () => {
    const { result, rerender } = renderVoice({ model: "grok-stt", options: voiceModels });
    act(() => result.current.setSubMode("stt"));
    act(() => result.current.setAudioFile(audioFile));
    const submitWithRoute = result.current.submit;

    rerender({ model: "", options: [] });
    expect(result.current.activeModel).toBe("");

    await act(async () => {
      submitWithRoute(submitEvent());
    });

    await waitFor(() => expect(result.current.sttResult?.text).toBe("识别结果"));
    expect(apiMock.transcribeSpeech).toHaveBeenCalledTimes(1);
    expect(apiMock.transcribeSpeech.mock.calls[0][0]).toMatchObject({ model: "grok-stt", file: audioFile });
  });

  it("提交快照持有音频、最新渲染已清空时拒绝转写并提示缺少音频", async () => {
    const { result } = renderVoice({ model: "grok-stt", options: voiceModels });
    act(() => result.current.setSubMode("stt"));
    act(() => result.current.setAudioFile(audioFile));
    const submitWithFile = result.current.submit;

    act(() => result.current.setAudioFile(null));

    await act(async () => {
      submitWithFile(submitEvent());
    });

    await waitFor(() => expect(result.current.sttError).toBe(i18n.t("creativeConsole.errors.noAudio")));
    expect(apiMock.transcribeSpeech).not.toHaveBeenCalled();
    expect(result.current.sttResult).toBeNull();
  });
});
