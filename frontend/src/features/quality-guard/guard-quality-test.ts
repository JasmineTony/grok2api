import type {
  QualityGuardNodeState,
  QualityGuardStatus,
  QualityTestResult,
} from "@/features/quality-guard/quality-guard-api";

// 手动探测结果 → 节点状态的本地判定：与 sidecar 的判定顺序保持一致，仅用于立即刷新表格展示。
// 拆分为「分类」与「状态构造」两步，避免单个函数同时承担判定与字段映射。

type QualityTestClassification = { classification: string; reason: string };

export function classifyQualityTest(result: QualityTestResult, status: QualityGuardStatus): QualityTestClassification {
  const softTPS = status.config?.soft_tps ?? 500;
  const hardTPS = status.config?.hard_tps ?? 1000;
  const profile = status.profiles?.find((item) => item.id === status.activeProfileId);
  const hasExpected = profile?.has_expected ?? true;
  const failClosed = status.config?.fail_closed ?? false;
  const minimumGenerationMS = status.config?.min_generation_ms ?? 0;
  if (hasExpected && !result.expectedMatched) return { classification: "hard", reason: "expected_marker_missing" };
  if (result.outputTokens < 32) return { classification: "soft", reason: "insufficient_output_tokens" };
  if (result.thinkingRequired && result.outputTokens >= 64 && result.reasoningTokens <= 0)
    return { classification: "hard", reason: "missing_thinking" };
  if (failClosed && result.generationMs < minimumGenerationMS && result.outputTokensPerSecond >= softTPS)
    return { classification: "hard", reason: "buffered_burst" };
  if (failClosed && result.generationMs < minimumGenerationMS)
    return { classification: "soft", reason: "insufficient_generation_window" };
  if (result.outputTokensPerSecond >= hardTPS) return { classification: "hard", reason: "hard_tps" };
  if (result.outputTokensPerSecond >= softTPS) return { classification: "soft", reason: "soft_tps" };
  return { classification: "healthy", reason: "within_threshold" };
}

export function qualityTestState(result: QualityTestResult, status: QualityGuardStatus): QualityGuardNodeState {
  const { classification, reason } = classifyQualityTest(result, status);
  const now = Date.now() / 1000;
  return {
    observe_only: false,
    observe_only_reason: "",
    quarantined_lease_count: 0,
    active_soft_strikes:
      classification === "soft" ? 1 : classification === "hard" ? (status.config?.consecutive_soft ?? 2) : 0,
    passive_soft_strikes: 0,
    error_strikes: 0,
    quarantined_until: 0,
    disabled_by_guard: false,
    last_reason: reason,
    last_probe_at: now,
    last_observed_at: now,
    last_source: "active",
    last_classification: classification,
    last_output_tps: result.outputTokensPerSecond,
    last_output_tokens: result.outputTokens,
    last_first_token_ms: result.firstTokenMs,
    last_duration_ms: result.durationMs,
  };
}
