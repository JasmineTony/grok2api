import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { ImagePanel } from "@/features/creative-console/image-panel";
import { VideoPanel } from "@/features/creative-console/video-panel";
import { VoicePanel } from "@/features/creative-console/voice-panel";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  generateImage: vi.fn(),
  createVideo: vi.fn(),
  editVideo: vi.fn(),
  extendVideo: vi.fn(),
  getVideo: vi.fn(),
  listVoices: vi.fn(),
  synthesizeSpeech: vi.fn(),
  transcribeSpeech: vi.fn(),
}));

vi.mock("@/features/creative-console/creative-console-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/creative-console/creative-console-api")>()),
  ...apiMock,
}));

const videoModels: ModelRouteDTO[] = [
  {
    id: "v1",
    publicId: "grok-imagine-video",
    capability: "video",
    provider: "grok_console",
    upstreamModel: "grok-imagine-video",
  },
] as ModelRouteDTO[];

const imageModels: ModelRouteDTO[] = [
  { id: "i1", publicId: "grok-imagine-image-2.0", capability: "image", provider: "grok_web", upstreamModel: "img" },
] as ModelRouteDTO[];

const voiceModels: ModelRouteDTO[] = [
  { id: "t1", publicId: "grok-voice-latest", capability: "tts", provider: "grok_web", upstreamModel: "tts" },
  { id: "s1", publicId: "grok-stt", capability: "stt", provider: "grok_web", upstreamModel: "stt" },
] as ModelRouteDTO[];

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

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  apiMock.listVoices.mockResolvedValue([{ voiceId: "eve", name: "Eve" }]);
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("创作台图像面板", () => {
  it("生成成功后展示图片并可打开原图，质量选项只对 2.0 模型出现", async () => {
    apiMock.generateImage.mockResolvedValue([{ url: "/v1/media/images/a.png" }]);
    render(
      <ImagePanel apiKey="k" model="grok-imagine-image-2.0" modelOptions={imageModels} onModelChange={vi.fn()} />,
      {
        wrapper,
      },
    );

    expect(screen.getByTestId("image-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcomeImage"));
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("image-prompt"), "一只猫");
    expect(screen.getByTestId("image-prompt")).toHaveAttribute(
      "placeholder",
      i18n.t("creativeConsole.imagePlaceholder"),
    );
    await user.click(screen.getByTestId("image-generate"));

    await waitFor(() =>
      expect(screen.getByAltText(i18n.t("creativeConsole.generatedImageAlt", { index: 1 }))).toBeInTheDocument(),
    );
    expect(apiMock.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "一只猫", count: 1, aspectRatio: "1:1", resolution: "1k", quality: "medium" }),
    );
    expect(screen.getByTestId("image-result-open-1")).toHaveAccessibleName(i18n.t("creativeConsole.open"));
    expect(screen.getByTestId("image-result-open-1")).toHaveAttribute("href", "/v1/media/images/a.png");
  });

  it("生成失败展示接口错误文案", async () => {
    apiMock.generateImage.mockRejectedValue(new Error("上游拒绝"));
    render(<ImagePanel apiKey="k" model="grok-imagine-image" modelOptions={imageModels} onModelChange={vi.fn()} />, {
      wrapper,
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("image-prompt"), "一只猫");
    await user.click(screen.getByTestId("image-generate"));
    await waitFor(() => expect(screen.getByTestId("image-error")).toHaveTextContent("上游拒绝"));
  });
});

describe("创作台视频面板", () => {
  it("提交生成请求后展示任务进度与完成视频", async () => {
    apiMock.createVideo.mockResolvedValue("req-1");
    apiMock.getVideo.mockResolvedValue({
      status: "done",
      progress: 100,
      video: { url: "/v1/media/images/v.mp4", duration: 6 },
    });
    render(<VideoPanel apiKey="k" model="grok-imagine-video" modelOptions={videoModels} onModelChange={vi.fn()} />, {
      wrapper,
    });

    expect(screen.getByTestId("video-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcomeVideo"));
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("video-prompt"), "海浪");
    await user.click(screen.getByTestId("video-submit"));

    await waitFor(() => expect(apiMock.createVideo).toHaveBeenCalledTimes(1));
    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "海浪", duration: 6, aspectRatio: "16:9", resolution: "720p" }),
    );
    await waitFor(() => expect(screen.getByTestId("video-result-request-id")).toHaveTextContent("req-1"));
    expect(screen.getByTestId("video-result-open")).toHaveTextContent(i18n.t("creativeConsole.openVideo"));
    expect(screen.getByTestId("video-result-open")).toHaveAttribute("href", "/v1/media/images/v.mp4");
  });

  it("生成失败展示错误并保留在生成状态之外", async () => {
    apiMock.createVideo.mockRejectedValue(new Error("视频被拒绝"));
    render(<VideoPanel apiKey="k" model="grok-imagine-video" modelOptions={videoModels} onModelChange={vi.fn()} />, {
      wrapper,
    });
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("video-prompt"), "海浪");
    await user.click(screen.getByTestId("video-submit"));
    await waitFor(() => expect(screen.getByTestId("video-create-error")).toHaveTextContent("视频被拒绝"));
    expect(screen.getByTestId("video-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcomeVideo"));
  });
});

describe("创作台语音面板", () => {
  it("合成成功后展示音频与下载入口", async () => {
    apiMock.synthesizeSpeech.mockResolvedValue({
      url: "data:audio/wav;base64,QUJD",
      contentType: "audio/wav",
      duration: 1.5,
    });
    const { container } = render(
      <VoicePanel apiKey="k" model="grok-voice-latest" modelOptions={voiceModels} onModelChange={vi.fn()} />,
      { wrapper },
    );

    expect(screen.getByTestId("voice-welcome-state")).toHaveTextContent(i18n.t("creativeConsole.welcomeVoice"));
    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("voice-prompt"), "朗读这段话");
    expect(screen.getByTestId("voice-prompt")).toHaveAttribute(
      "placeholder",
      i18n.t("creativeConsole.voicePlaceholder"),
    );
    await user.click(screen.getByTestId("voice-synthesize"));

    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull());
    expect(apiMock.synthesizeSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ text: "朗读这段话", language: "zh", speed: 1 }),
    );
  });

  it("转写模式需要先选文件，提交后展示识别文本", async () => {
    apiMock.transcribeSpeech.mockResolvedValue({ text: "识别结果", language: "zh", duration: 2 });
    render(<VoicePanel apiKey="k" model="grok-voice-latest" modelOptions={voiceModels} onModelChange={vi.fn()} />, {
      wrapper,
    });

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("voice-submode-stt"));
    expect(apiMock.transcribeSpeech).not.toHaveBeenCalled();

    const file = new File(["audio"], "a.mp3", { type: "audio/mpeg" });
    const fileInput = screen.getByTestId("voice-audio-input") as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [file] } });
    await user.click(screen.getByTestId("voice-transcribe"));

    await waitFor(() => expect(screen.getByTestId("voice-stt-transcript")).toHaveTextContent("识别结果"));
    expect(apiMock.transcribeSpeech).toHaveBeenCalledWith(expect.objectContaining({ file, language: "zh" }));
  });
});
