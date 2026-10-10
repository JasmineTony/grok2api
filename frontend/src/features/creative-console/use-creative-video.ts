import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { ModelRouteDTO } from "@/entities/model/types";
import { readErrorMessage } from "@/features/creative-console/creative-api-core";
import {
  getVideo,
  listVoices,
  type VideoStatus,
  type VoiceInfo,
} from "@/features/creative-console/creative-console-api";
import { uniqueModelsByPublicID } from "@/features/creative-console/creative-model-scope";
import { videoResolutions, type VideoAction } from "@/features/creative-console/creative-panel-contract";
import { pickAvailableModel, selectVideoEditModels } from "@/features/creative-console/creative-model-scope";
import {
  applyAttachmentUploadResult,
  applySourceVideoUploadResult,
  createVideoAttachmentOperations,
  createVideoSubmitOperations,
  requestVideoTask,
  videoCopyKeys,
  type VideoAttachmentActionContext,
  type VideoAttachmentFields,
  type VideoAttachmentKind,
  type VideoAttachmentSetters,
  type VideoFormFields,
  type VideoFormSetters,
  type VideoSelectionVersions,
} from "@/features/creative-console/video-request";
import { uploadMediaInput } from "@/features/media/media-api";

export type CreativeVideoJob = { requestId: string; apiKey: string };

export type { VideoAttachmentKind };

export type CreativeVideoController = VideoFormFields &
  VideoFormSetters &
  VideoAttachmentFields &
  VideoAttachmentSetters & {
    hasFirstFrame: boolean;
    hasReferenceImage: boolean;
    hasReferenceAudio: boolean;
    isReferenceMode: boolean;
    voices: VoiceInfo[];
    activeModel: string;
    activeModels: ModelRouteDTO[];
    generateResolutions: readonly string[];
    selectedResolution: string;
    job: CreativeVideoJob | null;
    status: VideoStatus | undefined;
    statusLoading: boolean;
    statusError: string;
    retryStatus: () => void;
    isSubmitting: boolean;
    uploadPending: boolean;
    videoUploadPending: boolean;
    createError: string;
    uploadError: string;
    videoUploadError: string;
    placeholder: string;
    welcome: string;
    submitLabel: string;
    canSubmit: boolean;
    submit: (event: FormEvent) => void;
    changeAction: (action: VideoAction) => void;
    selectReferenceVoice: (value: string) => void;
    setAttachmentURL: (kind: VideoAttachmentKind, value: string) => void;
    clearAttachment: (kind: VideoAttachmentKind) => void;
    pickAttachmentFile: (kind: VideoAttachmentKind, file: File) => void;
    setSourceVideoURL: (value: string) => void;
    clearSourceVideo: () => void;
    pickSourceVideo: (file: File) => void;
  };

type VideoFormState = { fields: VideoFormFields; setters: VideoFormSetters };
type VideoAttachmentState = { fields: VideoAttachmentFields; setters: VideoAttachmentSetters };

type VideoModelScope = {
  voices: VoiceInfo[];
  activeModel: string;
  activeModels: ModelRouteDTO[];
  generateResolutions: readonly string[];
  selectedResolution: string;
  hasFirstFrame: boolean;
  hasReferenceImage: boolean;
  hasReferenceAudio: boolean;
  isReferenceMode: boolean;
};

type VideoSelectionState = {
  form: VideoFormState;
  attachments: VideoAttachmentState;
  uploads: ReturnType<typeof useVideoAttachmentUploads>;
  models: VideoModelScope;
  attachmentOperations: ReturnType<typeof createVideoAttachmentOperations>;
};

type VideoTaskState = {
  create: ReturnType<typeof useVideoCreateRequest>;
  status: ReturnType<typeof useVideoStatusRequest>;
  submitOperations: ReturnType<typeof createVideoSubmitOperations>;
};

function useVideoForm(): VideoFormState {
  const [action, setAction] = useState<VideoAction>("generate");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState("6");
  const [extendDuration, setExtendDuration] = useState("6");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("720p");
  return {
    fields: { action, prompt, duration, extendDuration, aspectRatio, resolution },
    setters: { setAction, setPrompt, setDuration, setExtendDuration, setAspectRatio, setResolution },
  };
}

function useVideoAttachments(): VideoAttachmentState {
  const [imageURL, setImageURL] = useState("");
  const [imageFileID, setImageFileID] = useState("");
  const [referenceURL, setReferenceURL] = useState("");
  const [referenceFileID, setReferenceFileID] = useState("");
  const [referenceVoiceId, setReferenceVoiceId] = useState("");
  const [sourceVideoURL, setSourceVideoURL] = useState("");
  const [sourceVideoFileID, setSourceVideoFileID] = useState("");
  return {
    fields: {
      imageURL,
      imageFileID,
      referenceURL,
      referenceFileID,
      referenceVoiceId,
      sourceVideoURL,
      sourceVideoFileID,
    },
    setters: {
      setImageURL,
      setImageFileID,
      setReferenceURL,
      setReferenceFileID,
      setReferenceVoiceId,
      setSourceVideoURL,
      setSourceVideoFileID,
    },
  };
}

