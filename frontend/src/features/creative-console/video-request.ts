import type { FormEvent } from "react";

import { createVideo, editVideo, extendVideo } from "@/features/creative-console/creative-console-api";
import { validDuration } from "@/features/creative-console/chat-session-model";
import type { VideoAction } from "@/features/creative-console/creative-panel-contract";
import { importVideoInputFromURL } from "@/features/media/media-api";

export type VideoAttachmentKind = "image" | "reference";

export type VideoFormFields = {
  action: VideoAction;
  prompt: string;
  duration: string;
  extendDuration: string;
  aspectRatio: string;
  resolution: string;
};

export type VideoFormSetters = {
  setAction: (action: VideoAction) => void;
  setPrompt: (value: string) => void;
  setDuration: (value: string) => void;
  setExtendDuration: (value: string) => void;
  setAspectRatio: (value: string) => void;
  setResolution: (value: string) => void;
};

export type VideoAttachmentFields = {
  imageURL: string;
  imageFileID: string;
  referenceURL: string;
  referenceFileID: string;
  referenceVoiceId: string;
  sourceVideoURL: string;
  sourceVideoFileID: string;
};

export type VideoAttachmentSetters = {
  setImageURL: (value: string) => void;
  setImageFileID: (value: string) => void;
  setReferenceURL: (value: string) => void;
  setReferenceFileID: (value: string) => void;
  setReferenceVoiceId: (value: string) => void;
  setSourceVideoURL: (value: string) => void;
  setSourceVideoFileID: (value: string) => void;
};

export type VideoSelectionVersions = { image: number; reference: number; video: number };

export type VideoAttachmentActionContext = {
  fields: VideoAttachmentFields;
  setters: VideoAttachmentSetters;
  versions: VideoSelectionVersions;
  upload: (input: { file: File; kind: VideoAttachmentKind; selectionVersion: number }) => void;
  videoUpload: (input: { file: File; selectionVersion: number }) => void;
};

export type VideoAttachmentResultContext = {
  setters: VideoAttachmentSetters;
  versions: VideoSelectionVersions;
};

export type VideoRequestContext = {
  apiKey: string;
  activeModel: string;
  form: VideoFormFields;
  attachments: VideoAttachmentFields;
  selectedResolution: string;
  noModelsMessage: string;
  noSourceVideoMessage: string;
};

/** 生成请求：首帧/参考图互斥，http(s) 图片先落到临时媒体区换成 file_id。 */
export async function requestVideoGeneration(params: {
  apiKey: string;
  model: string;
  prompt: string;
  imageURL: string;
  imageFileID: string;
  referenceURL: string;
  referenceFileID: string;
  referenceVoiceId: string;
  duration: string;
  aspectRatio: string;
  resolution: string;
}): Promise<string> {
  let nextImageURL = params.imageURL.trim() || undefined;
  let nextImageFileID = params.imageFileID || undefined;
  let nextReferenceURL = params.referenceURL.trim() || undefined;
  let nextReferenceFileID = params.referenceFileID || undefined;
  let nextReferenceVoice = params.referenceVoiceId.trim() || undefined;
  if (nextImageFileID || nextImageURL) {
    nextReferenceURL = undefined;
    nextReferenceFileID = undefined;
    nextReferenceVoice = undefined;
  }
  const stagedImageURL = nextImageURL;
  if (!nextImageFileID && stagedImageURL && /^https?:\/\//i.test(stagedImageURL)) {
    nextImageURL = undefined;
    nextImageFileID = (await importVideoInputFromURL(stagedImageURL)).fileId;
  }
  const stagedReferenceURL = nextReferenceURL;
  if (!nextReferenceFileID && stagedReferenceURL && /^https?:\/\//i.test(stagedReferenceURL)) {
    nextReferenceURL = undefined;
    nextReferenceFileID = (await importVideoInputFromURL(stagedReferenceURL)).fileId;
  }
  return createVideo({
    apiKey: params.apiKey,
    model: params.model,
    prompt: params.prompt.trim(),
    imageURL: nextImageURL,
    imageFileID: nextImageFileID,
    referenceImages: nextReferenceFileID
      ? [{ fileId: nextReferenceFileID }]
      : nextReferenceURL
        ? [{ url: nextReferenceURL }]
        : undefined,
    referenceVoiceIds: nextReferenceVoice ? [nextReferenceVoice] : undefined,
    duration: Number(params.duration),
    aspectRatio: params.aspectRatio,
    resolution: params.resolution,
  });
}

