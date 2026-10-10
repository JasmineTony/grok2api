import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildAuditFilterOptionGroup, buildAuditFilters, type AuditFiltersInput } from "./audit-filter-definitions.ts";
import {
  buildAuditOverviewFields,
  formatDurationWithFirstToken,
  formatMediaSummary,
  formatTokenSummary,
  formattedResponseBody,
} from "./audit-detail-format.ts";
import type { AuditAttemptDTO, AuditDTO } from "./request-audits-api.ts";

function translate(key: string, options?: Record<string, unknown>): string {
  const count = options?.count;
  return count === undefined ? key : `${key}:${String(count)}`;
}

function audit(overrides: Partial<AuditDTO> = {}): AuditDTO {
  return {
    id: "audit-1",
    requestId: "req-1",
    clientKeyId: "key-1",
    modelRouteId: "route-1",
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
    durationMs: 1200,
    attemptCount: 1,
    createdAt: "2026-10-01T10:00:00.000Z",
    ...overrides,
  };
}

function attempt(overrides: Partial<AuditAttemptDTO> = {}): AuditAttemptDTO {
  return {
    id: "attempt-1",
    number: 1,
    source: "upstream_http",
    stage: "response_start",
    startedAt: "2026-10-01T10:00:01.000Z",
    durationMs: 800,
    responseHeaders: {},
    responseBody: '{"a":1}',
    responseBodyEncoding: "utf8",
    responseBodyTruncated: false,
    errorChain: [],
    ...overrides,
  };
}

const formatNumber = (value: number): string => new Intl.NumberFormat("en-US").format(value);

describe("formatTokenSummary", () => {
  it("无任何 token 计数时为 null，否则按输入/缓存/输出/推理/总量拼接", () => {
    assert.equal(
      formatTokenSummary(
        audit({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, totalTokens: 0 }),
        formatNumber,
        translate,
      ),
      null,
    );
    assert.equal(
      formatTokenSummary(audit(), formatNumber, translate),
      "audits.input 100 (audits.cached 20) · audits.output 30 (audits.reasoning 5) · audits.total 130",
    );
    assert.equal(
      formatTokenSummary(audit({ cachedInputTokens: 0, reasoningTokens: 0 }), formatNumber, translate),
      "audits.input 100 · audits.output 30 · audits.total 130",
    );
  });
});

describe("formatDurationWithFirstToken", () => {
  it("首 token 缺失时不追加括号说明", () => {
    assert.equal(formatDurationWithFirstToken(audit(), formatNumber, translate), "1,200 ms");
    assert.equal(
      formatDurationWithFirstToken(audit({ firstTokenMs: 300 }), formatNumber, translate),
      "1,200 ms (audits.firstTokenMs: 300 ms)",
    );
  });
});

describe("formatMediaSummary", () => {
  it("无媒体用量时为 null，否则按输入/输出/秒数拼接", () => {
    assert.equal(formatMediaSummary(audit(), translate), null);
    assert.equal(
      formatMediaSummary(audit({ mediaInputImages: 2 }), translate),
      "audits.mediaInput: audits.imageCount:2",
    );
    assert.equal(
      formatMediaSummary(audit({ mediaOutputImages: 1, mediaOutputSeconds: 6 }), translate),
      "audits.mediaOutput: audits.imageCount:1 · audits.secondsCount:6",
    );
  });
});

describe("buildAuditOverviewFields", () => {
  it("基础字段顺序固定，错误码/用量/媒体为可选整行字段", () => {
    const base = buildAuditOverviewFields(audit({ modelPublicId: "grok-4" }), formatNumber, "$1.00", translate);
    assert.deepEqual(
      base.map((field) => field.label),
      [
        "audits.targetAccount",
        "audits.requestModel",
        "audits.upstreamModel",
        "audits.clientApiKey",
        "audits.clientIp",
        "audits.egressNode",
        "audits.duration",
        "audits.cost",
        "audits.tokenUsage",
      ],
    );
    assert.equal(base[0].value, "-");
    assert.equal(base[1].copy, true);
    assert.equal(base[7].value, "$1.00");
    assert.equal(base[8].fullWidth, true);
  });

  it("带上错误码与媒体用量时追加对应整行字段", () => {
    const fields = buildAuditOverviewFields(
      audit({ errorCode: "upstream_unavailable", mediaInputImages: 3, mediaOutputSeconds: 8 }),
      formatNumber,
      "$0.10",
      translate,
    );
    const labels = fields.map((field) => field.label);
    assert.deepEqual(labels.slice(-3), ["audits.errorLabel", "audits.tokenUsage", "audits.mediaInput"]);
    assert.equal(fields.at(-1)?.value, "audits.mediaInput: audits.imageCount:3 · audits.secondsCount:8");
  });
});

