import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { VideoPanel } from "@/features/creative-console/video-panel";
import { useCreativeVideo } from "@/features/creative-console/use-creative-video";
import { i18n } from "@/shared/i18n";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FormEvent, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  createVideo: vi.fn(),
  editVideo: vi.fn(),
  extendVideo: vi.fn(),
  getVideo: vi.fn(),
  listVoices: vi.fn(),
}));

vi.mock("@/features/creative-console/creative-console-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/creative-console/creative-console-api")>()),
  ...apiMock,
}));

const mediaMock = vi.hoisted(() => ({ uploadMediaInput: vi.fn() }));

vi.mock("@/features/media/media-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/media/media-api")>()),
  ...mediaMock,
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

let queryClient: QueryClient;

/** 状态查询自带 `retry: 2`，重试用例把退避压到 0，避免把 1s+2s 退避算进用例耗时。 */
function createQueryClient(overrides: { retryDelay?: number } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity, ...overrides } },
  });
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>
  );
}

function renderPanel(overrides: { model?: string; onModelChange?: (model: string) => void } = {}) {
  return render(
    <VideoPanel
      apiKey="k"
      model={overrides.model ?? "grok-imagine-video"}
      modelOptions={videoModels}
      onModelChange={overrides.onModelChange ?? vi.fn()}
    />,
    { wrapper },
  );
}

/** Radix Select 的候选值会同步到隐藏的原生 select，用它驱动 onChange（表单提交路径）。 */
function changeSelectByOptions(value: string, expectedOptions: string[]): void {
  const select = Array.from(document.querySelectorAll("select")).find((node) =>
    expectedOptions.every((option) => Array.from(node.options).some((item) => item.value === option)),
  );
  if (!select) throw new Error(`未找到候选为 ${expectedOptions.join("/")} 的选择控件`);
  fireEvent.change(select, { target: { value } });
}

function openPopover(testId: string): void {
  fireEvent.click(screen.getByTestId(testId));
}

function fileInput(testId = "video-attachment-upload-image-file"): HTMLInputElement {
  return screen.getByTestId(testId) as HTMLInputElement;
}

async function pickFile(name: string, type: string, testId?: string): Promise<void> {
  fireEvent.change(fileInput(testId), { target: { files: [new File(["bin"], name, { type })] } });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  queryClient = createQueryClient();
  apiMock.createVideo.mockReset().mockResolvedValue("req-1");
  apiMock.editVideo.mockReset().mockResolvedValue("req-2");
  apiMock.extendVideo.mockReset().mockResolvedValue("req-3");
  apiMock.getVideo.mockReset().mockResolvedValue({ status: "pending", progress: 30 });
  apiMock.listVoices.mockReset().mockResolvedValue([{ voiceId: "eve", name: "Eve" }]);
  mediaMock.uploadMediaInput.mockReset().mockResolvedValue({ kind: "image", fileId: "image-1" });
});

afterEach(() => {
  queryClient.clear();
  vi.clearAllMocks();
});

describe("视频面板模型范围", () => {
  it("当前模型不在可用路由里时回退到首个视频模型", async () => {
    const onModelChange = vi.fn();
    renderPanel({ model: "removed-model", onModelChange });

    await waitFor(() => expect(onModelChange).toHaveBeenCalledWith("grok-imagine-video"));
  });

  it("切换编辑动作后使用编辑路由范围", async () => {
    const { container } = renderPanel();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("video-action-edit"));

    expect(await screen.findByTestId("video-attachment-source")).toBeInTheDocument();
    expect(screen.queryByTestId("video-resolution-select")).not.toBeInTheDocument();
    expect(container.querySelectorAll("select").length).toBeGreaterThan(0);
  });
});

describe("视频分辨率与参考模式", () => {
  it("选择 1080p 后在参考模式下回退为 720p，并隐藏 1080p 选项", async () => {
    renderPanel();

    changeSelectByOptions("1080p", ["480p", "720p", "1080p"]);
    const resolutionTrigger = screen.getByTestId("video-resolution-select");
    await waitFor(() => expect(resolutionTrigger).toHaveTextContent("1080p"));

    openPopover("video-attachment-reference");
    const referenceInput = await screen.findByTestId("video-attachment-url-reference");
    fireEvent.change(referenceInput, { target: { value: "https://a/ref.png" } });

    await waitFor(() => expect(screen.getByTestId("video-resolution-select")).toHaveTextContent("720p"));
    const resolutionOptions = Array.from(document.querySelectorAll("select")).find((node) =>
      Array.from(node.options).some((option) => option.value === "1080p"),
    );
    expect(resolutionOptions).toBeUndefined();
  });
});

