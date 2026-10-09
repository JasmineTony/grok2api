import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "grok2api:language";

type I18nInstance = (typeof import("@/shared/i18n"))["i18n"];

/** 重新导入模块，复现真实启动时序：先读 localStorage，再执行 i18n.init。 */
async function importI18n(): Promise<I18nInstance> {
  vi.resetModules();
  const module = await import("@/shared/i18n");
  await new Promise((resolve) => setTimeout(resolve, 0));
  return module.i18n;
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "";
});

afterEach(() => {
  vi.resetModules();
  window.localStorage.clear();
});

describe("i18n 语言记忆与回退", () => {
  it("记忆为 en 时初始化使用 en", async () => {
    window.localStorage.setItem(STORAGE_KEY, "en");
    const instance = await importI18n();
    expect(instance.language).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });

  it("记忆为 zh-CN 时初始化使用 zh-CN", async () => {
    window.localStorage.setItem(STORAGE_KEY, "zh-CN");
    const instance = await importI18n();
    expect(instance.language).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("没有记忆值时默认 zh-CN", async () => {
    const instance = await importI18n();
    expect(instance.language).toBe("zh-CN");
  });

  it("记忆值非法时回退到 zh-CN", async () => {
    window.localStorage.setItem(STORAGE_KEY, "fr-FR");
    const instance = await importI18n();
    expect(instance.language).toBe("zh-CN");
  });

  it("切换语言会写入记忆并更新 document.documentElement.lang", async () => {
    const instance = await importI18n();
    await instance.changeLanguage("en");
    expect(instance.language).toBe("en");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(instance.t("appName")).toBe("Grok2API");

    await instance.changeLanguage("zh-CN");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("zh-CN");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("fallbackLng 为 zh-CN：en 缺失的 key 回退到中文文案", async () => {
    const instance = await importI18n();
    const zhCNText = instance.getResource("zh-CN", "translation", "qualityGuard.eventTypes.lease_quarantined");
    expect(zhCNText).toBeTypeOf("string");
    expect(instance.t("qualityGuard.eventTypes.lease_quarantined", { lng: "en" })).toBe(zhCNText);
  });
});