describe("formattedResponseBody", () => {
  it("base64 与非 JSON 非流式响应保持原文，JSON 与流式响应做美化", () => {
    assert.equal(formattedResponseBody(attempt({ responseBodyEncoding: "base64" })), '{"a":1}');
    assert.equal(formattedResponseBody(attempt()), '{"a":1}');
    assert.equal(
      formattedResponseBody(attempt({ responseHeaders: { "Content-Type": ["application/json; charset=utf-8"] } })),
      '{\n  "a": 1\n}',
    );
    assert.equal(formattedResponseBody(attempt({ stage: "response_stream" })), '{\n  "a": 1\n}');
    assert.equal(formattedResponseBody(attempt({ responseBody: "not json" })), "not json");
  });
});

describe("buildAuditFilters", () => {
  const group = buildAuditFilterOptionGroup({
    id: "key",
    t: translate,
    items: [{ id: "1", label: "生产密钥", description: "#1 · abcd" }],
    total: 2,
    failed: false,
    fetching: false,
    onRetry: () => undefined,
  });

  const input: AuditFiltersInput = {
    t: translate,
    model: { value: "", onChange: () => undefined, options: [{ value: "grok-4", label: "grok-4" }] },
    status: { value: "", onChange: () => undefined },
    mode: { value: "", onChange: () => undefined },
    key: {
      value: "",
      onChange: () => undefined,
      group: { group, search: "", onSearchChange: () => undefined, onOpenChange: () => undefined },
    },
    account: {
      value: "",
      onChange: () => undefined,
      group: { group, search: "ab", onSearchChange: () => undefined, onOpenChange: () => undefined },
    },
  };

  it("固定返回 model/status/mode/key/account 五个筛选", () => {
    assert.deepEqual(
      buildAuditFilters(input).map((filter) => filter.id),
      ["model", "status", "mode", "key", "account"],
    );
  });

  it("状态与模式筛选项使用既有 i18n 文案", () => {
    const [, status, mode] = buildAuditFilters(input);
    assert.deepEqual("options" in status ? status.options.map((option) => option.value) : [], [
      "2xx",
      "4xx",
      "5xx",
      "other",
    ]);
    assert.deepEqual("options" in mode ? mode.options.map((option) => option.value) : [], ["stream", "nonStream"]);
  });

  it("密钥/账号筛选项挂载三级菜单与组内搜索", () => {
    const key = buildAuditFilters(input)[3];
    const option = "options" in key ? key.options[0] : undefined;
    assert.equal(option?.value, "any");
    assert.equal(option?.groups?.[0].options[0].label, "生产密钥");
    assert.equal(option?.groupSearch?.value, "");
  });
});

describe("buildAuditFilterOptionGroup", () => {
  it("失败时展示失败文案并可重试，加载中展示加载文案", () => {
    const failed = buildAuditFilterOptionGroup({
      id: "account",
      t: translate,
      items: [],
      total: 0,
      failed: true,
      fetching: false,
      onRetry: () => undefined,
    });
    assert.equal(failed.emptyLabel, "audits.filterOptionsLoadFailed");
    assert.equal(failed.hasMore, true);
    assert.equal(failed.actionLabel, "common.retry");

    const loading = buildAuditFilterOptionGroup({
      id: "account",
      t: translate,
      items: [],
      total: 0,
      failed: false,
      fetching: true,
      onRetry: () => undefined,
    });
    assert.equal(loading.emptyLabel, "common.loading");
    assert.equal(loading.loading, true);
  });

  it("结果被截断时展示前 50 条提示，未截断时不展示", () => {
    const truncated = buildAuditFilterOptionGroup({
      id: "account",
      t: translate,
      items: [{ id: "1", label: "账号 A", description: "#1" }],
      total: 60,
      failed: false,
      fetching: false,
      onRetry: () => undefined,
    });
    assert.equal(truncated.noteLabel, "audits.filterOptionsTruncated");
    assert.equal(truncated.options[0].description, "#1");
    assert.equal(truncated.hideLabel, true);
  });
});
