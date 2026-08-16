import { describe, expect, it } from "vitest";

import {
  type AuditUsageInput,
  type AuditUsageLabels,
  buildAuditUsageView,
  MISSING_AUDIT_USAGE_PLACEHOLDER,
} from "@/features/audits/audit-usage";

const labels: AuditUsageLabels = {
  input: "输入",
  output: "输出",
  cached: "缓存",
  reasoning: "推理",
  mediaInput: "媒体输入",
  mediaOutput: "媒体输出",
  imageCount: (count) => `${count} 张`,
  secondsCount: (count) => `${count} 秒`,
};

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function audit(overrides: Partial<AuditUsageInput> = {}): AuditUsageInput {
  return {
    operation: "responses",
    usageSource: "upstream",
    mediaInputImages: 0,
    mediaOutputImages: 0,
    mediaOutputSeconds: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    durationMs: 1200,
    ...overrides,
  };
}

function values(
  items: Array<{ key: string; value: string }> | undefined,
  key: string,
): string | undefined {
  return items?.find((item) => item.key === key)?.value;
}

describe("buildAuditUsageView", () => {
  it("keeps the token grid when a chat request has media input", () => {
    const view = buildAuditUsageView(
      audit({
        mediaInputImages: 10,
        inputTokens: 39229,
        cachedInputTokens: 128,
        outputTokens: 275,
        reasoningTokens: 269,
        totalTokens: 39832,
      }),
      formatNumber,
      labels,
    );

    expect(view.mode).toBe("metrics");
    expect(values(view.mediaItems, "mediaInput")).toBe("10 张");
    expect(view.mediaItems?.find((item) => item.key === "mediaOutput")?.label).toBe("媒体输出");
    expect(values(view.mediaItems, "mediaOutput")).toBe("0 张");
    expect(values(view.tokenItems, "input")).toBe("39,229");
    expect(values(view.tokenItems, "cached")).toBe("128");
    expect(values(view.tokenItems, "output")).toBe("275");
    expect(values(view.tokenItems, "reasoning")).toBe("269");
  });

  it("uses a dash when token usage is missing on a media request", () => {
    const view = buildAuditUsageView(
      audit({
        mediaInputImages: 10,
        usageSource: "none",
      }),
      formatNumber,
      labels,
    );

    expect(view.mode).toBe("metrics");
    expect(values(view.mediaItems, "mediaInput")).toBe("10 张");
    expect(values(view.tokenItems, "input")).toBe(MISSING_AUDIT_USAGE_PLACEHOLDER);
    expect(values(view.tokenItems, "cached")).toBe(MISSING_AUDIT_USAGE_PLACEHOLDER);
    expect(values(view.tokenItems, "output")).toBe(MISSING_AUDIT_USAGE_PLACEHOLDER);
    expect(values(view.tokenItems, "reasoning")).toBe(MISSING_AUDIT_USAGE_PLACEHOLDER);
  });

  it("still shows zero token counts when usage was reported", () => {
    const view = buildAuditUsageView(
      audit({
        mediaInputImages: 2,
        usageSource: "estimated",
      }),
      formatNumber,
      labels,
    );

    expect(values(view.tokenItems, "input")).toBe("0");
    expect(values(view.tokenItems, "output")).toBe("0");
  });

  it("keeps tokens next to video media counts", () => {
    const view = buildAuditUsageView(
      audit({
        operation: "video",
        mediaInputImages: 3,
        mediaOutputSeconds: 12,
        inputTokens: 80,
        outputTokens: 16,
        totalTokens: 96,
      }),
      formatNumber,
      labels,
    );

    expect(values(view.mediaItems, "mediaOutput")).toBe("12 秒");
    expect(values(view.tokenItems, "input")).toBe("80");
    expect(values(view.tokenItems, "output")).toBe("16");
  });

  it("does not invent media rows for plain chat", () => {
    const view = buildAuditUsageView(
      audit({
        inputTokens: 41332,
        cachedInputTokens: 39552,
        outputTokens: 267,
        reasoningTokens: 195,
        totalTokens: 41332,
      }),
      formatNumber,
      labels,
    );

    expect(view.mediaItems).toBe(undefined);
    expect(values(view.tokenItems, "input")).toBe("41,332");
    expect(values(view.tokenItems, "reasoning")).toBe("195");
  });

  it("keeps compaction and voice-style rows without a token grid", () => {
    expect(buildAuditUsageView(audit({ operation: "compaction" }), formatNumber, labels).mode).toBe(
      "compaction",
    );
    expect(
      buildAuditUsageView(audit({ operation: "tts", durationMs: 1540 }), formatNumber, labels).mode,
    ).toBe("duration");
  });
});
