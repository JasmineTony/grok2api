import { createObjectDecoder, hasShape, isString, type ApiDecoder } from "@/shared/api/decoder";
import { runtimeConfig } from "@/shared/config/runtime-config";
import { i18n } from "@/shared/i18n";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

let accessToken: string | null = null;
let refreshPromise: Promise<RefreshResult> | null = null;
const sessionInvalidatedListeners = new Set<() => void>();
const refreshLockName = "grok2api:admin-session-refresh";
const maxEventStreamBufferCharacters = 1 << 20;
const eventStreamInactivityTimeoutMs = 60_000;

export type RefreshResult = "refreshed" | "invalid" | "unavailable";

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function subscribeSessionInvalidated(listener: () => void): () => void {
  sessionInvalidatedListeners.add(listener);
  return () => sessionInvalidatedListeners.delete(listener);
}

function invalidateSession(): void {
  accessToken = null;
  sessionInvalidatedListeners.forEach((listener) => listener());
}

function localizedErrorMessage(code: string, fallback: string): string {
  const key = `apiErrors.${code}`;
  return i18n.exists(key) ? i18n.t(key) : fallback;
}

/** invalidResponse 是响应体形状/内容不符合契约时的统一错误。 */
function invalidResponseError(status: number): ApiError {
  return new ApiError(
    status,
    "invalidResponse",
    localizedErrorMessage("invalidResponse", "Server returned an invalid response"),
  );
}

