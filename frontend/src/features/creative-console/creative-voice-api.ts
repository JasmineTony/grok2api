import {
  CreativeApiError,
  creativeErrorFromResponse,
  isRecord,
  parseJSON,
  publicApiRequest,
  readResponseError,
  type STTResult,
  type TTSResult,
  type VoiceInfo,
} from "@/features/creative-console/creative-api-core";

export async function listVoices(input: {
  apiKey: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<VoiceInfo[]> {
  const query = input.model ? `?model=${encodeURIComponent(input.model)}` : "";
  const payload = await publicApiRequest(input.apiKey, `/tts/voices${query}`, { method: "GET", signal: input.signal });
  return readVoices(payload);
}

export function readVoices(payload: unknown): VoiceInfo[] {
  if (!isRecord(payload) || !Array.isArray(payload.voices))
    throw new CreativeApiError(200, "The voice list response was invalid", "invalid_response");
  return payload.voices.map((item) => {
    if (!isRecord(item) || typeof item.voice_id !== "string")
      throw new CreativeApiError(200, "The voice list response was invalid", "invalid_response");
    return {
      voiceId: item.voice_id,
      name: typeof item.name === "string" ? item.name : item.voice_id,
      language: typeof item.language === "string" ? item.language : undefined,
    };
  });
}

export async function synthesizeSpeech(input: {
  apiKey: string;
  model: string;
  text: string;
  voiceId: string;
  language: string;
  speed?: number;
  signal?: AbortSignal;
}): Promise<TTSResult> {
  const response = await fetch("/v1/tts", {
    method: "POST",
    headers: new Headers({
      Accept: "application/json, audio/*",
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify(buildSynthesizeSpeechBody(input)),
    signal: input.signal,
  });
  return readTTSResult(response);
}

function buildSynthesizeSpeechBody(input: {
  model: string;
  text: string;
  voiceId: string;
  language: string;
  speed?: number;
}): Record<string, unknown> {
  return {
    model: input.model,
    text: input.text,
    voice_id: input.voiceId,
    language: input.language,
    ...(typeof input.speed === "number" ? { speed: input.speed } : {}),
  };
}

async function readTTSResult(response: Response): Promise<TTSResult> {
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw await readResponseError(response);
  if (contentType.includes("application/json")) return readJSONTTSResult(response);
  return readBinaryTTSResult(response, contentType);
}

async function readJSONTTSResult(response: Response): Promise<TTSResult> {
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.audio !== "string")
    throw new CreativeApiError(200, "The TTS response was invalid", "invalid_response");
  const mime = typeof payload.content_type === "string" ? payload.content_type : "audio/mpeg";
  return {
    url: `data:${mime};base64,${payload.audio}`,
    contentType: mime,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
  };
}

async function readBinaryTTSResult(response: Response, contentType: string): Promise<TTSResult> {
  const buffer = await response.arrayBuffer();
  const mime = contentType || "audio/mpeg";
  const blob = new Blob([buffer], { type: mime });
  return { url: URL.createObjectURL(blob), contentType: mime };
}

export async function transcribeSpeech(input: {
  apiKey: string;
  model: string;
  file: File;
  language?: string;
  signal?: AbortSignal;
}): Promise<STTResult> {
  const response = await fetch("/v1/stt", {
    method: "POST",
    headers: new Headers({ Accept: "application/json", Authorization: `Bearer ${input.apiKey}` }),
    body: buildTranscriptionForm(input),
    signal: input.signal,
  });
  const responseText = await response.text();
  const payload = parseJSON(responseText);
  if (!response.ok) throw creativeErrorFromResponse(response, responseText, payload);
  if (!isRecord(payload) || typeof payload.text !== "string")
    throw new CreativeApiError(200, "The STT response was invalid", "invalid_response");
  return {
    text: payload.text,
    language: typeof payload.language === "string" ? payload.language : undefined,
    duration: typeof payload.duration === "number" ? payload.duration : undefined,
    words: readTranscriptWords(payload.words),
  };
}

function buildTranscriptionForm(input: { model: string; file: File; language?: string }): FormData {
  const form = new FormData();
  form.append("model", input.model);
  if (input.language) form.append("language", input.language);
  form.append("format", "true");
  form.append("file", input.file, input.file.name);
  return form;
}

export function readTranscriptWords(value: unknown): STTResult["words"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.text !== "string") return [];
    return [
      {
        text: item.text,
        start: typeof item.start === "number" ? item.start : 0,
        end: typeof item.end === "number" ? item.end : 0,
        speaker: typeof item.speaker === "number" ? item.speaker : undefined,
      },
    ];
  });
}
