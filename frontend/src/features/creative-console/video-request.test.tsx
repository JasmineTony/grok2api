import { videoCopyKeys } from "@/features/creative-console/video-request";
import {
  applyAttachmentUploadResult,
  applyAttachmentUrlChange,
  applySourceVideoUploadResult,
  applySourceVideoUrl,
  beginAttachmentUpload,
  beginSourceVideoUpload,
  clearVideoAttachment,
  clearVideoSource,
  resolveCanSubmitVideo,
  selectReferenceVoiceOption,
  submitVideoRequest,
  type VideoAttachmentActionContext,
} from "@/features/creative-console/video-request";
import { describe, expect, it, vi } from "vitest";

function createContext() {
  const context: VideoAttachmentActionContext = {
    fields: {
      imageURL: "",
      imageFileID: "",
      referenceURL: "",
      referenceFileID: "",
      referenceVoiceId: "",
      sourceVideoURL: "",
      sourceVideoFileID: "",
    },
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
  return context;
}

describe("视频附件状态流转", () => {
  it("首帧 URL 会清空参考图与参考音色，参考图 URL 不影响参考音色", () => {
    const context = createContext();
    applyAttachmentUrlChange(context, "image", "https://a/1.png");
    expect(context.setters.setImageURL).toHaveBeenCalledWith("https://a/1.png");
    expect(context.setters.setReferenceURL).toHaveBeenCalledWith("");
    expect(context.setters.setReferenceFileID).toHaveBeenCalledWith("");
    expect(context.setters.setReferenceVoiceId).toHaveBeenCalledWith("");
    expect(context.versions).toEqual({ image: 1, reference: 1, video: 0 });

    const reference = createContext();
    applyAttachmentUrlChange(reference, "reference", "https://a/2.png");
    expect(reference.setters.setReferenceURL).toHaveBeenCalledWith("https://a/2.png");
    expect(reference.setters.setImageURL).toHaveBeenCalledWith("");
    expect(reference.setters.setReferenceVoiceId).not.toHaveBeenCalled();
  });

  it("清除附件只影响当前一侧并推进选择版本号", () => {
    const image = createContext();
    clearVideoAttachment(image, "image");
    expect(image.setters.setImageURL).toHaveBeenCalledWith("");
    expect(image.setters.setImageFileID).toHaveBeenCalledWith("");
    expect(image.setters.setReferenceURL).not.toHaveBeenCalled();
    expect(image.versions).toEqual({ image: 1, reference: 0, video: 0 });

    const reference = createContext();
    clearVideoAttachment(reference, "reference");
    expect(reference.setters.setReferenceURL).toHaveBeenCalledWith("");
    expect(reference.versions).toEqual({ image: 0, reference: 1, video: 0 });
  });

  it("选择本地图片时推进版本号并触发上传，旧响应不再覆盖新选择", () => {
    const image = createContext();
    const file = new File(["x"], "a.png", { type: "image/png" });
    beginAttachmentUpload(image, "image", file);
    expect(image.upload).toHaveBeenCalledWith({ file, kind: "image", selectionVersion: 1 });
    expect(image.setters.setReferenceVoiceId).toHaveBeenCalledWith("");

    vi.mocked(image.setters.setImageFileID).mockClear();
    applyAttachmentUploadResult(image, { kind: "image", fileId: "stale", selectionVersion: 0 });
    expect(image.setters.setImageFileID).not.toHaveBeenCalled();

    applyAttachmentUploadResult(image, { kind: "image", fileId: "file-1", selectionVersion: 1 });
    expect(image.setters.setImageFileID).toHaveBeenCalledWith("file-1");
    expect(image.setters.setImageURL).toHaveBeenCalledWith("");

    const reference = createContext();
    beginAttachmentUpload(reference, "reference", file);
    expect(reference.upload).toHaveBeenCalledWith({ file, kind: "reference", selectionVersion: 1 });
    applyAttachmentUploadResult(reference, { kind: "reference", fileId: "file-2", selectionVersion: 1 });
    expect(reference.setters.setReferenceFileID).toHaveBeenCalledWith("file-2");
    vi.mocked(reference.setters.setReferenceFileID).mockClear();
    applyAttachmentUploadResult(reference, { kind: "reference", fileId: "x", selectionVersion: 0 });
    expect(reference.setters.setReferenceFileID).not.toHaveBeenCalled();
  });

  it("参考音色选择 none 不会清空首帧，选择具体音色会清空首帧", () => {
    const none = createContext();
    selectReferenceVoiceOption(none, "__none__");
    expect(none.setters.setReferenceVoiceId).toHaveBeenCalledWith("");
    expect(none.setters.setImageURL).not.toHaveBeenCalled();

    const picked = createContext();
    selectReferenceVoiceOption(picked, "eve");
    expect(picked.setters.setReferenceVoiceId).toHaveBeenCalledWith("eve");
    expect(picked.setters.setImageURL).toHaveBeenCalledWith("");
    expect(picked.setters.setImageFileID).toHaveBeenCalledWith("");
  });

  it("源视频 URL 与本地文件互斥，并保留版本号语义", () => {
    const context = createContext();
    applySourceVideoUrl(context, "https://a/v.mp4");
    expect(context.setters.setSourceVideoURL).toHaveBeenCalledWith("https://a/v.mp4");
    expect(context.setters.setSourceVideoFileID).toHaveBeenCalledWith("");
    expect(context.versions.video).toBe(1);

    clearVideoSource(context);
    expect(context.setters.setSourceVideoURL).toHaveBeenLastCalledWith("");
    expect(context.versions.video).toBe(2);

    const file = new File(["v"], "v.mp4", { type: "video/mp4" });
    beginSourceVideoUpload(context, file);
    expect(context.videoUpload).toHaveBeenCalledWith({ file, selectionVersion: 3 });

    vi.mocked(context.setters.setSourceVideoFileID).mockClear();
    applySourceVideoUploadResult(context, "file-3", 2);
    expect(context.setters.setSourceVideoFileID).not.toHaveBeenCalled();
    applySourceVideoUploadResult(context, "file-3", 3);
    expect(context.setters.setSourceVideoFileID).toHaveBeenCalledWith("file-3");
  });
});

describe("视频提交条件与复制文案", () => {
  const base = {
    apiKey: "k",
    activeModel: "m",
    busy: false,
    action: "generate" as const,
    prompt: "海浪",
    hasFirstFrame: false,
    isReferenceMode: false,
    sourceReady: false,
    duration: "6",
    extendDuration: "6",
  };

  it("生成模式要求提示词或首帧，且首帧与参考模式互斥", () => {
    expect(resolveCanSubmitVideo(base)).toBe(true);
    expect(resolveCanSubmitVideo({ ...base, prompt: "", hasFirstFrame: true })).toBe(true);
    expect(resolveCanSubmitVideo({ ...base, prompt: "", hasFirstFrame: true, isReferenceMode: true })).toBe(false);
    expect(resolveCanSubmitVideo({ ...base, prompt: "", isReferenceMode: true })).toBe(false);
    expect(resolveCanSubmitVideo({ ...base, duration: "0" })).toBe(false);
    expect(resolveCanSubmitVideo({ ...base, prompt: "" })).toBe(false);
    expect(resolveCanSubmitVideo({ ...base, busy: true })).toBe(false);
    expect(resolveCanSubmitVideo({ ...base, apiKey: "" })).toBe(false);
  });

  it("编辑/续写模式要求提示词与源视频，续写时长限制 2..10 秒", () => {
    const edit = { ...base, action: "edit" as const, sourceReady: true };
    expect(resolveCanSubmitVideo(edit)).toBe(true);
    expect(resolveCanSubmitVideo({ ...edit, sourceReady: false })).toBe(false);
    expect(resolveCanSubmitVideo({ ...edit, prompt: "  " })).toBe(false);
    const extend = { ...edit, action: "extend" as const, extendDuration: "4" };
    expect(resolveCanSubmitVideo(extend)).toBe(true);
    expect(resolveCanSubmitVideo({ ...extend, extendDuration: "1" })).toBe(false);
    expect(resolveCanSubmitVideo({ ...extend, extendDuration: "11" })).toBe(false);
  });

  it("提交前再次校验并只发起一次请求", () => {
    const reset = vi.fn();
    const submit = vi.fn();
    const event = { preventDefault: vi.fn() } as never;
    const params = {
      event,
      apiKey: "k",
      activeModel: "m",
      action: "generate" as const,
      prompt: "海浪",
      duration: "6",
      extendDuration: "6",
      hasFirstFrame: false,
      isReferenceMode: false,
      sourceReady: false,
      pending: false,
      reset,
      submit,
    };

    submitVideoRequest(params);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);

    reset.mockClear();
    submit.mockClear();
    submitVideoRequest({ ...params, pending: true });
    expect(submit).not.toHaveBeenCalled();

    submitVideoRequest({ ...params, action: "edit", sourceReady: false });
    expect(submit).not.toHaveBeenCalled();

    submitVideoRequest({ ...params, action: "extend", extendDuration: "99", sourceReady: true });
    expect(submit).not.toHaveBeenCalled();

    submitVideoRequest({ ...params, action: "edit", sourceReady: true });
    expect(submit).toHaveBeenCalledTimes(1);

    submitVideoRequest({ ...params, action: "generate", prompt: "", hasFirstFrame: false, isReferenceMode: false });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("三种动作各有独立的占位与提交文案键", () => {
    expect(videoCopyKeys.generate.submit).toBe("creativeConsole.generateVideo");
    expect(videoCopyKeys.edit.submit).toBe("creativeConsole.editVideo");
    expect(videoCopyKeys.extend.submit).toBe("creativeConsole.extendVideo");
    expect(new Set(Object.values(videoCopyKeys).map((copy) => copy.welcome)).size).toBe(3);
  });
});