describe("本地媒体上传", () => {
  it("图片类型不符时提示错误且不写入附件", async () => {
    apiMock.listVoices.mockResolvedValue([]);
    renderPanel();

    openPopover("video-attachment-image");
    await pickFile("clip.mp4", "video/mp4");

    expect(await screen.findByTestId("video-attachment-upload-error-image")).toHaveTextContent(
      i18n.t("creativeConsole.errors.invalidImage"),
    );
    expect(screen.getByTestId("video-attachment-image")).toHaveTextContent(
      i18n.t("creativeConsole.firstFrameImageShort"),
    );
  });

  it("上传结果不是图片时同样提示错误", async () => {
    mediaMock.uploadMediaInput.mockResolvedValue({ kind: "video", fileId: "video-1" });
    renderPanel();

    openPopover("video-attachment-image");
    await pickFile("frame.png", "image/png");

    expect(await screen.findByTestId("video-attachment-upload-error-image")).toHaveTextContent(
      i18n.t("creativeConsole.errors.invalidImage"),
    );
  });

  it("图片上传成功后占用首帧，参考图随之不可选", async () => {
    renderPanel();

    openPopover("video-attachment-image");
    await pickFile("frame.png", "image/png");

    await waitFor(() =>
      expect(screen.getByTestId("video-attachment-image")).toHaveTextContent(
        i18n.t("creativeConsole.firstFrameImageAdded"),
      ),
    );
    expect(screen.getByTestId("video-attachment-reference")).toBeDisabled();
  });

  it("源视频类型不符时提示错误，上传成功后占用源视频", async () => {
    const { container } = renderPanel();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("video-action-edit"));

    openPopover("video-attachment-source");
    await screen.findByTestId("video-attachment-source-url");
    await pickFile("audio.mp3", "audio/mpeg", "video-attachment-source-upload-file");
    expect(await screen.findByTestId("video-attachment-source-upload-error")).toHaveTextContent(
      i18n.t("creativeConsole.errors.invalidVideo"),
    );

    mediaMock.uploadMediaInput.mockResolvedValue({ kind: "video", fileId: "video-1" });
    await pickFile("clip.mp4", "video/mp4", "video-attachment-source-upload-file");
    await waitFor(() =>
      expect(screen.getByTestId("video-attachment-source")).toHaveTextContent(
        i18n.t("creativeConsole.sourceVideoAdded"),
      ),
    );
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("上传结果不是视频时提示视频错误", async () => {
    mediaMock.uploadMediaInput.mockResolvedValue({ kind: "image", fileId: "image-1" });
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("video-action-edit"));
    openPopover("video-attachment-source");
    await screen.findByTestId("video-attachment-source-url");
    await pickFile("clip.mp4", "video/mp4", "video-attachment-source-upload-file");

    expect(await screen.findByTestId("video-attachment-source-upload-error")).toHaveTextContent(
      i18n.t("creativeConsole.errors.invalidVideo"),
    );
  });
});

describe("视频任务状态", () => {
  it("提交后轮询任务进度并按请求地址查询", async () => {
    apiMock.getVideo.mockResolvedValue({ status: "pending", progress: 30 });
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("video-prompt"), "海浪");
    await user.click(screen.getByTestId("video-submit"));

    await waitFor(() => expect(apiMock.getVideo).toHaveBeenCalled());
    expect(apiMock.getVideo.mock.calls[0][0]).toMatchObject({ apiKey: "k", requestId: "req-1" });
    await waitFor(() => expect(screen.getByTestId("video-result-request-id")).toHaveTextContent("req-1"));
    await waitFor(() => expect(screen.getByTestId("video-result-progress")).toHaveTextContent("30%"));
    expect(screen.queryByTestId("video-result-open")).not.toBeInTheDocument();
  });

  it("任务失败时展示失败原因", async () => {
    apiMock.getVideo.mockResolvedValue({
      status: "failed",
      progress: 100,
      error: { message: "生成失败原因" },
    });
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("video-prompt"), "海浪");
    await user.click(screen.getByTestId("video-submit"));

    expect(await screen.findByTestId("video-result-failed")).toHaveTextContent("生成失败原因");
  });

  it("续写动作携带续写时长且复用源视频校验提示", async () => {
    apiMock.extendVideo.mockRejectedValue(new Error("续写被拒绝"));
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("video-action-extend"));
    await user.type(screen.getByTestId("video-prompt"), "继续");
    changeSelectByOptions("4", ["2", "4", "6", "8", "10"]);

    openPopover("video-attachment-source");
    const sourceInput = await screen.findByTestId("video-attachment-source-url");
    fireEvent.change(sourceInput, { target: { value: "https://a/v.mp4" } });

    const submit = screen.getByTestId("video-submit");
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(apiMock.extendVideo).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 4, videoURL: "https://a/v.mp4" }),
      ),
    );
    expect(await screen.findByTestId("video-create-error")).toHaveTextContent("续写被拒绝");
  });

  it("状态查询失败时展示错误，重试后恢复任务进度", async () => {
    queryClient = createQueryClient({ retryDelay: 0 });
    apiMock.getVideo.mockRejectedValue(new Error("状态查询失败"));
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByTestId("video-prompt"), "海浪");
    await user.click(screen.getByTestId("video-submit"));

    expect(await screen.findByTestId("video-result-error")).toHaveTextContent("状态查询失败");

    apiMock.getVideo.mockReset().mockResolvedValue({ status: "pending", progress: 30 });
    await user.click(screen.getByTestId("video-result-retry"));

    await waitFor(() => expect(screen.getByTestId("video-result-progress")).toHaveTextContent("30%"));
    expect(screen.queryByTestId("video-result-error")).not.toBeInTheDocument();
  });

  it("任务被清空后手动重试状态查询，只用当前密钥且不再指向旧任务", async () => {
    const onModelChange = vi.fn();
    const { result } = renderHook(
      () => useCreativeVideo({ apiKey: "k", model: "grok-imagine-video", modelOptions: videoModels, onModelChange }),
      { wrapper },
    );

    act(() => result.current.setPrompt("海浪"));
    await act(async () => {
      result.current.submit({ preventDefault: vi.fn() } as unknown as FormEvent);
    });
    await waitFor(() => expect(apiMock.getVideo).toHaveBeenCalledTimes(1));
    expect(apiMock.getVideo.mock.calls[0][0]).toMatchObject({ apiKey: "k", requestId: "req-1" });

    act(() => result.current.changeAction("edit"));
    expect(result.current.job).toBeNull();

    await act(async () => {
      result.current.retryStatus();
    });
    await waitFor(() => expect(apiMock.getVideo).toHaveBeenCalledTimes(2));
    expect(apiMock.getVideo.mock.calls[1][0]).toMatchObject({ apiKey: "k", requestId: "" });
  });
});
