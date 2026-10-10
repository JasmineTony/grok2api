import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { ImagePanel } from "@/features/creative-console/image-panel";
import { VoicePanel } from "@/features/creative-console/voice-panel";
import { useChatSettings } from "@/features/creative-console/use-creative-chat-store";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  generateImage: vi.fn(),
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

const imageModels: ModelRouteDTO[] = [
  { id: "i1", publicId: "grok-imagine-image-2.0", capability: "image", provider: "grok_web", upstreamModel: "img" },
] as ModelRouteDTO[];

const fixedReasoningRoute: ModelRouteDTO = {
  id: "m2",
  publicId: "grok-4.20-0309-reasoning",
  capability: "chat",
  provider: "grok_console",
  upstreamModel: "grok-4.20-0309-reasoning",
} as ModelRouteDTO;

let queryClient: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

function submitForm(): void {
  const form = document.querySelector("form");
  if (!form) throw new Error("缺少表单");
  fireEvent.submit(form);
}

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  apiMock.generateImage.mockReset().mockResolvedValue([{ url: "/v1/media/images/a.png" }]);
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

describe("聊天设置：固定推理模型", () => {
  it("命中 console 固定推理模型时强制 auto 且只保留一个推理档位", () => {
    const onModelChange = vi.fn();
    const { result } = renderHook(() =>
      useChatSettings({
        model: "grok-4.20-0309-reasoning",
        modelOptions: [fixedReasoningRoute],
        onModelChange,
        initialModel: "",
        reasoningEffort: "high",
      }),
    );

    expect(result.current.fixedReasoningModel).toBe(true);
    expect(result.current.reasoningEffort).toBe("auto");
    expect(result.current.reasoningEffortOptions).toEqual(["auto"]);
  });

  it("非固定推理模型沿用用户档位，并在模型列表就绪后回填历史模型一次", () => {
    const onModelChange = vi.fn();
    const { result, rerender } = renderHook(
      (props: { options: ModelRouteDTO[] }) =>
        useChatSettings({
          model: "grok-4",
          modelOptions: props.options,
          onModelChange,
          initialModel: "grok-4",
          reasoningEffort: "high",
        }),
      { initialProps: { options: [] as ModelRouteDTO[] } },
    );

    expect(result.current.reasoningEffort).toBe("high");
    expect(result.current.reasoningEffortOptions.length).toBeGreaterThan(1);
    expect(onModelChange).not.toHaveBeenCalled();

    const route = { id: "m1", publicId: "grok-4", capability: "chat", provider: "grok_web", upstreamModel: "grok-4" };
    rerender({ options: [route as ModelRouteDTO] });
    expect(onModelChange).toHaveBeenCalledWith("grok-4");

    rerender({ options: [{ ...route, id: "m9" } as ModelRouteDTO] });
    expect(onModelChange).toHaveBeenCalledTimes(1);
  });
});

describe("图像面板提交守卫", () => {
  const baseProps: ComponentProps<typeof ImagePanel> = {
    apiKey: "k",
    model: "grok-imagine-image-2.0",
    modelOptions: imageModels,
    onModelChange: vi.fn(),
  };

  function renderImagePanel(overrides: Partial<ComponentProps<typeof ImagePanel>> = {}) {
    return render(<ImagePanel {...baseProps} {...overrides} />, { wrapper });
  }

  it("缺少密钥时提交不发请求", async () => {
    renderImagePanel({ apiKey: "" });
    const prompt = screen.getByPlaceholderText(i18n.t("creativeConsole.imagePlaceholder"));
    fireEvent.change(prompt, { target: { value: "一只猫" } });
    submitForm();

    expect(apiMock.generateImage).not.toHaveBeenCalled();
  });

  it("提示词为空或只有空白时不发请求", () => {
    renderImagePanel();
    submitForm();
    expect(apiMock.generateImage).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(i18n.t("creativeConsole.imagePlaceholder")), {
      target: { value: "   " },
    });
    submitForm();
    expect(apiMock.generateImage).not.toHaveBeenCalled();
  });
});

describe("语音面板提交守卫", () => {
  function renderVoicePanel(overrides: Partial<ComponentProps<typeof VoicePanel>> = {}) {
    return render(
      <VoicePanel
        apiKey="k"
        model="grok-voice-latest"
        modelOptions={voiceModels}
        onModelChange={vi.fn()}
        {...overrides}
      />,
      { wrapper },
    );
  }

  it("缺少密钥时合成与转写都不发请求", async () => {
    renderVoicePanel({ apiKey: "" });
    fireEvent.change(screen.getByPlaceholderText(i18n.t("creativeConsole.voicePlaceholder")), {
      target: { value: "朗读" },
    });
    submitForm();

    expect(apiMock.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("提示词为空时不发起合成", () => {
    renderVoicePanel();
    submitForm();
    expect(apiMock.synthesizeSpeech).not.toHaveBeenCalled();
  });

  it("未选择音频文件时不发起转写，选择文件后才提交", async () => {
    renderVoicePanel();
    fireEvent.click(screen.getAllByRole("button", { name: i18n.t("creativeConsole.transcribe") })[0]);
    submitForm();
    expect(apiMock.transcribeSpeech).not.toHaveBeenCalled();

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a"], "a.mp3", { type: "audio/mpeg" })] } });
    expect(await screen.findByText("a.mp3")).toBeInTheDocument();

    submitForm();
    await vi.waitFor(() => expect(apiMock.transcribeSpeech).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("识别结果")).toBeInTheDocument();
  });
});

describe("语音面板失败路径", () => {
  function renderVoicePanel() {
    return render(
      <VoicePanel apiKey="k" model="grok-voice-latest" modelOptions={voiceModels} onModelChange={vi.fn()} />,
      {
        wrapper,
      },
    );
  }

  it("合成失败展示接口错误文案", async () => {
    apiMock.synthesizeSpeech.mockRejectedValue(new Error("合成失败"));
    renderVoicePanel();

    fireEvent.change(screen.getByPlaceholderText(i18n.t("creativeConsole.voicePlaceholder")), {
      target: { value: "朗读这段话" },
    });
    submitForm();

    expect(await screen.findByText("合成失败")).toBeInTheDocument();
  });

  it("转写失败展示接口错误文案且不展示音频", async () => {
    apiMock.transcribeSpeech.mockRejectedValue(new Error("转写失败"));
    renderVoicePanel();

    fireEvent.click(screen.getAllByRole("button", { name: i18n.t("creativeConsole.transcribe") })[0]);
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["a"], "a.mp3", { type: "audio/mpeg" })] },
    });
    submitForm();

    expect(await screen.findByText("转写失败")).toBeInTheDocument();
    expect(document.querySelector("audio")).toBeNull();
  });
});