/** 生成/编辑/续写共用的任务提交：缺模型或缺源视频时给出与界面一致的中文错误文案。 */
export async function requestVideoTask(context: VideoRequestContext): Promise<string> {
  if (!context.apiKey || !context.activeModel) throw new Error(context.noModelsMessage);
  if (context.form.action === "generate") {
    return requestVideoGeneration({
      apiKey: context.apiKey,
      model: context.activeModel,
      prompt: context.form.prompt,
      imageURL: context.attachments.imageURL,
      imageFileID: context.attachments.imageFileID,
      referenceURL: context.attachments.referenceURL,
      referenceFileID: context.attachments.referenceFileID,
      referenceVoiceId: context.attachments.referenceVoiceId,
      duration: context.form.duration,
      aspectRatio: context.form.aspectRatio,
      resolution: context.selectedResolution,
    });
  }
  const videoURL = context.attachments.sourceVideoURL.trim() || undefined;
  const videoFileID = context.attachments.sourceVideoFileID || undefined;
  if (!videoURL && !videoFileID) throw new Error(context.noSourceVideoMessage);
  const request = {
    apiKey: context.apiKey,
    model: context.activeModel,
    prompt: context.form.prompt.trim(),
    videoURL,
    videoFileID,
  };
  if (context.form.action === "edit") return editVideo(request);
  return extendVideo({ ...request, duration: Number(context.form.extendDuration) });
}

export function resolveCanSubmitVideo(params: {
  apiKey: string;
  activeModel: string;
  busy: boolean;
  action: VideoAction;
  prompt: string;
  hasFirstFrame: boolean;
  isReferenceMode: boolean;
  sourceReady: boolean;
  duration: string;
  extendDuration: string;
}): boolean {
  const hasPrompt = Boolean(params.prompt.trim());
  if (!params.apiKey || !params.activeModel || params.busy) return false;
  if (params.action === "generate") {
    if (!hasPrompt && !params.hasFirstFrame && !params.isReferenceMode) return false;
    if (params.isReferenceMode && !hasPrompt) return false;
    if (!validDuration(params.duration)) return false;
    return !(params.hasFirstFrame && params.isReferenceMode);
  }
  if (!hasPrompt || !params.sourceReady) return false;
  if (params.action === "edit") return true;
  const value = Number(params.extendDuration);
  return value >= 2 && value <= 10;
}

/** 提交前先做与按钮禁用条件一致的兜底校验，避免重复请求与非法时长。 */
export function submitVideoRequest(params: {
  event: FormEvent;
  apiKey: string;
  activeModel: string;
  action: VideoAction;
  prompt: string;
  duration: string;
  extendDuration: string;
  hasFirstFrame: boolean;
  isReferenceMode: boolean;
  sourceReady: boolean;
  pending: boolean;
  reset: () => void;
  submit: () => void;
}): void {
  params.event.preventDefault();
  if (!params.apiKey || !params.activeModel || params.pending) return;
  if (params.action === "generate") {
    if (
      (!params.prompt.trim() && !params.hasFirstFrame && !params.isReferenceMode) ||
      !validDuration(params.duration)
    ) {
      return;
    }
    if (params.isReferenceMode && !params.prompt.trim()) return;
  } else {
    if (!params.prompt.trim() || !params.sourceReady) return;
    if (params.action === "extend") {
      const value = Number(params.extendDuration);
      if (!Number.isFinite(value) || value < 2 || value > 10) return;
    }
  }
  params.reset();
  params.submit();
}

