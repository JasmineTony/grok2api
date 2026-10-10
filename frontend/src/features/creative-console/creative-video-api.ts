import {
  CreativeApiError,
  isRecord,
  publicApiRequest,
  resolveMediaURL,
  type VideoStatus,
} from "@/features/creative-console/creative-api-core";

export async function createVideo(input: {
  apiKey: string;
  model: string;
  prompt: string;
  imageURL?: string;
  imageFileID?: string;
  referenceImages?: Array<{ url?: string; fileId?: string }>;
  referenceVoiceIds?: string[];
  duration: number;
  aspectRatio: string;
  resolution: string;
  signal?: AbortSignal;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    duration: input.duration,
    aspect_ratio: input.aspectRatio,
    resolution: input.resolution,
  };
  if (input.imageFileID) body.image = { file_id: input.imageFileID };
  else if (input.imageURL) body.image = { url: input.imageURL };
  if (input.referenceImages && input.referenceImages.length > 0) {
    body.reference_images = input.referenceImages.map((item) =>
      item.fileId ? { file_id: item.fileId } : { url: item.url },
    );
  }
  if (input.referenceVoiceIds && input.referenceVoiceIds.length > 0) {
    body.reference_audios = input.referenceVoiceIds.map((voiceId) => ({ voice_id: voiceId }));
  }
  const payload = await publicApiRequest(input.apiKey, "/videos/generations", {
    method: "POST",
    body,
    signal: input.signal,
  });
  return requireVideoRequestID(payload);
}

export async function editVideo(input: {
  apiKey: string;
  model: string;
  prompt: string;
  videoURL?: string;
  videoFileID?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const payload = await publicApiRequest(input.apiKey, "/videos/edits", {
    method: "POST",
    body: {
      model: input.model,
      prompt: input.prompt,
      video: videoSource(input.videoURL, input.videoFileID),
    },
    signal: input.signal,
  });
  return requireVideoRequestID(payload);
}

export async function extendVideo(input: {
  apiKey: string;
  model: string;
  prompt: string;
  videoURL?: string;
  videoFileID?: string;
  duration?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    video: videoSource(input.videoURL, input.videoFileID),
  };
  if (typeof input.duration === "number") body.duration = input.duration;
  const payload = await publicApiRequest(input.apiKey, "/videos/extensions", {
    method: "POST",
    body,
    signal: input.signal,
  });
  return requireVideoRequestID(payload);
}

export async function getVideo(input: {
  apiKey: string;
  requestId: string;
  signal?: AbortSignal;
}): Promise<VideoStatus> {
  const payload = await publicApiRequest(input.apiKey, `/videos/${encodeURIComponent(input.requestId)}`, {
    method: "GET",
    signal: input.signal,
  });
  const status = readVideoStatus(payload);
  return status.video ? { ...status, video: { ...status.video, url: resolveMediaURL(status.video.url) } } : status;
}

function videoSource(url?: string, fileId?: string): Record<string, unknown> {
  return fileId ? { file_id: fileId } : { url };
}

export function requireVideoRequestID(payload: unknown): string {
  const requestId = isRecord(payload) && typeof payload.request_id === "string" ? payload.request_id.trim() : "";
  if (!requestId)
    throw new CreativeApiError(200, "The video response did not contain a request ID", "invalid_response");
  return requestId;
}

export function readVideoStatus(payload: unknown): VideoStatus {
  if (!isRecord(payload) || !isVideoStatus(payload.status)) {
    throw new CreativeApiError(200, "The video status response was invalid", "invalid_response");
  }
  const result: VideoStatus = {
    status: payload.status,
    model: typeof payload.model === "string" ? payload.model : undefined,
    progress: readVideoProgress(payload, payload.status),
  };
  if (isRecord(payload.video) && typeof payload.video.url === "string") {
    result.video = {
      url: payload.video.url,
      duration: typeof payload.video.duration === "number" ? payload.video.duration : undefined,
      respectModeration:
        typeof payload.video.respect_moderation === "boolean" ? payload.video.respect_moderation : undefined,
    };
  }
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    result.error = {
      code: typeof payload.error.code === "string" ? payload.error.code : undefined,
      message: payload.error.message,
    };
  }
  return result;
}

function readVideoProgress(payload: Record<string, unknown>, status: VideoStatus["status"]): number {
  if (typeof payload.progress === "number" && Number.isFinite(payload.progress)) {
    return Math.max(0, Math.min(100, payload.progress));
  }
  return status === "done" ? 100 : 0;
}

function isVideoStatus(value: unknown): value is VideoStatus["status"] {
  return value === "pending" || value === "done" || value === "failed";
}
