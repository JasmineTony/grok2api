import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatBucketRange, formatBucketTick, shouldShowTick } from "./dashboard-trend-buckets.ts";

describe("formatBucketRange", () => {
  it("24h 显示时分区间，其他周期显示日期", () => {
    assert.equal(formatBucketRange("2026-01-01T00:00:00", "2026-01-01T01:00:00", "24h", "en"), "00:00–01:00");
    assert.equal(formatBucketRange("2026-01-01T00:00:00", "2026-01-02T00:00:00", "7d", "en"), "Jan 1");
    assert.equal(formatBucketRange("2026-01-01T00:00:00", "2026-01-03T00:00:00", "30d", "en"), "Jan 1");
  });

  it("90d 使用闭区间（结束时间减去 1ms）", () => {
    assert.equal(formatBucketRange("2026-01-01T00:00:00", "2026-01-03T00:00:00", "90d", "en"), "Jan 1–Jan 2");
  });

  it("缺失时间戳返回占位符", () => {
    assert.equal(formatBucketRange(undefined, "2026-01-01T00:00:00", "24h", "en"), "-");
    assert.equal(formatBucketRange("2026-01-01T00:00:00", undefined, "24h", "en"), "-");
  });
});

describe("shouldShowTick", () => {
  it("24h 每 3 个桶、30d 每 5 个桶、90d 每桶，且末位始终显示", () => {
    assert.equal(shouldShowTick(0, 24, "24h"), true);
    assert.equal(shouldShowTick(1, 24, "24h"), false);
    assert.equal(shouldShowTick(3, 24, "24h"), true);
    assert.equal(shouldShowTick(1, 30, "30d"), false);
    assert.equal(shouldShowTick(5, 30, "30d"), true);
    assert.equal(shouldShowTick(2, 90, "90d"), true);
    assert.equal(shouldShowTick(7, 8, "24h"), true);
  });
});

describe("formatBucketTick", () => {
  it("24h 显示时分，其他周期显示月/日", () => {
    assert.equal(formatBucketTick("2026-01-01T05:00:00", "24h", "en-GB"), "05:00");
    assert.equal(formatBucketTick("2026-01-01T05:00:00", "30d", "en"), "1/1");
  });
});
