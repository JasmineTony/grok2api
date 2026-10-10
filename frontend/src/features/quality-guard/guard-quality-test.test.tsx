import { describe, expect, it } from "vitest";

import { classifyQualityTest, qualityTestState } from "@/features/quality-guard/guard-quality-test";
import type { QualityGuardStatus, QualityTestResult } from "@/features/quality-guard/quality-guard-api";

// 手动探测结果 → 节点状态的本地判定：纯逻辑模块用 vitest（v8 覆盖率）运行，
// 按 AGENTS.md TEST-3 覆盖正常/异常/边界路径（与 sidecar 判定顺序一致）。

function result(overrides: Partial<QualityTestResult> = {}): QualityTestResult {
  return {
    nodeId: "node-1",
    statusCode: 200,
    firstTokenMs: 120,
    durationMs: 2_000,
    outputTokens: 128,
    reasoningTokens: 16,
    visibleTokens: 112,
    outputTokensPerSecond: 320,
    generationMs: 2_000,
    expectedMatched: true,
    thinkingRequired: false,
    ...overrides,
  };
}

function status(overrides: Partial<QualityGuardStatus> = {}): QualityGuardStatus {
  return {
    available: true,
    editable: true,
    activeProfileId: "profile-1",
    profiles: [
      {
        id: "profile-1",
        name: "方案一",
        built_in: false,
        match_mode: "last_line",
        has_expected: true,
        require_thinking: true,
      },
    ],
    config: {
      mode: "hybrid",
      model: "grok-4",
      node_ids: ["node-1"],
      active_interval_seconds: 1800,
      passive_poll_seconds: 5,
      soft_tps: 500,
      hard_tps: 1000,
      consecutive_soft: 3,
      consecutive_errors: 2,
      quarantine_seconds: 300,
      min_healthy_nodes: 1,
      max_output_tokens: 512,
      fail_closed: false,
      min_generation_ms: 0,
    },
    ...overrides,
  };
}

describe("classifyQualityTest", () => {
  it("缺少配置与方案时使用默认阈值，并默认要求期望标记", () => {
    expect(classifyQualityTest(result({ expectedMatched: false }), { available: true })).toEqual({
      classification: "hard",
      reason: "expected_marker_missing",
    });
    expect(classifyQualityTest(result({ outputTokensPerSecond: 1_200 }), { available: true })).toEqual({
      classification: "hard",
      reason: "hard_tps",
    });
    expect(classifyQualityTest(result({ outputTokensPerSecond: 600 }), { available: true })).toEqual({
      classification: "soft",
      reason: "soft_tps",
    });
    expect(classifyQualityTest(result(), { available: true })).toEqual({
      classification: "healthy",
      reason: "within_threshold",
    });
  });

  it("方案不要求期望标记时，不因缺少标记判失败", () => {
    const noExpected = status({
      profiles: [
        {
          id: "profile-1",
          name: "方案一",
          built_in: false,
          match_mode: "regex",
          has_expected: false,
          require_thinking: false,
        },
      ],
    });
    expect(classifyQualityTest(result({ expectedMatched: false }), noExpected)).toEqual({
      classification: "healthy",
      reason: "within_threshold",
    });
  });

  it("输出不足 32 token 判 soft，缺思考 token 且要求思考时判 hard", () => {
    expect(classifyQualityTest(result({ outputTokens: 31 }), status())).toEqual({
      classification: "soft",
      reason: "insufficient_output_tokens",
    });
    expect(
      classifyQualityTest(result({ thinkingRequired: true, outputTokens: 64, reasoningTokens: 0 }), status()),
    ).toEqual({
      classification: "hard",
      reason: "missing_thinking",
    });
    expect(
      classifyQualityTest(result({ thinkingRequired: true, outputTokens: 200, reasoningTokens: 8 }), status()),
    ).toEqual({ classification: "healthy", reason: "within_threshold" });
  });

  it("failClosed 下按生成窗口区分 buffered_burst 与 insufficient_generation_window", () => {
    const failClosed = status({
      config: { ...status().config!, fail_closed: true, min_generation_ms: 2_000 },
    });
    expect(classifyQualityTest(result({ generationMs: 800, outputTokensPerSecond: 900 }), failClosed)).toEqual({
      classification: "hard",
      reason: "buffered_burst",
    });
    expect(classifyQualityTest(result({ generationMs: 800, outputTokensPerSecond: 120 }), failClosed)).toEqual({
      classification: "soft",
      reason: "insufficient_generation_window",
    });
  });

  it("阈值与 failClosed 关闭时按 TPS 判定 hard / soft", () => {
    expect(classifyQualityTest(result({ outputTokensPerSecond: 1_000 }), status())).toEqual({
      classification: "hard",
      reason: "hard_tps",
    });
    expect(classifyQualityTest(result({ outputTokensPerSecond: 500 }), status())).toEqual({
      classification: "soft",
      reason: "soft_tps",
    });
  });
});

describe("qualityTestState", () => {
  it("把探测结果映射为节点状态：soft 记 1 次软命中", () => {
    const state = qualityTestState(
      result({ outputTokensPerSecond: 600, outputTokens: 130, firstTokenMs: 90 }),
      status(),
    );
    expect(state.active_soft_strikes).toBe(1);
    expect(state.passive_soft_strikes).toBe(0);
    expect(state.disabled_by_guard).toBe(false);
    expect(state.last_reason).toBe("soft_tps");
    expect(state.last_classification).toBe("soft");
    expect(state.last_source).toBe("active");
    expect(state.last_output_tps).toBe(600);
    expect(state.last_output_tokens).toBe(130);
    expect(state.last_first_token_ms).toBe(90);
    expect(state.observe_only).toBe(false);
    expect(state.quarantined_lease_count).toBe(0);
  });

  it("hard 命中使用配置的 consecutive_soft，缺少配置时回退 2", () => {
    expect(qualityTestState(result({ outputTokensPerSecond: 1_200 }), status()).active_soft_strikes).toBe(3);
    expect(qualityTestState(result({ outputTokensPerSecond: 1_200 }), { available: true }).active_soft_strikes).toBe(2);
  });

  it("健康探测不累计软命中", () => {
    const state = qualityTestState(result(), status());
    expect(state.active_soft_strikes).toBe(0);
    expect(state.last_classification).toBe("healthy");
    expect(state.last_reason).toBe("within_threshold");
    expect(state.last_probe_at).toBeGreaterThan(0);
  });
});
