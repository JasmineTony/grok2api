import { type ApiDecoder, createObjectDecoder, hasShape, isString } from "@/shared/api/decoder";
import { runtimeConfig } from "@/shared/config/runtime-config";
import { i18n } from "@/shared/i18n";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | undefined;
  readonly retryable: boolean;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryable = status === 408 || status === 429 || status >= 500;
  }
}

export type RefreshResult = "refreshed" | "invalid" | "unavailable";
export type ApiStreamEvent<T> = { event: string; data: T };
export type PaginatedDTO<T> = { items: T[]; page: number; pageSize: number; total: number };

type SessionInvalidatedListener = () => void;
type RequestOptions = Omit<RequestInit, "body" | "signal"> & {
  body?: BodyInit | object | undefined;
  signal?: AbortSignal | null | undefined;
  authenticated?: boolean;
  retryAuth?: boolean;
};

export type PublicRequestOptions = Omit<RequestInit, "body" | "headers" | "signal"> & {
  apiKey?: string;
  body?: BodyInit | object | undefined;
  headers?: HeadersInit;
  signal?: AbortSignal | null | undefined;
};

const refreshLockName = "grok2api:admin-session-refresh";
const maxEventStreamBufferCharacters = 1 << 20;
const eventStreamInactivityTimeoutMs = 60_000;

export class ApiClient {
  private accessToken: string | null = null;
  private refreshPromise: Promise<RefreshResult> | null = null;
  private readonly sessionInvalidatedListeners = new Set<SessionInvalidatedListener>();