function useVideoVoices(apiKey: string, action: VideoAction): VoiceInfo[] {
  const voicesQuery = useQuery({
    queryKey: ["creative-console", "video-voices", apiKey],
    queryFn: ({ signal }) => listVoices({ apiKey, model: "grok-voice-latest", signal }),
    enabled: Boolean(apiKey && action === "generate"),
    staleTime: 60_000,
  });
  return voicesQuery.data ?? [];
}

/** 生成与编辑/续写的候选路由不同，参考图或参考音色会排除 1080p。 */
function useVideoModels(params: {
  model: string;
  modelOptions: ModelRouteDTO[];
  action: VideoAction;
  apiKey: string;
  form: VideoFormFields;
  attachments: VideoAttachmentFields;
  onModelChange: (model: string) => void;
}): VideoModelScope {
  const { action, apiKey, attachments, form, model, modelOptions, onModelChange } = params;
  const generateModels = useMemo(
    () => uniqueModelsByPublicID(modelOptions.filter((item) => item.capability === "video")),
    [modelOptions],
  );
  const editModels = useMemo(() => selectVideoEditModels(modelOptions), [modelOptions]);
  const activeModels = action === "generate" ? generateModels : editModels;
  const activeModel = pickAvailableModel(activeModels, model);
  useEffect(() => {
    if (activeModel && activeModel !== model) onModelChange(activeModel);
  }, [activeModel, model, onModelChange]);
  const voices = useVideoVoices(apiKey, action);
  const hasFirstFrame = Boolean(attachments.imageURL.trim() || attachments.imageFileID);
  const hasReferenceImage = Boolean(attachments.referenceURL.trim() || attachments.referenceFileID);
  const hasReferenceAudio = Boolean(attachments.referenceVoiceId.trim());
  const isReferenceMode = hasReferenceImage || hasReferenceAudio;
  return {
    voices,
    activeModel,
    activeModels,
    generateResolutions: isReferenceMode ? videoResolutions.filter((item) => item !== "1080p") : videoResolutions,
    selectedResolution: isReferenceMode && form.resolution === "1080p" ? "720p" : form.resolution,
    hasFirstFrame,
    hasReferenceImage,
    hasReferenceAudio,
    isReferenceMode,
  };
}

/** 本地媒体上传：带选择版本号，旧响应不会覆盖同一侧的新选择。 */
function useVideoAttachmentUploads(params: {
  onAttachment: (input: { kind: VideoAttachmentKind; fileId: string; selectionVersion: number }) => void;
  onSourceVideo: (fileId: string, selectionVersion: number) => void;
}): {
  upload: (input: { file: File; kind: VideoAttachmentKind; selectionVersion: number }) => void;
  videoUpload: (input: { file: File; selectionVersion: number }) => void;
  uploadPending: boolean;
  videoUploadPending: boolean;
  uploadError: string;
  videoUploadError: string;
} {
  const { t } = useTranslation();
  const attachmentMutation = useMutation({
    mutationFn: async (input: { file: File; kind: VideoAttachmentKind; selectionVersion: number }) => {
      if (input.file.type && !input.file.type.startsWith("image/")) {
        throw new Error(t("creativeConsole.errors.invalidImage"));
      }
      const uploaded = await uploadMediaInput(input.file);
      if (uploaded.kind !== "image") throw new Error(t("creativeConsole.errors.invalidImage"));
      return { kind: input.kind, fileId: uploaded.fileId, selectionVersion: input.selectionVersion };
    },
    onSuccess: params.onAttachment,
  });
  const videoMutation = useMutation({
    mutationFn: async (input: { file: File; selectionVersion: number }) => {
      if (input.file.type && !input.file.type.startsWith("video/")) {
        throw new Error(t("creativeConsole.errors.invalidVideo"));
      }
      const uploaded = await uploadMediaInput(input.file);
      if (uploaded.kind !== "video") throw new Error(t("creativeConsole.errors.invalidVideo"));
      return { fileId: uploaded.fileId, selectionVersion: input.selectionVersion };
    },
    onSuccess: (result) => params.onSourceVideo(result.fileId, result.selectionVersion),
  });
  return {
    upload: attachmentMutation.mutate,
    videoUpload: videoMutation.mutate,
    uploadPending: attachmentMutation.isPending,
    videoUploadPending: videoMutation.isPending,
    uploadError: attachmentMutation.isError ? readErrorMessage(attachmentMutation.error) : "",
    videoUploadError: videoMutation.isError ? readErrorMessage(videoMutation.error) : "",
  };
}

