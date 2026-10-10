import type { ModelRouteDTO } from "@/entities/model/types";
import type { AccountDTO } from "@/features/accounts/accounts-dto";
import type {
  AuditAttemptDTO,
  AuditCursorPageDTO,
  AuditDTO,
  AuditSummaryDTO,
} from "@/features/audits/request-audits-api";
import type { ClientKeyDTO } from "@/features/client-keys/client-keys-api";

/**
 * 审计组件集成测试的 API 桩与 DTO 构造器（仅被 *.test.tsx 使用）。
 * 只替换网络边界：apiRequest 由测试注入，真实 decoder 与业务代码保持原样。
 */
export type FakeApiCall = {
  path: string;
  method: string;
  body: unknown;
  query: URLSearchParams;
};

export type FakeApiHandler = (call: FakeApiCall) => unknown;

export function createFakeApi(handler: FakeApiHandler) {
  return async function fakeApiRequest(
    path: string,
    options: { method?: string; body?: unknown },
    decode: (value: unknown) => unknown,
  ): Promise<unknown> {
    const queryIndex = path.indexOf("?");
    const call: FakeApiCall = {
      path: queryIndex === -1 ? path : path.slice(0, queryIndex),
      method: options.method ?? "GET",
      body: options.body,
      query: new URLSearchParams(queryIndex === -1 ? "" : path.slice(queryIndex + 1)),
    };
    return decode(await handler(call));
  };
}

/** jsdom 未实现 ResizeObserver，而 Radix 的 useSize 在挂载时直接 new。 */
export class ResizeObserverStub {
  observe(): void {
    /* 测试不需要尺寸变化回调 */
  }

  unobserve(): void {
    /* 同上 */
  }

  disconnect(): void {
    /* 同上 */
  }
}

export function auditDTO(overrides: Partial<AuditDTO> = {}): AuditDTO {
  return {
    id: "audit-1",
    requestId: "req-1",
    clientKeyId: "key-1",
    clientKeyName: "生产密钥",
    clientIp: "10.0.0.1",
    modelRouteId: "route-1",
    modelPublicId: "grok-4",
    modelUpstreamModel: "grok-4-0801",
    provider: "grok_build",
    operation: "responses",
    usageSource: "upstream",
    statusCode: 200,
    streaming: true,
    mediaInputImages: 0,
    mediaOutputImages: 0,
    mediaOutputSeconds: 0,
    inputTokens: 100,
    cachedInputTokens: 20,
    outputTokens: 30,
    reasoningTokens: 5,
    totalTokens: 130,
    costInUsdTicks: 0,
    estimatedCostInUsdTicks: 0,
    numSourcesUsed: 0,
    numServerSideToolsUsed: 0,
    contextInputTokens: 0,
    contextOutputTokens: 0,
    durationMs: 1500,
    attemptCount: 1,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

export function auditPage(items: AuditDTO[], overrides: Partial<AuditCursorPageDTO> = {}): AuditCursorPageDTO {
  return { items, pageSize: 20, nextCursor: "", hasMore: false, ...overrides };
}

export function auditSummary(overrides: Partial<AuditSummaryDTO> = {}): AuditSummaryDTO {
  return {
    period: "24h",
    generatedAt: "2026-10-01T10:00:00.000Z",
    range: { start: "2026-09-30T10:00:00.000Z", end: "2026-10-01T10:00:00.000Z" },
    usage: {
      requests: 12,
      successfulRequests: 10,
      failedRequests: 2,
      inputTokens: 1000,
      cachedInputTokens: 250,
      outputTokens: 500,
      reasoningTokens: 120,
      totalTokens: 1500,
      averageDurationMs: 1200,
      successRate: 83.3,
      estimatedCostInUsdTicks: 0,
    },
    pricing: {
      source: "official",
      asOf: "2026-10-01T00:00:00.000Z",
      pricedRequests: 0,
      unpricedRequests: 12,
      pricedTokens: 0,
      unpricedTokens: 1500,
    },
    ...overrides,
  };
}

export function auditAttemptDTO(overrides: Partial<AuditAttemptDTO> = {}): AuditAttemptDTO {
  return {
    id: "attempt-1",
    number: 1,
    source: "upstream_http",
    stage: "response_stream",
    accountName: "账号 A",
    method: "POST",
    requestPath: "/v1/responses",
    upstreamUrl: "https://upstream.example/v1/responses",
    startedAt: "2026-10-01T10:00:01.000Z",
    durationMs: 800,
    upstreamStatusCode: 502,
    upstreamStatus: "502 Bad Gateway",
    responseHeaders: { "content-type": ["application/json"] },
    responseBody: '{"error":"boom"}',
    responseBodyEncoding: "utf8",
    responseBodyTruncated: false,
    errorChain: [],
    ...overrides,
  };
}

/** 三级筛选菜单的密钥名单条目。 */
export function auditFilterKey(overrides: Partial<ClientKeyDTO> = {}): ClientKeyDTO {
  return {
    id: "key-1",
    name: "生产密钥",
    prefix: "g2a_abc",
    enabled: true,
    rpmLimit: 60,
    maxConcurrent: 4,
    billingLimitUsdTicks: 0,
    billedUsageUsdTicks: 0,
    allowModelAliases: false,
    allowedModelIds: [],
    ...overrides,
  };
}

/** 三级筛选菜单的账号名单条目（满足账号解码器的必填字段）。 */
export function auditFilterAccount(overrides: Partial<AccountDTO> = {}): AccountDTO {
  return {
    id: "account-1",
    provider: "grok_web",
    authType: "oauth",
    name: "账号 A",
    enabled: true,
    authStatus: "active",
    refreshable: false,
    cloudflareCookieConfigured: false,
    buildSuperEntitled: false,
    buildRouteMode: "auto",
    buildBotFlagged: false,
    refreshFailureCount: 0,
    priority: 50,
    maxConcurrent: 4,
    minimumRemaining: 0,
    failureCount: 0,
    createdAt: "2026-01-02T03:04:05Z",
    quota: {
      type: "free",
      source: "unknown",
      confidence: "estimated",
      status: "active",
      used: 0,
      limit: 100,
      remaining: 100,
      usagePercent: 0,
      limitKnown: true,
      observed: false,
      confirmed: false,
    },
    ...overrides,
  };
}

/** 模型筛选名单条目。 */
export function auditFilterModel(overrides: Partial<ModelRouteDTO> = {}): ModelRouteDTO {
  return {
    id: "route-1",
    publicId: "grok-4",
    provider: "grok_build",
    upstreamModel: "Build/grok-4",
    capability: "responses",
    origin: "catalog",
    enabled: true,
    accountIds: [],
    bindingMode: false,
    supportedAccounts: 1,
    syncedAccounts: 1,
    totalAccounts: 1,
    capabilityKnown: true,
    available: true,
    lastSyncedAt: "2026-01-02T03:04:05Z",
    ...overrides,
  };
}
