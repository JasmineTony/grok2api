import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  auditCacheRate,
  auditChannelProtocolLabel,
  auditErrorLabel,
  auditFilterOptionSearch,
  auditProtocolLabel,
  fallbackBillingBreakdown,
  providerLabel,
  providerShortLabel,
  reasoningEffortTone,
  splitDuration,
  statusTone,
} from "./audit-format.ts";
import type { AuditDTO } from "./request-audits-api.ts";

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
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
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

describe("splitDuration", () => {
  it("拆出数值与单位，无空格时单位为空", () => {
    assert.deepEqual(splitDuration("1.50 s"), { value: "1.50", unit: "s" });
    assert.deepEqual(splitDuration("—"), { value: "—", unit: "" });
  });
});

describe("statusTone", () => {
  it("按错误标记与状态段返回同一套色调", () => {
    assert.equal(statusTone(200).dot, "bg-emerald-500");
    assert.equal(statusTone(404).dot, "bg-amber-500");
    assert.equal(statusTone(503).dot, "bg-red-500");
    assert.equal(statusTone(0).dot, "bg-muted-foreground/50");
    assert.equal(statusTone(200, true).dot, "bg-amber-500");
  });
});

describe("reasoningEffortTone", () => {
  it("每个档位都有稳定色调", () => {
    const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "auto", "fixed"] as const;
    for (const effort of efforts) {
      assert.match(reasoningEffortTone(effort), /^text-/);
    }
  });
});

describe("provider / protocol 标签", () => {
  it("三种 provider 都有全称与简称，未知协议返回固定文案", () => {
    assert.equal(providerLabel("grok_build"), "Grok Build");
    assert.equal(providerLabel("grok_web"), "Grok Web");
    assert.equal(providerLabel("grok_console"), "Grok Console");
    assert.equal(providerShortLabel("grok_build"), "Build");
    assert.equal(providerShortLabel("grok_web"), "Web");
    assert.equal(providerShortLabel("grok_console"), "Console");
    assert.equal(auditProtocolLabel("responses"), "Responses");
    assert.equal(auditProtocolLabel("compaction"), "Responses Compact");
    assert.equal(auditProtocolLabel("chat"), "Chat Completions");
    assert.equal(auditProtocolLabel("messages"), "Anthropic Messages");
    assert.equal(auditProtocolLabel("image"), "Images");
    assert.equal(auditProtocolLabel("image_edit"), "Images");
    assert.equal(auditProtocolLabel("video"), "Videos");
    assert.equal(auditProtocolLabel("tts"), "Audio Speech");
    assert.equal(auditProtocolLabel("stt"), "Audio Transcriptions");
    assert.equal(auditProtocolLabel("realtime"), "Realtime");
    assert.equal(auditProtocolLabel("voice"), "Voice");
    assert.equal(
      auditChannelProtocolLabel({ provider: "grok_console", operation: "chat" }),
      "Grok Console · Chat Completions",
    );
  });
});

describe("auditFilterOptionSearch", () => {
  it("纯数字补 # 前缀，其余保留去空白后的原值", () => {
    assert.equal(auditFilterOptionSearch(" 128 "), "#128");
    assert.equal(auditFilterOptionSearch("g2a_abcd"), "g2a_abcd");
  });
});

describe("fallbackBillingBreakdown", () => {
  it("优先使用上游回报成本，其次使用已存估算，都没有时为 undefined", () => {
    assert.deepEqual(fallbackBillingBreakdown(audit({ costInUsdTicks: 42 }))?.method, "upstream_reported");
    const estimated = fallbackBillingBreakdown(
      audit({ pricingModel: "grok-4", pricingVersion: "v2", estimatedCostInUsdTicks: 7 }),
    );
    assert.equal(estimated?.method, "stored_estimate");
    assert.equal(estimated?.totalInUsdTicks, 7);
    assert.equal(fallbackBillingBreakdown(audit()), undefined);
  });
});

describe("auditCacheRate", () => {
  it("无输入 token 时为 0，否则按占比计算", () => {
    assert.equal(auditCacheRate(undefined), 0);
    assert.equal(auditCacheRate({ inputTokens: 0, cachedInputTokens: 10 }), 0);
    assert.equal(auditCacheRate({ inputTokens: 200, cachedInputTokens: 50 }), 25);
  });
});

describe("auditErrorLabel", () => {
  it("仅 2xx（或兼容 0）且带错误码时展示流式失败标记", () => {
    assert.deepEqual(auditErrorLabel(200, true), { showErrorLabel: true, statusPrefix: "200 · " });
    assert.deepEqual(auditErrorLabel(0, true), { showErrorLabel: true, statusPrefix: "" });
    assert.deepEqual(auditErrorLabel(500, true), { showErrorLabel: false, statusPrefix: "" });
    assert.deepEqual(auditErrorLabel(200, false), { showErrorLabel: false, statusPrefix: "" });
  });
});