/** URL 输入即视为占用该侧，另一侧与参考音色同步清空（与拆分前一致）。 */
export function applyAttachmentUrlChange(
  context: VideoAttachmentActionContext,
  kind: VideoAttachmentKind,
  value: string,
): void {
  if (kind === "image") {
    context.versions.image += 1;
    context.versions.reference += 1;
    context.setters.setImageURL(value);
    context.setters.setImageFileID("");
    context.setters.setReferenceURL("");
    context.setters.setReferenceFileID("");
    context.setters.setReferenceVoiceId("");
    return;
  }
  context.versions.reference += 1;
  context.versions.image += 1;
  context.setters.setReferenceURL(value);
  context.setters.setReferenceFileID("");
  context.setters.setImageURL("");
  context.setters.setImageFileID("");
}

export function clearVideoAttachment(context: VideoAttachmentActionContext, kind: VideoAttachmentKind): void {
  if (kind === "image") {
    context.versions.image += 1;
    context.setters.setImageURL("");
    context.setters.setImageFileID("");
    return;
  }
  context.versions.reference += 1;
  context.setters.setReferenceURL("");
  context.setters.setReferenceFileID("");
}

/** 本地文件上传带选择版本号：同一侧再次选择时，旧响应不再覆盖新选择。 */
export function beginAttachmentUpload(
  context: VideoAttachmentActionContext,
  kind: VideoAttachmentKind,
  file: File,
): void {
  if (kind === "image") {
    const selectionVersion = context.versions.image + 1;
    context.versions.image = selectionVersion;
    context.versions.reference += 1;
    context.setters.setImageURL("");
    context.setters.setImageFileID("");
    context.setters.setReferenceURL("");
    context.setters.setReferenceFileID("");
    context.setters.setReferenceVoiceId("");
    context.upload({ file, kind: "image", selectionVersion });
    return;
  }
  const selectionVersion = context.versions.reference + 1;
  context.versions.reference = selectionVersion;
  context.versions.image += 1;
  context.setters.setReferenceURL("");
  context.setters.setReferenceFileID("");
  context.setters.setImageURL("");
  context.setters.setImageFileID("");
  context.upload({ file, kind: "reference", selectionVersion });
}

export function applyAttachmentUploadResult(
  context: VideoAttachmentResultContext,
  input: { kind: VideoAttachmentKind; fileId: string; selectionVersion: number },
): void {
  if (input.kind === "image") {
    if (input.selectionVersion !== context.versions.image) return;
    context.setters.setImageFileID(input.fileId);
    context.setters.setImageURL("");
    context.setters.setReferenceURL("");
    context.setters.setReferenceFileID("");
    context.setters.setReferenceVoiceId("");
    return;
  }
  if (input.selectionVersion !== context.versions.reference) return;
  context.setters.setReferenceFileID(input.fileId);
  context.setters.setReferenceURL("");
  context.setters.setImageURL("");
  context.setters.setImageFileID("");
}

export function selectReferenceVoiceOption(context: VideoAttachmentActionContext, value: string): void {
  context.setters.setReferenceVoiceId(value === "__none__" ? "" : value);
  if (value === "__none__") return;
  context.versions.image += 1;
  context.setters.setImageURL("");
  context.setters.setImageFileID("");
}

export function applySourceVideoUrl(context: VideoAttachmentActionContext, value: string): void {
  context.versions.video += 1;
  context.setters.setSourceVideoURL(value);
  context.setters.setSourceVideoFileID("");
}

export function clearVideoSource(context: VideoAttachmentActionContext): void {
  context.versions.video += 1;
  context.setters.setSourceVideoURL("");
  context.setters.setSourceVideoFileID("");
}

export function beginSourceVideoUpload(context: VideoAttachmentActionContext, file: File): void {
  const selectionVersion = context.versions.video + 1;
  context.versions.video = selectionVersion;
  context.setters.setSourceVideoURL("");
  context.setters.setSourceVideoFileID("");
  context.videoUpload({ file, selectionVersion });
}

