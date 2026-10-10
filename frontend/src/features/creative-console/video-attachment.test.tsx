import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { VoiceInfo } from "@/features/creative-console/creative-console-api";
import type { CreativeVideoController } from "@/features/creative-console/use-creative-video";
import {
  ReferenceVoiceSelect,
  VideoImageAttachment,
  VideoSourceAttachment,
} from "@/features/creative-console/video-attachment";
import { i18n } from "@/shared/i18n";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImagePlus } from "lucide-react";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it, vi } from "vitest";

/** jsdom 未实现 scrollIntoView，Radix Select 打开弹层时会调用它。 */
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

type ControllerFields = Partial<CreativeVideoController>;
function createController(overrides: ControllerFields = {}): CreativeVideoController {
  return {
    imageURL: "",
    imageFileID: "",
    referenceURL: "",
    referenceFileID: "",
    referenceVoiceId: "",
    sourceVideoURL: "",
    sourceVideoFileID: "",
    hasFirstFrame: false,
    hasReferenceImage: false,
    hasReferenceAudio: false,
    isReferenceMode: false,
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

function renderNode(node: ReactNode) {
  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>{node}</TooltipProvider>
    </I18nextProvider>,
  );
}

function openPopover(trigger: HTMLElement): void {
  fireEvent.click(trigger);
}

/** Radix Select 的弹层只由 pointerdown(pointerType=mouse) 或键盘打开，jsdom 下用键盘更稳定。 */
function openSelect(trigger: HTMLElement): void {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
}

/** 弹层通过 portal 挂到 body，用 testid 定位文件输入框。 */
function uploadInput(testId = "video-attachment-upload-image-file"): HTMLInputElement {
  return screen.getByTestId(testId) as HTMLInputElement;
}

describe("视频首帧图与参考图附件", () => {
  it("两种附件共用弹层结构，文案与占用状态按用途区分", () => {
    renderNode(<VideoImageAttachment kind="image" controller={createController()} icon={<ImagePlus />} />);
    const trigger = screen.getByTestId("video-attachment-image");
    expect(trigger).toHaveAccessibleName(i18n.t("creativeConsole.firstFrameImage"));
    expect(trigger).toHaveTextContent(i18n.t("creativeConsole.firstFrameImageShort"));
  });

  it("参考图占用时按钮展示已添加文案", () => {
    renderNode(
      <VideoImageAttachment
        kind="reference"
        controller={createController({ referenceFileID: "file-1", hasReferenceImage: true })}
        icon={<ImagePlus />}
      />,
    );
    const trigger = screen.getByTestId("video-attachment-reference");
    expect(trigger).toHaveAccessibleName(i18n.t("creativeConsole.referenceImage"));
    expect(trigger).toHaveTextContent(i18n.t("creativeConsole.referenceImageAdded"));
  });

  it("首帧图在参考模式下禁用，参考图已有首帧时禁用", () => {
    renderNode(
      <VideoImageAttachment
        kind="image"
        controller={createController({ isReferenceMode: true })}
        icon={<ImagePlus />}
      />,
    );
    expect(screen.getByTestId("video-attachment-image")).toBeDisabled();

    renderNode(
      <VideoImageAttachment
        kind="reference"
        controller={createController({ hasFirstFrame: true })}
        icon={<ImagePlus />}
      />,
    );
    expect(screen.getByTestId("video-attachment-reference")).toBeDisabled();
  });

  it("弹层内的 URL 输入回写控制器，占用时可清除当前附件", async () => {
    const controller = createController({ imageURL: "https://a/1.png", hasFirstFrame: true });
    renderNode(<VideoImageAttachment kind="image" controller={controller} icon={<ImagePlus />} />);

    openPopover(screen.getByTestId("video-attachment-image"));
    const input = await screen.findByTestId("video-attachment-url-image");
    expect(input).toHaveAccessibleName(i18n.t("creativeConsole.firstFrameImage"));
    expect(input).toHaveValue("https://a/1.png");

    fireEvent.change(input, { target: { value: "https://a/2.png" } });
    expect(controller.setAttachmentURL).toHaveBeenCalledWith("image", "https://a/2.png");

    fireEvent.click(await screen.findByTestId("video-attachment-clear-image"));
    expect(controller.clearAttachment).toHaveBeenCalledWith("image");
  });

  it("本地图片上传：点击上传按钮打开文件选择，选中文件后回调并清空输入值", async () => {
    const controller = createController();
    renderNode(<VideoImageAttachment kind="image" controller={controller} icon={<ImagePlus />} />);

    openPopover(screen.getByTestId("video-attachment-image"));
    const input = uploadInput();
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(await screen.findByTestId("video-attachment-upload-image"));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const file = new File(["x"], "a.png", { type: "image/png" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(controller.pickAttachmentFile).toHaveBeenCalledWith("image", file);
    expect(input.value).toBe("");

    fireEvent.change(input, { target: { files: null } });
    expect(controller.pickAttachmentFile).toHaveBeenCalledTimes(1);
  });

  it("上传中禁用按钮，上传失败展示错误文案", async () => {
    const controller = createController({ uploadPending: true, uploadError: "图片格式不支持" });
    renderNode(<VideoImageAttachment kind="image" controller={controller} icon={<ImagePlus />} />);

    openPopover(screen.getByTestId("video-attachment-image"));
    expect(await screen.findByTestId("video-attachment-upload-image")).toBeDisabled();
    expect(screen.getByTestId("video-attachment-upload-error-image")).toHaveTextContent("图片格式不支持");
    expect(controller.pickAttachmentFile).not.toHaveBeenCalled();
  });
});

describe("视频源视频附件", () => {
  it("没有源视频时展示短文案，选择 URL 后按钮进入已添加状态", () => {
    renderNode(<VideoSourceAttachment controller={createController()} />);
    const trigger = screen.getByTestId("video-attachment-source");
    expect(trigger).toHaveAccessibleName(i18n.t("creativeConsole.sourceVideo"));
    expect(trigger).toHaveTextContent(i18n.t("creativeConsole.sourceVideoShort"));

    renderNode(<VideoSourceAttachment controller={createController({ sourceVideoURL: "https://a/v.mp4" })} />);
    expect(screen.getAllByTestId("video-attachment-source")[1]).toHaveTextContent(
      i18n.t("creativeConsole.sourceVideoAdded"),
    );
  });

  it("弹层内可以设置或清除源视频 URL", async () => {
    const controller = createController({ sourceVideoFileID: "file-9" });
    renderNode(<VideoSourceAttachment controller={controller} />);

    openPopover(screen.getByTestId("video-attachment-source"));
    const input = await screen.findByTestId("video-attachment-source-url");
    expect(input).toHaveAccessibleName(i18n.t("creativeConsole.sourceVideo"));
    expect(input).toHaveAttribute("placeholder", i18n.t("creativeConsole.sourceVideoAdded"));

    fireEvent.change(input, { target: { value: "https://a/v.mp4" } });
    expect(controller.setSourceVideoURL).toHaveBeenCalledWith("https://a/v.mp4");

    fireEvent.click(await screen.findByTestId("video-attachment-source-clear"));
    expect(controller.clearSourceVideo).toHaveBeenCalledTimes(1);
  });

  it("本地视频上传：选中文件回调，上传失败展示错误文案", async () => {
    const controller = createController({ videoUploadError: "视频格式不支持" });
    renderNode(<VideoSourceAttachment controller={controller} />);

    openPopover(screen.getByTestId("video-attachment-source"));
    const input = screen.getByTestId("video-attachment-source-upload-file");
    expect(input).toHaveAttribute("accept", "video/mp4,video/webm,video/quicktime");
    expect(screen.getByTestId("video-attachment-source-upload-error")).toHaveTextContent("视频格式不支持");

    const file = new File(["v"], "v.mp4", { type: "video/mp4" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(controller.pickSourceVideo).toHaveBeenCalledWith(file);
  });

  it("视频上传中禁用上传按钮", async () => {
    renderNode(<VideoSourceAttachment controller={createController({ videoUploadPending: true })} />);

    openPopover(screen.getByTestId("video-attachment-source"));
    expect(await screen.findByTestId("video-attachment-source-upload")).toBeDisabled();
  });
});

describe("参考音色选择", () => {
  const voices: VoiceInfo[] = [
    { voiceId: "eve", name: "Eve" },
    { voiceId: "ara", name: "Ara" },
  ];

  it("使用控制器返回的音色列表打开弹层，并展示当前选项", async () => {
    renderNode(<ReferenceVoiceSelect controller={createController({ voices, referenceVoiceId: "ara" })} />);

    const trigger = screen.getByTestId("video-reference-voice-select");
    expect(trigger).toHaveAccessibleName(i18n.t("creativeConsole.referenceVoice"));
    expect(trigger).toHaveTextContent("Ara");
    openSelect(trigger);

    expect(await screen.findByRole("option", { name: "Eve" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Ara" })).toBeInTheDocument();
  });

  it("没有可用音色时回退到默认音色，并保留不使用参考音色选项", async () => {
    renderNode(<ReferenceVoiceSelect controller={createController({ voices: [], hasReferenceAudio: true })} />);

    const trigger = screen.getByTestId("video-reference-voice-select");
    openSelect(trigger);

    expect(
      await screen.findByRole("option", { name: i18n.t("creativeConsole.referenceVoiceNone") }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Eve" })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: "Ara" })).toBeInTheDocument();
  });

  it("已有首帧图时参考音色不可选，也不会打开弹层", () => {
    renderNode(<ReferenceVoiceSelect controller={createController({ voices, hasFirstFrame: true })} />);

    const trigger = screen.getByTestId("video-reference-voice-select");
    expect(trigger).toBeDisabled();
    openSelect(trigger);
    expect(screen.queryByRole("option", { name: "Ara" })).not.toBeInTheDocument();
  });
});
