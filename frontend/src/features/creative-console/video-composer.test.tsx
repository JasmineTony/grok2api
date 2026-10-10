import { TooltipProvider } from "@/components/ui/tooltip";
import { VideoComposer } from "@/features/creative-console/video-composer";
import type { CreativeVideoController } from "@/features/creative-console/use-creative-video";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

function createController(overrides: Partial<CreativeVideoController> = {}): CreativeVideoController {
  return {
    action: "generate",
    prompt: "",
    placeholder: "描述要生成的视频",
    setPrompt: vi.fn(),
    activeModel: "grok-imagine-video",
    activeModels: [{ id: "v1", publicId: "grok-imagine-video" }],
    selectedResolution: "720p",
    generateResolutions: ["1k", "720p"],
    duration: "6",
    setDuration: vi.fn(),
    extendDuration: "6",
    setExtendDuration: vi.fn(),
    aspectRatio: "16:9",
    setAspectRatio: vi.fn(),
    setResolution: vi.fn(),
    canSubmit: false,
    submitLabel: "生成视频",
    submit: vi.fn(),
    isSubmitting: false,
    createError: "",
    changeAction: vi.fn(),
    hasFirstFrame: false,
    hasReferenceImage: false,
    isReferenceMode: false,
    imageURL: "",
    referenceURL: "",
    sourceVideoURL: "",
    sourceVideoFileID: "",
    referenceVoiceId: "",
    voices: [],
    uploadPending: false,
    videoUploadPending: false,
    uploadError: "",
    videoUploadError: "",
    pickAttachmentFile: vi.fn(),
    setAttachmentURL: vi.fn(),
    clearAttachment: vi.fn(),
    pickSourceVideo: vi.fn(),
    setSourceVideoURL: vi.fn(),
    clearSourceVideo: vi.fn(),
    selectReferenceVoice: vi.fn(),
    ...overrides,
  } as unknown as CreativeVideoController;
}

function renderComposer(controller: CreativeVideoController) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <VideoComposer controller={controller} onModelChange={vi.fn()} />
      </TooltipProvider>
    </I18nextProvider>,
  );
}

describe("视频提交区", () => {
  it("生成模式展示首帧/参考图/参考音色与时长、比例、分辨率控件", () => {
    renderComposer(createController());

    expect(screen.getByTestId("video-attachment-image")).toHaveAccessibleName(
      i18n.t("creativeConsole.firstFrameImage"),
    );
    expect(screen.getByTestId("video-attachment-reference")).toHaveAccessibleName(
      i18n.t("creativeConsole.referenceImage"),
    );
    expect(screen.getByTestId("video-reference-voice-select")).toHaveAccessibleName(
      i18n.t("creativeConsole.referenceVoice"),
    );
    expect(screen.getByTestId("video-duration-select")).toHaveAccessibleName(i18n.t("creativeConsole.duration"));
    expect(screen.getByTestId("video-aspect-ratio-select")).toHaveAccessibleName(i18n.t("creativeConsole.aspectRatio"));
    expect(screen.getByTestId("video-resolution-select")).toHaveAccessibleName(i18n.t("creativeConsole.resolution"));
    expect(screen.queryByTestId("video-attachment-source")).not.toBeInTheDocument();
  });

  it("编辑模式只保留源视频入口，隐藏形状控件与生成附件", () => {
    renderComposer(createController({ action: "edit", submitLabel: "编辑视频" }));

    expect(screen.getByTestId("video-attachment-source")).toHaveAccessibleName(i18n.t("creativeConsole.sourceVideo"));
    expect(screen.queryByTestId("video-attachment-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("video-duration-select")).not.toBeInTheDocument();
    expect(screen.queryByTestId("video-resolution-select")).not.toBeInTheDocument();
    expect(screen.getByTestId("video-submit")).toHaveAccessibleName("编辑视频");
  });

  it("续写模式展示源视频与续写时长，隐藏生成用的形状控件", () => {
    renderComposer(createController({ action: "extend", submitLabel: "续写视频" }));

    expect(screen.getByTestId("video-attachment-source")).toBeInTheDocument();
    expect(screen.getByTestId("video-extend-duration-select")).toHaveAccessibleName(
      i18n.t("creativeConsole.extendDuration"),
    );
    expect(screen.queryByTestId("video-aspect-ratio-select")).not.toBeInTheDocument();
  });

  it("切换动作、输入提示词与提及错误都回到控制器", async () => {
    const controller = createController({ createError: "上游拒绝" });
    renderComposer(controller);

    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByTestId("video-action-extend"));
    expect(controller.changeAction).toHaveBeenCalledWith("extend");

    await user.type(screen.getByTestId("video-prompt"), "海浪");
    expect(controller.setPrompt).toHaveBeenCalled();

    expect(screen.getByTestId("video-create-error")).toHaveTextContent("上游拒绝");
  });

  it("提交按钮按 canSubmit 禁用，提交时只调用一次控制器", async () => {
    const controller = createController({ canSubmit: true });
    const { container } = renderComposer(controller);

    expect(screen.getByTestId("video-submit")).toBeEnabled();
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect(controller.submit).toHaveBeenCalledTimes(1);

    expect(controller.setDuration).not.toHaveBeenCalled();
  });

  it("提交中禁用按钮并显示加载态", () => {
    const controller = createController({ canSubmit: false, isSubmitting: true });
    const { container } = renderComposer(controller);

    expect(screen.getByTestId("video-submit")).toBeDisabled();
    expect(container.querySelector("svg.animate-spin")).not.toBeNull();
    expect(controller.submit).not.toHaveBeenCalled();
  });
});
