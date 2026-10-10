export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ReasoningEffort = "auto" | "none" | "low" | "medium" | "high" | "xhigh";

export type ChatToolActivity = {
  id: string;
  type: string;
  name: string;
  status: "in_progress" | "completed" | "failed";
  detail: string;
};

export type ChatStreamSnapshot = {
  text: string;
  reasoning: string;
  tools: ChatToolActivity[];
};

export type ChatResponseResult = ChatStreamSnapshot;

export type ImageResult = {
  url: string;
  revisedPrompt?: string;
};

export type VideoStatus = {
  status: "pending" | "done" | "failed";
  model?: string;
  progress: number;
  video?: { url: string; duration?: number; respectModeration?: boolean };
  error?: { code?: string; message: string };
};

export type VoiceInfo = {
  voiceId: string;
  name: string;
  language?: string;
};

export type TTSResult = {
  url: string;
  contentType: string;
  duration?: number;
};

export type STTResult = {
  text: string;
  language?: string;
  duration?: number;
  words?: Array<{ text: string; start: number; end: number; speaker?: number }>;
};

export class CreativeApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "CreativeApiError";
    this.status = status;
    this.code = code;
  }
}

export type RequestOptions = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

export function readErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : "";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJSON(value: string): unknown {
  if (!value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function readError(payload: unknown): { code?: string; message?: string } {
  if (!isRecord(payload)) return {};
  const error = isRecord(payload.error) ? payload.error : payload;
  return {
    code: typeof error.code === "string" ? error.code : undefined,
    message: typeof error.message === "string" ? error.message : undefined,
  };
}

export async function publicApiRequest(apiKey: string, path: string, options: RequestOptions): Promise<unknown> {
  const headers = new Headers({ Accept: "application/json", Authorization: `Bearer ${apiKey}` });
  let body: string | undefined;
  if (options.body) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.body);
  }
  const response = await fetch(`/v1${path}`, {
    method: options.method ?? "GET",
    headers,
    body,
    signal: options.signal,
  });
  const responseText = await response.text();
  const payload = parseJSON(responseText);
  if (!response.ok) throw creativeErrorFromResponse(response, responseText, payload);
  if (payload === null)
    throw new CreativeApiError(response.status, "The API returned a non-JSON response", "invalid_response");
  return payload;
}

/** 非 2xx 响应的统一错误映射：先取 body 里的 code/message，再退回原文与状态文本。 */
export function creativeErrorFromResponse(
  response: Response,
  responseText: string,
  payload: unknown,
): CreativeApiError {
  const error = readError(payload);
  const fallback = responseText.trim() || response.statusText || `HTTP ${response.status}`;
  return new CreativeApiError(response.status, error.message ?? fallback, error.code);
}

export async function readResponseError(response: Response): Promise<CreativeApiError> {
  const responseText = await response.text();
  return creativeErrorFromResponse(response, responseText, parseJSON(responseText));
}

/** 本地代理返回的媒体地址保留同源相对路径，外部地址保留绝对形式，data/blob 原样返回。 */
export function resolveMediaURL(value: string): string {
  const url = value.trim();
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return url;
  try {
    const browserOrigin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    const resolved = new URL(url, `${browserOrigin}/`);
    if (resolved.pathname.startsWith("/v1/media/images/")) {
      return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    }
    return resolved.origin === browserOrigin
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : resolved.toString();
  } catch {
    return url;
  }
}

export async function listAllPaginatedItems<T>(
  loadPage: (page: number, pageSize: number) => Promise<{ items: T[]; total: number }>,
): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; page <= 50; page += 1) {
    const result = await loadPage(page, 100);
    items.push(...result.items);
    if (result.items.length === 0 || items.length >= result.total) break;
  }
  return items;
}
