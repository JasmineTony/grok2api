import { describe, expect, it } from "vitest";

import { formatDateTime, formatDuration, formatNumber, toDateTimeLocal } from "@/shared/lib/format";

describe("format helpers", () => {
  it("handles missing or invalid dates", () => {
    expect(formatDateTime(null, "en")).toBe("-");
    expect(formatDateTime("invalid", "en")).toBe("-");
  });
  it("formats numeric and duration boundaries", () => {
    expect(formatNumber(1234.56, "en-US", 1)).toBe("1,234.6");
    expect(formatDuration(999)).toBe("999 ms");
    expect(formatDuration(1000)).toBe("1.00 s");
    expect(formatDuration(10000)).toBe("10.0 s");
  });
  it("converts dates for datetime-local inputs", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(toDateTimeLocal("2026-01-01T00:00:00Z")).toMatch(/^2026-01-01T/);
  });
});
