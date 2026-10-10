import {
  createVideoAttachmentOperations,
  createVideoSubmitOperations,
  requestVideoGeneration,
  requestVideoTask,
  submitVideoRequest,
  type VideoAttachmentActionContext,
  type VideoAttachmentFields,
  type VideoFormFields,
} from "@/features/creative-console/video-request";
import { importVideoInputFromURL } from "@/features/media/media-api";
import type { FormEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  createVideo: vi.fn(),
  editVideo: vi.fn(),
  extendVideo: vi.fn(),
}));

vi.mock("@/features/creative-console/creative-console-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/creative-console/creative-console-api")>()),
  ...apiMock,
}));

const mediaMock = vi.hoisted(() => ({ importVideoInputFromURL: vi.fn() }));

vi.mock("@/features/media/media-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/media/media-api")>()),
  ...mediaMock,
}));

function attachments(overrides: Partial<VideoAttachmentFields> = {}): VideoAttachmentFields {
  return {
    imageURL: "",
    imageFileID: "",
    referenceURL: "",
    referenceFileID: "",
    referenceVoiceId: "",
    sourceVideoURL: "",
    sourceVideoFileID: "",
    ...overrides,
  };
}

function form(overrides: Partial<VideoFormFields> = {}): VideoFormFields {
  return {
    action: "generate",
    prompt: "  海浪  ",
    duration: "8",
    extendDuration: "6",
    aspectRatio: "16:9",
    resolution: "1080p",
    ...overrides,
  };
}

beforeEach(() => {
  apiMock.createVideo.mockReset().mockResolvedValue("req-1");
  apiMock.editVideo.mockReset().mockResolvedValue("req-2");
  apiMock.extendVideo.mockReset().mockResolvedValue("req-3");
  mediaMock.importVideoInputFromURL.mockReset().mockResolvedValue({ fileId: "staged-file" });
});

describe("生成请求组装", () => {
  it("首帧占用时参考图与参考音色一起被清空", async () => {
    await requestVideoGeneration({
      apiKey: "k",
      model: "video-model",
      prompt: "  海浪  ",
      imageURL: "",
      imageFileID: "image-file",
      referenceURL: "https://a/ref.png",
      referenceFileID: "reference-file",
      referenceVoiceId: "eve",
      duration: "8",
      aspectRatio: "16:9",
      resolution: "720p",
    });

    expect(apiMock.createVideo).toHaveBeenCalledWith({
      apiKey: "k",
      model: "video-model",
      prompt: "海浪",
      imageURL: undefined,
      imageFileID: "image-file",
      referenceImages: undefined,
      referenceVoiceIds: undefined,
      duration: 8,
      aspectRatio: "16:9",
      resolution: "720p",
    });
  });

  it("http 首帧地址先落到临时媒体区并换成 file_id", async () => {
    await requestVideoGeneration({
      apiKey: "k",
      model: "video-model",
      prompt: "海浪",
      imageURL: "https://a/first.png",
      imageFileID: "",
      referenceURL: "",
      referenceFileID: "",
      referenceVoiceId: "",
      duration: "6",
      aspectRatio: "1:1",
      resolution: "1k",
    });

    expect(importVideoInputFromURL).toHaveBeenCalledWith("https://a/first.png");
    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({ imageURL: undefined, imageFileID: "staged-file" }),
    );
  });

  it("非 http 首帧地址按原样传入，不触发暂存", async () => {
    await requestVideoGeneration({
      apiKey: "k",
      model: "video-model",
      prompt: "海浪",
      imageURL: "data:image/png;base64,QUJD",
      imageFileID: "",
      referenceURL: "",
      referenceFileID: "",
      referenceVoiceId: "",
      duration: "6",
      aspectRatio: "1:1",
      resolution: "1k",
    });

    expect(importVideoInputFromURL).not.toHaveBeenCalled();
    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({ imageURL: "data:image/png;base64,QUJD", imageFileID: undefined }),
    );
  });

  it("参考图与参考音色按选定形式提交", async () => {
    await requestVideoGeneration({
      apiKey: "k",
      model: "video-model",
      prompt: "海浪",
      imageURL: "",
      imageFileID: "",
      referenceURL: "https://a/ref.png",
      referenceFileID: "",
      referenceVoiceId: "eve",
      duration: "6",
      aspectRatio: "16:9",
      resolution: "720p",
    });

    expect(importVideoInputFromURL).toHaveBeenCalledWith("https://a/ref.png");
    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: [{ fileId: "staged-file" }], referenceVoiceIds: ["eve"] }),
    );

    apiMock.createVideo.mockClear();
    mediaMock.importVideoInputFromURL.mockClear();
    await requestVideoGeneration({
      apiKey: "k",
      model: "video-model",
      prompt: "海浪",
      imageURL: "",
      imageFileID: "",
      referenceURL: "blob:local-id",
      referenceFileID: "",
      referenceVoiceId: "",
      duration: "6",
      aspectRatio: "16:9",
      resolution: "720p",
    });

    expect(importVideoInputFromURL).not.toHaveBeenCalled();
    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({ referenceImages: [{ url: "blob:local-id" }], referenceVoiceIds: undefined }),
    );
  });

  it("首帧已有 file_id 时不再暂存 http 地址，同时清空参考侧", async () => {
    await requestVideoGeneration({
      apiKey: "k",
      model: "video-model",
      prompt: "海浪",
      imageURL: "https://a/first.png",
      imageFileID: "image-file",
      referenceURL: "   ",
      referenceFileID: "",
      referenceVoiceId: "  ",
      duration: "6",
      aspectRatio: "16:9",
      resolution: "720p",
    });

    expect(importVideoInputFromURL).not.toHaveBeenCalled();
    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        imageURL: "https://a/first.png",
        imageFileID: "image-file",
        referenceImages: undefined,
        referenceVoiceIds: undefined,
      }),
    );
  });
});

