import { describe, expect, it } from "vitest";

import { en } from "@/shared/i18n/locales/en";
import { zhCN } from "@/shared/i18n/locales/zh-CN";

function flattenKeys(value: object, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, nested]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof nested === "object" && nested !== null
      ? flattenKeys(nested as object, path)
      : [path];
  });
}

describe("i18n resources", () => {
  it("keeps Chinese and English translation keys synchronized", () => {
    expect(flattenKeys(en).sort()).toEqual(flattenKeys(zhCN).sort());
  });

  it("contains non-empty leaf values", () => {
    for (const resource of [zhCN, en]) {
      expect(flattenKeys(resource).length).toBeGreaterThan(100);
      expect(Object.values(resource).length).toBeGreaterThan(0);
    }
  });
});
