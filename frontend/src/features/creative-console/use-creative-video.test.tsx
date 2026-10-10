import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { ModelRouteDTO } from "@/entities/model/types";
import { VideoPanel } from "@/features/creative-console/video-panel";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
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

function openPopover(label: string): void {
  fireEvent.click(screen.getByRole("button", { name: label }));
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!input) throw new Error("缺少文件输入框");
  return input as HTMLInputElement;
}

async function pickFile(name: string, type: string): Promise<void> {
  fireEvent.change(fileInput(), { target: { files: [new File(["bin"], name, { type })] } });
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
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
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.videoActions.edit") }));

    expect(await screen.findByRole("button", { name: i18n.t("creativeConsole.sourceVideo") })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: i18n.t("creativeConsole.resolution") })).not.toBeInTheDocument();
    expect(container.querySelectorAll("select").length).toBeGreaterThan(0);
  });
});

describe("视频分辨率与参考模式", () => {
  it("选择 1080p 后在参考模式下回退为 720p，并隐藏 1080p 选项", async () => {
    renderPanel();

    changeSelectByOptions("1080p", ["480p", "720p", "1080p"]);
    const resolutionTrigger = screen.getByRole("combobox", { name: i18n.t("creativeConsole.resolution") });
    await waitFor(() => expect(resolutionTrigger).toHaveTextContent("1080p"));

    openPopover(i18n.t("creativeConsole.referenceImage"));
    const referenceInput = await screen.findByRole("textbox", { name: i18n.t("creativeConsole.referenceImage") });
    fireEvent.change(referenceInput, { target: { value: "https://a/ref.png" } });

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: i18n.t("creativeConsole.resolution") })).toHaveTextContent("720p"),
    );
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

    openPopover(i18n.t("creativeConsole.firstFrameImage"));
    await pickFile("clip.mp4", "video/mp4");

    expect(await screen.findByText(i18n.t("creativeConsole.errors.invalidImage"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: i18n.t("creativeConsole.firstFrameImage") })).toHaveTextContent(
      i18n.t("creativeConsole.firstFrameImageShort"),
    );
  });

  it("上传结果不是图片时同样提示错误", async () => {
    mediaMock.uploadMediaInput.mockResolvedValue({ kind: "video", fileId: "video-1" });
    renderPanel();

    openPopover(i18n.t("creativeConsole.firstFrameImage"));
    await pickFile("frame.png", "image/png");

    expect(await screen.findByText(i18n.t("creativeConsole.errors.invalidImage"))).toBeInTheDocument();
  });

  it("图片上传成功后占用首帧，参考图随之不可选", async () => {
    renderPanel();

    openPopover(i18n.t("creativeConsole.firstFrameImage"));
    await pickFile("frame.png", "image/png");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: i18n.t("creativeConsole.firstFrameImage") })).toHaveTextContent(
        i18n.t("creativeConsole.firstFrameImageAdded"),
      ),
    );
    expect(screen.getByRole("button", { name: i18n.t("creativeConsole.referenceImage") })).toBeDisabled();
  });

  it("源视频类型不符时提示错误，上传成功后占用源视频", async () => {
    const { container } = renderPanel();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.videoActions.edit") }));

    openPopover(i18n.t("creativeConsole.sourceVideo"));
    await screen.findByRole("textbox", { name: i18n.t("creativeConsole.sourceVideo") });
    await pickFile("audio.mp3", "audio/mpeg");
    expect(await screen.findByText(i18n.t("creativeConsole.errors.invalidVideo"))).toBeInTheDocument();

    mediaMock.uploadMediaInput.mockResolvedValue({ kind: "video", fileId: "video-1" });
    await pickFile("clip.mp4", "video/mp4");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: i18n.t("creativeConsole.sourceVideo") })).toHaveTextContent(
        i18n.t("creativeConsole.sourceVideoAdded"),
      ),
    );
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("上传结果不是视频时提示视频错误", async () => {
    mediaMock.uploadMediaInput.mockResolvedValue({ kind: "image", fileId: "image-1" });
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.videoActions.edit") }));
    openPopover(i18n.t("creativeConsole.sourceVideo"));
    await screen.findByRole("textbox", { name: i18n.t("creativeConsole.sourceVideo") });
    await pickFile("clip.mp4", "video/mp4");

    expect(await screen.findByText(i18n.t("creativeConsole.errors.invalidVideo"))).toBeInTheDocument();
  });
});

describe("视频任务状态", () => {
  it("提交后轮询任务进度并按请求地址查询", async () => {
    apiMock.getVideo.mockResolvedValue({ status: "pending", progress: 30 });
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByPlaceholderText(i18n.t("creativeConsole.videoPlaceholder")), "海浪");
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.generateVideo") }));

    await waitFor(() => expect(apiMock.getVideo).toHaveBeenCalled());
    expect(apiMock.getVideo.mock.calls[0][0]).toMatchObject({ apiKey: "k", requestId: "req-1" });
    expect(await screen.findByText("req-1")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("30%")).toBeInTheDocument());
    expect(
      screen.queryByRole("link", { name: new RegExp(i18n.t("creativeConsole.openVideo")) }),
    ).not.toBeInTheDocument();
  });

  it("任务失败时展示失败原因", async () => {
    apiMock.getVideo.mockResolvedValue({
      status: "failed",
      progress: 100,
      error: { message: "生成失败原因" },
    });
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.type(screen.getByPlaceholderText(i18n.t("creativeConsole.videoPlaceholder")), "海浪");
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.generateVideo") }));

    expect(await screen.findByText("生成失败原因")).toBeInTheDocument();
  });

  it("续写动作携带续写时长且复用源视频校验提示", async () => {
    apiMock.extendVideo.mockRejectedValue(new Error("续写被拒绝"));
    renderPanel();

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: i18n.t("creativeConsole.videoActions.extend") }));
    await user.type(screen.getByPlaceholderText(i18n.t("creativeConsole.videoExtendPlaceholder")), "继续");
    changeSelectByOptions("4", ["2", "4", "6", "8", "10"]);

    openPopover(i18n.t("creativeConsole.sourceVideo"));
    await screen.findByRole("textbox", { name: i18n.t("creativeConsole.sourceVideo") });
    fireEvent.change(screen.getByRole("textbox", { name: i18n.t("creativeConsole.sourceVideo") }), {
      target: { value: "https://a/v.mp4" },
    });

    const submit = await screen.findByRole("button", { name: i18n.t("creativeConsole.extendVideo") });
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    await waitFor(() =>
      expect(apiMock.extendVideo).toHaveBeenCalledWith(
        expect.objectContaining({ duration: 4, videoURL: "https://a/v.mp4" }),
      ),
    );
    expect(await screen.findByText("续写被拒绝")).toBeInTheDocument();
  });
});