  constructor(
    private readonly baseUrl = runtimeConfig.apiBaseUrl,
    private readonly publicBaseUrl = runtimeConfig.publicApiBaseUrl,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  subscribeSessionInvalidated(listener: SessionInvalidatedListener): () => void {
    this.sessionInvalidatedListeners.add(listener);
    return () => this.sessionInvalidatedListeners.delete(listener);
  }

  async refreshAccessToken(): Promise<RefreshResult> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.requestRefreshWithBrowserLock().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  async request<T>(path: string, options: RequestOptions, decode: ApiDecoder<T>): Promise<T> {
    const { authenticated = true, retryAuth = true } = options;
    const response = await this.sendAdminRequest(path, options);
    if (response.status === 401 && authenticated && retryAuth) {
      const refreshResult = await this.refreshAccessToken();
      if (refreshResult === "refreshed")
        return this.request(path, { ...options, retryAuth: false }, decode);
      if (refreshResult === "unavailable") throw sessionRefreshUnavailable();
    }
    return parseResponse(response, decode);
  }

  async download(path: string, retryAuth = true): Promise<Blob> {
    const headers = new Headers();
    if (this.accessToken) headers.set("Authorization", `Bearer ${this.accessToken}`);
    const response = await this.fetchImpl(resolveUrl(this.baseUrl, path), {
      credentials: "include",
      headers,
    });
    if (response.status === 401 && retryAuth) {
      const refreshResult = await this.refreshAccessToken();
      if (refreshResult === "refreshed") return this.download(path, false);
      if (refreshResult === "unavailable") throw sessionRefreshUnavailable();
    }
    if (!response.ok) await parseResponse(response, decodeNever);
    return response.blob();
  }

  async eventStream<T>(
    path: string,
    options: RequestOptions,
    decode: ApiDecoder<T>,
    onEvent: (value: ApiStreamEvent<T>) => void,
  ): Promise<void> {
    const { authenticated = true, retryAuth = true } = options;
    const response = await this.sendAdminRequest(path, options);
    if (response.status === 401 && authenticated && retryAuth) {
      const refreshResult = await this.refreshAccessToken();
      if (refreshResult === "refreshed")
        return this.eventStream(path, { ...options, retryAuth: false }, decode, onEvent);
      if (refreshResult === "unavailable") throw sessionRefreshUnavailable();
    }
    if (!response.ok) await parseResponse(response, decodeNever);
    if (
      !response.body ||
      !response.headers.get("Content-Type")?.toLowerCase().startsWith("text/event-stream")
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw invalidResponse(response.status);
    }
    const reader = response.body.getReader();
    const textDecoder = new TextDecoder();
    let buffer = "";
    const dispatch = (block: string): void => {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split("\n")) {
        const normalized = line.endsWith("\r") ? line.slice(0, -1) : line;
        if (normalized.startsWith("event:")) event = normalized.slice(6).trim();
        if (normalized.startsWith("data:")) data.push(normalized.slice(5).trimStart());
      }
      if (data.length === 0) return;
      try {
        onEvent({ event, data: decode(JSON.parse(data.join("\n")) as unknown) });
      } catch (error) {
        if (error instanceof ApiError) throw error;
        throw invalidResponse(response.status);
      }
    };
    try {
      for (;;) {
        const { done, value } = await readEventStreamChunk(reader, response.status);
        buffer += textDecoder.decode(value, { stream: !done });
        buffer = buffer.replaceAll("\r\n", "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          if (boundary > maxEventStreamBufferCharacters) throw invalidResponse(response.status);
          dispatch(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
        if (buffer.length > maxEventStreamBufferCharacters) throw invalidResponse(response.status);
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

  async publicRequest(path: string, options: PublicRequestOptions = {}): Promise<Response> {
    const { apiKey, body, headers, signal, ...requestInit } = options;
    const requestHeaders = new Headers(headers);
    let requestBody: BodyInit | undefined;
    if (body instanceof FormData || typeof body === "string" || body instanceof Blob)
      requestBody = body;
    else if (body !== undefined) {
      requestHeaders.set("Content-Type", "application/json");
      requestBody = JSON.stringify(body);
    }
    if (apiKey) requestHeaders.set("Authorization", `Bearer ${apiKey}`);
    return this.fetchImpl(resolveUrl(this.publicBaseUrl, path), {
      ...requestInit,
      ...(requestBody === undefined ? {} : { body: requestBody }),
      ...(signal === undefined ? {} : { signal }),
      headers: requestHeaders,
    });
  }

  private invalidateSession(): void {
    this.accessToken = null;
    for (const listener of this.sessionInvalidatedListeners) listener();
  }

  private async requestRefresh(): Promise<RefreshResult> {
    try {
      const response = await this.fetchImpl(
        resolveUrl(this.baseUrl, "/api/admin/v1/auth/refresh"),
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      if (response.status === 401) {
        this.invalidateSession();
        return "invalid";
      }
      const tokens = await parseResponse(response, decodeAuthTokensDTO);
      this.accessToken = tokens.accessToken;
      return "refreshed";
    } catch {
      return "unavailable";
    }
  }

  private async requestRefreshWithBrowserLock(): Promise<RefreshResult> {
    if (typeof navigator === "undefined" || !("locks" in navigator)) return this.requestRefresh();
    try {
      return await navigator.locks.request(refreshLockName, () => this.requestRefresh());
    } catch {
      return "unavailable";
    }
  }

  private async sendAdminRequest(path: string, options: RequestOptions): Promise<Response> {
    const {
      authenticated = true,
      retryAuth: _retryAuth,
      body,
      headers,
      signal,
      ...requestInit
    } = options;
    void _retryAuth;
    const requestHeaders = new Headers(headers);
    let requestBody: BodyInit | undefined;
    if (body instanceof FormData || typeof body === "string" || body instanceof Blob)
      requestBody = body;
    else if (body !== undefined) {
      requestHeaders.set("Content-Type", "application/json");
      requestBody = JSON.stringify(body);
    }
    if (authenticated && this.accessToken)
      requestHeaders.set("Authorization", `Bearer ${this.accessToken}`);
    return this.fetchImpl(resolveUrl(this.baseUrl, path), {
      ...requestInit,
      ...(requestBody === undefined ? {} : { body: requestBody }),
      ...(signal === undefined ? {} : { signal }),
      credentials: "include",
      headers: requestHeaders,
    });
  }
}

function resolveUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl.replace(/\/$/, "")}${normalizedPath}`;
}

function localizedErrorMessage(code: string, fallback: string): string {
  const key = `apiErrors.${code}`;
  return i18n.exists(key) ? i18n.t(key) : fallback;
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
  if (!isRecord(payload) || !("data" in payload)) throw invalidResponse(response.status);
  try {
    return decode(payload.data);
  } catch {
    throw invalidResponse(response.status);
  }
}

function readErrorEnvelope(payload: unknown): {
  code?: string;
  message?: string;
  requestId?: string;
} {
  if (!isRecord(payload) || !isRecord(payload.error)) return {};
  return {
    ...(typeof payload.error.code === "string" ? { code: payload.error.code } : {}),
    ...(typeof payload.error.message === "string" ? { message: payload.error.message } : {}),
    ...(typeof payload.error.requestId === "string" ? { requestId: payload.error.requestId } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(status: number): ApiError {
  return new ApiError(
    status,
    "invalidResponse",
    localizedErrorMessage("invalidResponse", "Server returned an invalid response"),
  );
}

function sessionRefreshUnavailable(): ApiError {
  return new ApiError(
    503,
    "sessionRefreshUnavailable",
    localizedErrorMessage(
      "sessionRefreshUnavailable",
      "Unable to refresh the session. Please retry.",
    ),
  );
}

async function readEventStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  status: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timeout = 0;
  const inactivity = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(
      () =>
        reject(
          new ApiError(
            status,
            "streamTimeout",
            localizedErrorMessage("streamTimeout", "The progress stream stopped responding"),
          ),
        ),
      eventStreamInactivityTimeoutMs,
    );
  });
  try {
    return await Promise.race([reader.read(), inactivity]);
  } finally {
    window.clearTimeout(timeout);
  }
}

export type AdminDTO = { id: string; username: string };
export type AuthTokensDTO = {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};
export type LoginResponseDTO = { admin: AdminDTO; tokens: AuthTokensDTO };

const adminValidator = hasShape({ id: isString, username: isString });
const authTokensValidator = hasShape({
  accessToken: isString,
  accessTokenExpiresAt: isString,
  refreshTokenExpiresAt: isString,
});
export const decodeAdminDTO = createObjectDecoder<AdminDTO>("admin", {
  id: isString,
  username: isString,
});
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
