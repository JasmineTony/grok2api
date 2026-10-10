import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ACTIVITY_INTENSITY_CLASSES,
  activityLevel,
  buildActivityWeeks,
  formatActivityDate,
  formatActivityRange,
} from "./dashboard-activity-format.ts";

const activity = [
  { start: "2026-01-01T00:00:00", requests: 1 },
  { start: "2026-01-02T00:00:00", requests: 50 },
  { start: "2026-01-03T00:00:00", requests: 0 },
];

describe("buildActivityWeeks", () => {
  it("每 7 天一组", () => {
    const weeks = buildActivityWeeks([...activity, ...activity, ...activity]);

    assert.equal(weeks.length, 2);
    assert.equal(weeks[0].length, 7);
    assert.equal(weeks[1].length, 2);
  });

  it("空数据返回空数组", () => {
    assert.deepEqual(buildActivityWeeks([]), []);
  });
});

describe("activityLevel", () => {
  it("按对数比例分级，零与无最大值返回 0", () => {
    assert.equal(activityLevel(0, 100), 0);
    assert.equal(activityLevel(10, 0), 0);
    assert.equal(activityLevel(1, 1_000_000), 1);
    assert.equal(activityLevel(1_000_000, 1_000_000), 4);
    assert.equal(ACTIVITY_INTENSITY_CLASSES.length, 5);
  });
});

describe("formatActivityRange", () => {
  it("使用最后一个不晚于生成时间的桶作为结束", () => {
    assert.equal(formatActivityRange(activity, "en", new Date("2026-01-02T12:00:00").getTime()), "Jan 1 – Jan 2");
  });

  it("全部晚于生成时间时回退到首个桶，空数据返回占位符", () => {
    assert.equal(formatActivityRange(activity, "en", new Date("2025-12-31T00:00:00").getTime()), "Jan 1 – Jan 1");
    assert.equal(formatActivityRange([], "en", 0), "-");
    assert.equal(formatActivityDate("2026-01-01T00:00:00", "en"), "Jan 1");
  });
});
