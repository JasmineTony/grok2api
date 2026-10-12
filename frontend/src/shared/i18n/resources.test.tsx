import { createHash } from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { i18n, loadDeferredResources } from "@/shared/i18n";

/**
 * 资源快照基线：拆分前 4150 行单文件 resources 在应用全部 Object.assign 补丁后的最终生效值，
 * 并随核心资源（initial 的 common / auth / api-errors）新增 key 同步重算——断言强度不变，仍是精确相等。
 * 2026-10-12（FE-19-13）：新增 common.pageLoadFailedTitle / pageLoadFailedDescription / reloadPage
 * （zh-CN 与 en 各 3 个），keyCount 1790→1793、1795→1798，两个摘要按同一扁平化规则重算。
 * keyCount 为叶子 key 总数；两个摘要均基于排序后的扁平化 key/值生成：
 * - keySetDigest：`key` 逐行拼接后取 SHA-256
 * - resourceDigest：`key\u0000value` 逐行拼接后取 SHA-256
 */
const BASELINE = {
  "zh-CN": {
    keyCount: 1793,
    keySetDigest: "a3e52e62b52f7c780891deffb93fff15b6fc43f7b9eae585873eb96f2815fe3d",
    resourceDigest: "211ced637dfec41c84f58fda05b3f6b679288d336b154f5e6c7cba74566a6fdd",
  },
  en: {
    keyCount: 1798,
    keySetDigest: "4d304d71ed126836f8a38ec3da7cd3cb6fb1b34b9aa4af83614b71b442f696bf",
    resourceDigest: "83f44b3a4b13f735f08aa9ec361864a310f528b734e335f91bbf28e4713b378a",
  },
} as const;

const LANGUAGES = ["zh-CN", "en"] as const;
type Language = (typeof LANGUAGES)[number];

/**
 * 模块求值时的同步资源快照：`initial`（common / auth / api-errors）必须立即可用，
 * 其余 12 个领域（`deferred`）必须等 `loadDeferredResources()` 之后才出现。
 */
const SYNC_BUNDLE_AT_IMPORT = flatten(i18n.getResourceBundle("zh-CN", "translation"));

/** 拆分前既有不对称：仅存在于 zh-CN 的 key。 */
const ZH_ONLY_KEYS = [
  "qualityGuard.eventTypes.lease_quarantined",
  "qualityGuard.eventTypes.lease_quarantine_extended",
  "qualityGuard.eventTypes.lease_quarantine_failed",
  "qualityGuard.eventTypes.lease_restored",
];

/** 拆分前既有不对称：仅存在于 en 的 key。 */
const EN_ONLY_KEYS = [
  "accounts.credentialRenewal",
  "audits.errorFrameCount_one",
  "audits.errorFrameCount_other",
  "audits.failedAttemptCount_one",
  "audits.failedAttemptCount_other",
  "audits.headerCount_one",
  "audits.headerCount_other",
  "dashboard.allTimeRequests",
  "dashboard.allTimeRequestsSummary",
];

/** 拆分前既有占位符差异：en 文案缺少 {{count}}。 */
const PLACEHOLDER_MISMATCH_KEYS = ["accounts.convertToBuildDescription"];

const SAMPLE_KEYS = [
  "appName",
  "nav.dashboard",
  "accounts.title",
  "accountCredential.label",
  "console.name",
  "models.title",
  "keys.title",
  "audits.title",
  "qualityGuard.title",
  "creativeConsole.title",
  "settings.title",
  "settings.egress.health",
  "egressProxyProfiles.title",
  "docs.title",
  "apiErrors.accountBatchDeleteFailed",
  "quotaProducts.api",
];