describe("任务提交", () => {
  const context = {
    apiKey: "k",
    activeModel: "video-model",
    form: form(),
    attachments: attachments(),
    selectedResolution: "720p",
    noModelsMessage: "没有可用模型",
    noSourceVideoMessage: "请先添加源视频",
  };

  it("缺少密钥或模型时给出与界面一致的中文错误", async () => {
    await expect(requestVideoTask({ ...context, apiKey: "" })).rejects.toThrow("没有可用模型");
    await expect(requestVideoTask({ ...context, activeModel: "" })).rejects.toThrow("没有可用模型");
    expect(apiMock.createVideo).not.toHaveBeenCalled();
  });

  it("生成动作使用附件、所选分辨率与提示词，首帧占用时清空参考音色", async () => {
    await requestVideoTask({
      ...context,
      attachments: attachments({ imageFileID: "image-file", referenceVoiceId: "eve" }),
    });

    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "海浪",
        imageFileID: "image-file",
        referenceVoiceIds: undefined,
        resolution: "720p",
        duration: 8,
      }),
    );

    apiMock.createVideo.mockClear();
    await requestVideoTask({ ...context, attachments: attachments({ referenceVoiceId: "eve" }) });
    expect(apiMock.createVideo).toHaveBeenCalledWith(
      expect.objectContaining({ referenceVoiceIds: ["eve"], imageFileID: undefined }),
    );
  });

  it("编辑与续写缺少源视频时报错，不发起请求", async () => {
    await expect(requestVideoTask({ ...context, form: form({ action: "edit" }) })).rejects.toThrow("请先添加源视频");
    await expect(requestVideoTask({ ...context, form: form({ action: "extend" }) })).rejects.toThrow("请先添加源视频");
    expect(apiMock.editVideo).not.toHaveBeenCalled();
    expect(apiMock.extendVideo).not.toHaveBeenCalled();
  });

  it("编辑动作提交源视频地址或 file_id", async () => {
    await requestVideoTask({
      ...context,
      form: form({ action: "edit" }),
      attachments: attachments({ sourceVideoURL: "https://a/v.mp4" }),
    });
    expect(apiMock.editVideo).toHaveBeenCalledWith({
      apiKey: "k",
      model: "video-model",
      prompt: "海浪",
      videoURL: "https://a/v.mp4",
      videoFileID: undefined,
    });

    apiMock.editVideo.mockClear();
    await requestVideoTask({
      ...context,
      form: form({ action: "edit" }),
      attachments: attachments({ sourceVideoFileID: "source-file" }),
    });
    expect(apiMock.editVideo).toHaveBeenCalledWith(expect.objectContaining({ videoFileID: "source-file" }));
  });

  it("续写动作带上续写时长", async () => {
    await requestVideoTask({
      ...context,
      form: form({ action: "extend", extendDuration: "4" }),
      attachments: attachments({ sourceVideoFileID: "source-file" }),
    });

    expect(apiMock.extendVideo).toHaveBeenCalledWith(
      expect.objectContaining({ videoFileID: "source-file", duration: 4 }),
    );
  });
});