export function applySourceVideoUploadResult(
  context: VideoAttachmentResultContext,
  fileId: string,
  selectionVersion: number,
): void {
  if (selectionVersion !== context.versions.video) return;
  context.setters.setSourceVideoFileID(fileId);
  context.setters.setSourceVideoURL("");
}

export type VideoSubmitContext = {
  apiKey: string;
  form: VideoFormFields;
  formSetters: VideoFormSetters;
  attachments: VideoAttachmentFields;
  activeModel: string;
  hasFirstFrame: boolean;
  isReferenceMode: boolean;
  pending: boolean;
  setJob: (job: null) => void;
  reset: () => void;
  submit: () => void;
};

export function createVideoAttachmentOperations(context: VideoAttachmentActionContext): {
  selectReferenceVoice: (value: string) => void;
  setAttachmentURL: (kind: VideoAttachmentKind, value: string) => void;
  clearAttachment: (kind: VideoAttachmentKind) => void;
  pickAttachmentFile: (kind: VideoAttachmentKind, file: File) => void;
  setSourceVideoURL: (value: string) => void;
  clearSourceVideo: () => void;
  pickSourceVideo: (file: File) => void;
} {
  return {
    selectReferenceVoice: (value: string) => selectReferenceVoiceOption(context, value),
    setAttachmentURL: (kind: VideoAttachmentKind, value: string) => applyAttachmentUrlChange(context, kind, value),
    clearAttachment: (kind: VideoAttachmentKind) => clearVideoAttachment(context, kind),
    pickAttachmentFile: (kind: VideoAttachmentKind, file: File) => beginAttachmentUpload(context, kind, file),
    setSourceVideoURL: (value: string) => applySourceVideoUrl(context, value),
    clearSourceVideo: () => clearVideoSource(context),
    pickSourceVideo: (file: File) => beginSourceVideoUpload(context, file),
  };
}

export function createVideoSubmitOperations(context: VideoSubmitContext): {
  canSubmit: boolean;
  submit: (event: FormEvent) => void;
  changeAction: (action: VideoAction) => void;
} {
  const sourceReady = Boolean(context.attachments.sourceVideoURL.trim() || context.attachments.sourceVideoFileID);
  return {
    canSubmit: resolveCanSubmitVideo({
      apiKey: context.apiKey,
      activeModel: context.activeModel,
      busy: context.pending,
      action: context.form.action,
      prompt: context.form.prompt,
      hasFirstFrame: context.hasFirstFrame,
      isReferenceMode: context.isReferenceMode,
      sourceReady,
      duration: context.form.duration,
      extendDuration: context.form.extendDuration,
    }),
    submit: (event: FormEvent) =>
      submitVideoRequest({
        event,
        apiKey: context.apiKey,
        activeModel: context.activeModel,
        action: context.form.action,
        prompt: context.form.prompt,
        duration: context.form.duration,
        extendDuration: context.form.extendDuration,
        hasFirstFrame: context.hasFirstFrame,
        isReferenceMode: context.isReferenceMode,
        sourceReady,
        pending: context.pending,
        reset: context.reset,
        submit: context.submit,
      }),
    changeAction: (action: VideoAction) => {
      context.formSetters.setAction(action);
      context.setJob(null);
      context.reset();
    },
  };
}

/** 三种动作的输入框占位、空态与提交文案键（与拆分前保持一致）。 */
export const videoCopyKeys: Record<VideoAction, { placeholder: string; welcome: string; submit: string }> = {
  generate: {
    placeholder: "creativeConsole.videoPlaceholder",
    welcome: "creativeConsole.welcomeVideo",
    submit: "creativeConsole.generateVideo",
  },
  edit: {
    placeholder: "creativeConsole.videoEditPlaceholder",
    welcome: "creativeConsole.welcomeVideoEdit",
    submit: "creativeConsole.editVideo",
  },
  extend: {
    placeholder: "creativeConsole.videoExtendPlaceholder",
    welcome: "creativeConsole.welcomeVideoExtend",
    submit: "creativeConsole.extendVideo",
  },
};
