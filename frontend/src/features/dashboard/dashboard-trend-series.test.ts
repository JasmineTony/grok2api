import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TFunction } from "i18next";

import { buildTrendChartConfig, resolveTrendAxes, TREND_SERIES } from "./dashboard-trend-series.ts";

const t = ((key: string) => key) as unknown as TFunction;

function hidden(...series: Array<"billing" | "tokens" | "requests">): ReadonlySet<"billing" | "tokens" | "requests"> {
  return new Set(series);
}

describe("resolveTrendAxes", () => {
  it("三条可见时 tokens 左轴、billing 右轴", () => {
    assert.deepEqual(resolveTrendAxes(hidden()), { tokens: "left", billing: "right" });
  });

  it("两条可见时保留 tokens 左轴，否则 requests 左轴", () => {
    assert.deepEqual(resolveTrendAxes(hidden("requests")), { tokens: "left", billing: "right" });
    assert.deepEqual(resolveTrendAxes(hidden("billing")), { tokens: "left", requests: "right" });
    assert.deepEqual(resolveTrendAxes(hidden("tokens")), { requests: "left", billing: "right" });
  });

  it("一条可见时使用左轴，全部隐藏时不返回轴", () => {
    assert.deepEqual(resolveTrendAxes(hidden("billing", "requests")), { tokens: "left" });
    assert.deepEqual(resolveTrendAxes(hidden(...TREND_SERIES)), {});
  });
});

describe("buildTrendChartConfig", () => {
  it("为三条序列提供标签与主题色", () => {
    const config = buildTrendChartConfig(t);

    assert.equal(config.tokens?.label, "dashboard.trendTokens");
    assert.equal(config.billing?.label, "dashboard.billing");
    assert.equal(config.requests?.label, "dashboard.trendRequests");
    assert.equal(config.tokens?.theme?.light, "oklch(0.68 0.15 245)");
  });
});