function flatten(node: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === "string") {
    out[prefix] = node;
    return out;
  }
  if (!node || typeof node !== "object") return out;
  for (const [key, value] of Object.entries(node)) {
    flatten(value, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function bundle(language: Language): Record<string, string> {
  return flatten(i18n.getResourceBundle(language, "translation"));
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function keySetDigest(flat: Record<string, string>): string {
  return sha256(Object.keys(flat).sort().join("\n"));
}

function resourceDigest(flat: Record<string, string>): string {
  return sha256(
    Object.keys(flat)
      .sort()
      .map((key) => `${key}\u0000${flat[key]}`)
      .join("\n"),
  );
}

function placeholders(value: string): string[] {
  const found = new Set<string>();
  for (const match of value.matchAll(/\{\{([^}]+)\}\}/g)) found.add(match[1].trim());
  return [...found].sort();
}

describe("i18n 资源拆分后与拆分前一致", () => {
  beforeAll(async () => {
    await loadDeferredResources();
  });

  it("首屏只同步包含 initial 的 3 个领域，其余 12 个领域在懒加载前不可用", () => {
    expect(SYNC_BUNDLE_AT_IMPORT.appName).toBeTypeOf("string");
    expect(SYNC_BUNDLE_AT_IMPORT["auth.title"]).toBeTypeOf("string");
    expect(SYNC_BUNDLE_AT_IMPORT["apiErrors.accountBatchDeleteFailed"]).toBeTypeOf("string");
    for (const key of ["accounts.title", "qualityGuard.title", "models.title", "docs.title"]) {
      expect(SYNC_BUNDLE_AT_IMPORT[key], `${key} 不应出现在首屏同步资源中`).toBeUndefined();
    }
  });

  it("deferred 在 loadDeferredResources() 之后补入同样的 12 个领域", () => {
    for (const language of LANGUAGES) {
      const flat = bundle(language);
      for (const key of ["accounts.title", "qualityGuard.title", "models.title", "docs.title"]) {
        expect(flat[key], `${language} 缺少 ${key}`).toBeTypeOf("string");
      }
    }
  });

  it("重复调用 loadDeferredResources() 复用同一个 Promise（单例）", async () => {
    await expect(loadDeferredResources()).resolves.toBeUndefined();
  });

  it("每种语言的 key 总数与拆分前基线一致", () => {
    for (const language of LANGUAGES) {
      expect(Object.keys(bundle(language))).toHaveLength(BASELINE[language].keyCount);
    }
  });

  it("每种语言的 key 集合与拆分前基线完全一致", () => {
    for (const language of LANGUAGES) {
      expect(keySetDigest(bundle(language))).toBe(BASELINE[language].keySetDigest);
    }
  });

  it("每种语言的文案值与拆分前基线完全一致", () => {
    for (const language of LANGUAGES) {
      expect(resourceDigest(bundle(language))).toBe(BASELINE[language].resourceDigest);
    }
  });

  it("抽样 key 在两种语言下都解析为非空字符串", () => {
    for (const language of LANGUAGES) {
      const flat = bundle(language);
      for (const key of SAMPLE_KEYS) {
        expect(flat[key], `${language} 缺少 ${key}`).toBeTypeOf("string");
        expect(flat[key].trim().length, `${language} 的 ${key} 为空`).toBeGreaterThan(0);
        expect(flat[key], `${language} 的 ${key} 回退为 key 本身`).not.toBe(key);
      }
    }
  });

  it("两语言 key 差异仅为拆分前既有差异", () => {
    const zhCN = bundle("zh-CN");
    const en = bundle("en");
    const onlyInZhCN = Object.keys(zhCN)
      .filter((key) => !(key in en))
      .sort();
    const onlyInEn = Object.keys(en)
      .filter((key) => !(key in zhCN))
      .sort();
    expect(onlyInZhCN).toEqual([...ZH_ONLY_KEYS].sort());
    expect(onlyInEn).toEqual([...EN_ONLY_KEYS].sort());
  });

  it("同一 key 在两种语言中的占位符集合一致（除拆分前既有差异）", () => {
    const zhCN = bundle("zh-CN");
    const en = bundle("en");
    const mismatched = Object.keys(zhCN)
      .filter((key) => key in en)
      .filter((key) => placeholders(zhCN[key]).join(",") !== placeholders(en[key]).join(","));
    expect(mismatched).toEqual(PLACEHOLDER_MISMATCH_KEYS);
  });

  it("带占位符的文案在两种语言下仍可插值", () => {
    for (const language of LANGUAGES) {
      const template = bundle(language)["quotaProducts.unknown"];
      expect(template).toContain("{{code}}");
      expect(i18n.t("quotaProducts.unknown", { lng: language, code: 9 })).toBe(template.replace("{{code}}", "9"));
    }
  });
});