function useVideoCreateRequest(params: {
  apiKey: string;
  activeModel: string;
  form: VideoFormFields;
  attachments: VideoAttachmentFields;
  selectedResolution: string;
}): {
  job: CreativeVideoJob | null;
  setJob: (job: CreativeVideoJob | null) => void;
  isSubmitting: boolean;
  createError: string;
  reset: () => void;
  submit: () => void;
} {
  const { t } = useTranslation();
  const [job, setJob] = useState<CreativeVideoJob | null>(null);
  const mutation = useMutation({
    mutationFn: () =>
      requestVideoTask({
        apiKey: params.apiKey,
        activeModel: params.activeModel,
        form: params.form,
        attachments: params.attachments,
        selectedResolution: params.selectedResolution,
        noModelsMessage: t("creativeConsole.errors.noModels"),
        noSourceVideoMessage: t("creativeConsole.errors.noSourceVideo"),
      }),
    onSuccess: (requestId) => setJob({ requestId, apiKey: params.apiKey }),
  });
  return {
    job,
    setJob,
    isSubmitting: mutation.isPending,
    createError: mutation.isError ? readErrorMessage(mutation.error) : "",
    reset: mutation.reset,
    submit: mutation.mutate,
  };
}

function useVideoStatusRequest(
  apiKey: string,
  job: CreativeVideoJob | null,
): { status: VideoStatus | undefined; loading: boolean; error: string; retry: () => void } {
  const statusQuery = useQuery({
    queryKey: ["creative-console", "video", job?.requestId],
    queryFn: ({ signal }) => getVideo({ apiKey: job?.apiKey ?? apiKey, requestId: job?.requestId ?? "", signal }),
    enabled: Boolean(job),
    refetchInterval: (query) => (query.state.data?.status === "pending" ? 3_000 : false),
    retry: 2,
  });
  return {
    status: statusQuery.data,
    loading: statusQuery.isPending || statusQuery.isFetching,
    error: statusQuery.isError ? readErrorMessage(statusQuery.error) : "",
    retry: () => void statusQuery.refetch(),
  };
}

function useVideoSelectionState(input: {
  apiKey: string;
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
}): VideoSelectionState {
  const form = useVideoForm();
  const attachments = useVideoAttachments();
  const [versions] = useState<VideoSelectionVersions>(() => ({ image: 0, reference: 0, video: 0 }));
  const uploads = useVideoAttachmentUploads({
    onAttachment: (result) => applyAttachmentUploadResult({ setters: attachments.setters, versions }, result),
    onSourceVideo: (fileId, selectionVersion) =>
      applySourceVideoUploadResult({ setters: attachments.setters, versions }, fileId, selectionVersion),
  });
  const attachmentContext: VideoAttachmentActionContext = {
    fields: attachments.fields,
    setters: attachments.setters,
    versions,
    upload: uploads.upload,
    videoUpload: uploads.videoUpload,
  };
  const models = useVideoModels({
    model: input.model,
    modelOptions: input.modelOptions,
    action: form.fields.action,
    apiKey: input.apiKey,
    form: form.fields,
    attachments: attachments.fields,
    onModelChange: input.onModelChange,
  });
  return {
    form,
    attachments,
    uploads,
    models,
    attachmentOperations: createVideoAttachmentOperations(attachmentContext),
  };
}

function useVideoTaskState(params: {
  apiKey: string;
  selection: VideoSelectionState;
  pending: boolean;
}): VideoTaskState {
  const { selection } = params;
  const create = useVideoCreateRequest({
    apiKey: params.apiKey,
    activeModel: selection.models.activeModel,
    form: selection.form.fields,
    attachments: selection.attachments.fields,
    selectedResolution: selection.models.selectedResolution,
  });
  const status = useVideoStatusRequest(params.apiKey, create.job);
  const pending = params.pending || create.isSubmitting;
  const submitOperations = createVideoSubmitOperations({
    apiKey: params.apiKey,
    form: selection.form.fields,
    formSetters: selection.form.setters,
    attachments: selection.attachments.fields,
    activeModel: selection.models.activeModel,
    hasFirstFrame: selection.models.hasFirstFrame,
    isReferenceMode: selection.models.isReferenceMode,
    pending,
    setJob: create.setJob,
    reset: create.reset,
    submit: create.submit,
  });
  return { create, status, submitOperations };
}

/** 视频生成/编辑/续写：本地媒体先进入有 TTL 的临时区，任务只持久化短 file_id。 */
export function useCreativeVideo(input: {
  apiKey: string;
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
}): CreativeVideoController {
  const { t } = useTranslation();
  const selection = useVideoSelectionState(input);
  const pending = selection.uploads.uploadPending || selection.uploads.videoUploadPending;
  const task = useVideoTaskState({ apiKey: input.apiKey, selection, pending });
  const copy = videoCopyKeys[selection.form.fields.action];
  return {
    ...selection.form.fields,
    ...selection.form.setters,
    ...selection.attachments.fields,
    ...selection.attachments.setters,
    ...selection.models,
    ...selection.attachmentOperations,
    ...task.submitOperations,
    job: task.create.job,
    status: task.status.status,
    statusLoading: task.status.loading,
    statusError: task.status.error,
    retryStatus: task.status.retry,
    isSubmitting: task.create.isSubmitting,
    uploadPending: selection.uploads.uploadPending,
    videoUploadPending: selection.uploads.videoUploadPending,
    createError: task.create.createError,
    uploadError: selection.uploads.uploadError,
    videoUploadError: selection.uploads.videoUploadError,
    placeholder: t(copy.placeholder),
    welcome: t(copy.welcome),
    submitLabel: t(copy.submit),
  };
}