describe("提交操作表", () => {
  function createSubmitContext(overrides: { pending?: boolean; action?: VideoFormFields["action"] } = {}) {
    const setAction = vi.fn();
    const setJob = vi.fn();
    const reset = vi.fn();
    const submit = vi.fn();
    const operations = createVideoSubmitOperations({
      apiKey: "k",
      form: form({ action: overrides.action ?? "generate" }),
      formSetters: {
        setAction,
        setPrompt: vi.fn(),
        setDuration: vi.fn(),
        setExtendDuration: vi.fn(),
        setAspectRatio: vi.fn(),
        setResolution: vi.fn(),
      },
      attachments: attachments(),
      activeModel: "video-model",
      hasFirstFrame: false,
      isReferenceMode: false,
      pending: overrides.pending ?? false,
      setJob,
      reset,
      submit,
    });
    return { operations, setAction, setJob, reset, submit };
  }

  it("提交合法时重置并只发起一次请求", () => {
    const { operations, reset, submit } = createSubmitContext();
    operations.submit({ preventDefault: vi.fn() } as unknown as FormEvent);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(operations.canSubmit).toBe(true);
  });

  it("请求在途时既不重置也不提交", () => {
    const { operations, reset, submit } = createSubmitContext({ pending: true });
    operations.submit({ preventDefault: vi.fn() } as unknown as FormEvent);
    expect(reset).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(operations.canSubmit).toBe(false);
  });

  it("切换动作会重置任务与表单提交状态", () => {
    const { operations, setAction, setJob, reset } = createSubmitContext();
    operations.changeAction("extend");
    expect(setAction).toHaveBeenCalledWith("extend");
    expect(setJob).toHaveBeenCalledWith(null);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe("附件操作表与参考模式提交", () => {
  function createAttachmentContext(): VideoAttachmentActionContext {
    return {
      fields: attachments(),
      setters: {
        setImageURL: vi.fn(),
        setImageFileID: vi.fn(),
        setReferenceURL: vi.fn(),
        setReferenceFileID: vi.fn(),
        setReferenceVoiceId: vi.fn(),
        setSourceVideoURL: vi.fn(),
        setSourceVideoFileID: vi.fn(),
      },
      versions: { image: 0, reference: 0, video: 0 },
      upload: vi.fn(),
      videoUpload: vi.fn(),
    };
  }

  it("附件操作表把界面交互委托到已有状态流转", () => {
    const context = createAttachmentContext();
    const operations = createVideoAttachmentOperations(context);

    operations.selectReferenceVoice("eve");
    expect(context.setters.setReferenceVoiceId).toHaveBeenCalledWith("eve");

    operations.selectReferenceVoice("__none__");
    expect(context.setters.setReferenceVoiceId).toHaveBeenLastCalledWith("");

    operations.clearAttachment("reference");
    expect(context.setters.setReferenceURL).toHaveBeenCalledWith("");

    operations.clearSourceVideo();
    expect(context.setters.setSourceVideoURL).toHaveBeenCalledWith("");

    operations.setSourceVideoURL("https://a/v.mp4");
    expect(context.setters.setSourceVideoURL).toHaveBeenLastCalledWith("https://a/v.mp4");
  });

  it("参考模式缺少提示词时不提交，补上提示词后正常提交", () => {
    const reset = vi.fn();
    const submit = vi.fn();
    const base = {
      event: { preventDefault: vi.fn() } as unknown as FormEvent,
      apiKey: "k",
      activeModel: "video-model",
      action: "generate" as const,
      prompt: "   ",
      duration: "6",
      extendDuration: "6",
      hasFirstFrame: false,
      isReferenceMode: true,
      sourceReady: false,
      pending: false,
      reset,
      submit,
    };

    submitVideoRequest(base);
    expect(reset).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    submitVideoRequest({ ...base, prompt: "海浪" });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