async function parseResponse<T>(response: Response, decode: ApiDecoder<T>): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = readErrorEnvelope(payload);
    const code = error.code ?? "requestFailed";
    throw new ApiError(
      response.status,
      code,
      localizedErrorMessage(code, error.message ?? `HTTP ${response.status}`),
      error.requestId,
    );
  }
  if (!isRecord(payload) || !("data" in payload)) {
    throw invalidResponseError(response.status);
  }
  try {
    return decode(payload.data);
  } catch {
    throw invalidResponseError(response.status);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readErrorEnvelope(payload: unknown): { code?: string; message?: string; requestId?: string } {
  if (!isRecord(payload) || !isRecord(payload.error)) return {};
  return {
    code: typeof payload.error.code === "string" ? payload.error.code : undefined,
    message: typeof payload.error.message === "string" ? payload.error.message : undefined,
    requestId: typeof payload.error.requestId === "string" ? payload.error.requestId : undefined,
  };
}

async function requestRefresh(): Promise<RefreshResult> {
  try {
    const response = await fetch(`${runtimeConfig.apiBaseUrl}/api/admin/v1/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.status === 401) {
      invalidateSession();
      return "invalid";
    }
    const tokens = await parseResponse(response, decodeAuthTokensDTO);
    setAccessToken(tokens.accessToken);
    return "refreshed";
  } catch {
    return "unavailable";
  }
}

async function requestRefreshWithBrowserLock(): Promise<RefreshResult> {
  if (!("locks" in navigator)) {
    return requestRefresh();
  }
  try {
    return await navigator.locks.request(refreshLockName, requestRefresh);
  } catch {
    return "unavailable";
  }
}

export async function refreshAccessToken(): Promise<RefreshResult> {
  if (!refreshPromise) {
    refreshPromise = requestRefreshWithBrowserLock().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

/**
 * 401 且允许重试时刷新会话：刷新成功返回 true（调用方用 retryAuth:false 重试一次），
 * 刷新不可用抛出 503，会话已失效返回 false（沿用原始 401 响应继续解析错误）。
 */
async function shouldRetryAfterSessionRefresh(
  status: number,
  authenticated: boolean,
  retryAuth: boolean,
): Promise<boolean> {
  if (status !== 401 || !authenticated || !retryAuth) return false;
  const refreshResult = await refreshAccessToken();
  if (refreshResult === "refreshed") return true;
  if (refreshResult === "unavailable") {
    throw new ApiError(
      503,
      "sessionRefreshUnavailable",
      localizedErrorMessage("sessionRefreshUnavailable", "Unable to refresh the session. Please retry."),
    );
  }
  return false;
}

type RequestOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | object;
  authenticated?: boolean;
  retryAuth?: boolean;
};

async function sendApiRequest(path: string, options: RequestOptions): Promise<Response> {
  const { authenticated = true, retryAuth, body, headers, ...requestInit } = options;
  void retryAuth;
  const requestHeaders = new Headers(headers);
  let requestBody: BodyInit | undefined;

  if (body instanceof FormData || typeof body === "string" || body instanceof Blob) {
    requestBody = body;
  } else if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }
  if (authenticated && accessToken) {
    requestHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  return fetch(`${runtimeConfig.apiBaseUrl}${path}`, {
    ...requestInit,
    body: requestBody,
    credentials: "include",
    headers: requestHeaders,
  });
}

export async function apiRequest<T>(path: string, options: RequestOptions, decode: ApiDecoder<T>): Promise<T> {
  const { authenticated = true, retryAuth = true } = options;
  const response = await sendApiRequest(path, options);
  if (await shouldRetryAfterSessionRefresh(response.status, authenticated, retryAuth)) {
    return apiRequest<T>(path, { ...options, retryAuth: false }, decode);
  }

  return parseResponse(response, decode);
}

export type ApiStreamEvent<T> = {
  event: string;
  data: T;
};

// apiEventStream 使用现有管理员鉴权发起 POST SSE，并正确处理任意分块边界。
export async function apiEventStream<T>(
  path: string,
  options: RequestOptions,
  decode: ApiDecoder<T>,
  onEvent: (value: ApiStreamEvent<T>) => void,
): Promise<void> {
  const { authenticated = true, retryAuth = true } = options;
  const response = await sendApiRequest(path, options);
  if (await shouldRetryAfterSessionRefresh(response.status, authenticated, retryAuth)) {
    return apiEventStream(path, { ...options, retryAuth: false }, decode, onEvent);
  }
  const body = await readEventStreamBody(response);
  await pumpEventStream(body.getReader(), response.status, (block) => {
    const decoded = decodeEventStreamBlock(block, decode, response.status);
    if (decoded) onEvent(decoded);
  });
}

async function readEventStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  status: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout = 0;
  const inactivity = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => {
      reject(
        new ApiError(
          status,
          "streamTimeout",
          localizedErrorMessage("streamTimeout", "The progress stream stopped responding"),
        ),
      );
    }, eventStreamInactivityTimeoutMs);
  });
  try {
    return await Promise.race([reader.read(), inactivity]);
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * 校验并返回 SSE 响应体：非 2xx 沿用 JSON 错误信封，缺失响应体或非事件流内容按
 * invalidResponse 处理（后者需要先取消响应体）。
 */
async function readEventStreamBody(response: Response): Promise<NonNullable<Response["body"]>> {
  if (!response.ok) {
    await parseResponse(response, decodeNever);
  }
  if (!response.body) {
    throw invalidResponseError(response.status);
  }
  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("text/event-stream")) {
    await response.body.cancel().catch(() => undefined);
    throw invalidResponseError(response.status);
  }
  return response.body;
}

/**
 * 逐块读取事件流并派发完整事件块，保留跨分块边界与残余缓冲语义；
 * 读取或解码失败时取消流，无论成败都释放 reader 锁。
 */
async function pumpEventStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  status: number,
  dispatch: (block: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await readEventStreamChunk(reader, status);
      buffer = drainEventStreamChunk(buffer + decoder.decode(value, { stream: !done }), status, dispatch);
      if (done) break;
    }
    if (buffer.trim()) dispatch(buffer);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** 派发缓冲内所有完整事件块，返回未闭合的残余缓冲；越过上限按 invalidResponse 失败。 */
function drainEventStreamChunk(buffer: string, status: number, dispatch: (block: string) => void): string {
  let remaining = buffer.replaceAll("\r\n", "\n");
  let boundary = remaining.indexOf("\n\n");
  while (boundary >= 0) {
    if (boundary > maxEventStreamBufferCharacters) throw invalidResponseError(status);
    dispatch(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary + 2);
    boundary = remaining.indexOf("\n\n");
  }
  if (remaining.length > maxEventStreamBufferCharacters) throw invalidResponseError(status);
  return remaining;
}

/** 解析单个事件块；没有 data 行时返回 null（与原实现一致地忽略该块）。 */
function parseEventStreamBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (normalized.startsWith("event:")) event = normalized.slice(6).trim();
    if (normalized.startsWith("data:")) data.push(normalized.slice(5).trimStart());
  }
  return data.length === 0 ? null : { event, data: data.join("\n") };
}

/** 解码事件块；JSON 或解码失败统一按 invalidResponse 抛出。 */
function decodeEventStreamBlock<T>(block: string, decode: ApiDecoder<T>, status: number): ApiStreamEvent<T> | null {
  const parsed = parseEventStreamBlock(block);
  if (!parsed) return null;
  try {
    return { event: parsed.event, data: decode(JSON.parse(parsed.data) as unknown) };
  } catch {
    throw invalidResponseError(status);
  }
}

export type ApiDownloadResult = {
  blob: Blob;
  headers: Headers;
};

export async function apiDownloadResponse(path: string, options: RequestOptions = {}): Promise<ApiDownloadResult> {
  const { authenticated = true, retryAuth = true } = options;
  const response = await sendApiRequest(path, options);
  if (await shouldRetryAfterSessionRefresh(response.status, authenticated, retryAuth)) {
    return apiDownloadResponse(path, { ...options, retryAuth: false });
  }
  if (!response.ok) {
    await parseResponse(response, decodeNever);
    throw new ApiError(response.status, "requestFailed", localizedErrorMessage("requestFailed", "The request failed"));
  }
  return { blob: await response.blob(), headers: response.headers };
}

export async function apiDownload(path: string, options: RequestOptions = {}): Promise<Blob> {
  return (await apiDownloadResponse(path, options)).blob;
}

export type AdminDTO = {
  id: string;
  username: string;
};

export type AuthTokensDTO = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type LoginResponseDTO = {
  admin: AdminDTO;
  tokens: AuthTokensDTO;
};

const adminValidator = hasShape({ id: isString, username: isString });
const authTokensValidator = hasShape({
  accessToken: isString,
  accessTokenExpiresAt: isString,
  refreshTokenExpiresAt: isString,
});

export const decodeAdminDTO = createObjectDecoder<AdminDTO>("admin", { id: isString, username: isString });
export const decodeAuthTokensDTO = createObjectDecoder<AuthTokensDTO>("auth tokens", {
  accessToken: isString,
  accessTokenExpiresAt: isString,
  refreshTokenExpiresAt: isString,
});
export const decodeLoginResponseDTO = createObjectDecoder<LoginResponseDTO>("login", {
  admin: adminValidator,
  tokens: authTokensValidator,
});
export const decodeLoggedOut = createObjectDecoder<{ loggedOut: boolean }>("logout", {
  loggedOut: (value) => typeof value === "boolean",
});

function decodeNever(): never {
  throw new Error("unexpected successful response");
}

export type PaginatedDTO<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
};
