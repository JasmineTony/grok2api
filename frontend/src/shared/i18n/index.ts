import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { resources } from "./resources";

function readStoredLanguage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("grok2api:language");
  } catch {
    return null;
  }
}

function storeLanguage(language: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem("grok2api:language", language);
  } catch {
    // Language changes still apply when browser storage is unavailable.
  }
}

const storedLanguage = readStoredLanguage();

void i18n.use(initReactI18next).init({
  resources,
  lng: storedLanguage === "en" ? "en" : "zh-CN",
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
});

const DEFERRED_LANGUAGES = ["zh-CN", "en"] as const;

let deferredResourcesPromise: Promise<void> | null = null;

/**
 * 懒加载 12 个非首屏领域文案（`./resources/deferred`）并合并进当前 i18n 实例。
 *
 * - 单例缓存：重复调用复用同一个 Promise，chunk 只会被请求一次；
 * - 失败不静默吞掉：Promise 会 reject，由调用方（`app/deferred-pages.tsx` 的懒加载包装）
 *   决定如何暴露，让 chunk 加载失败上抛给 ErrorBoundary，而不是永久停在加载态。
 * - 必须在任何懒加载页面渲染之前完成，否则页面会短暂渲染出未翻译的 key。
 */
export function loadDeferredResources(): Promise<void> {
  deferredResourcesPromise ??= import("./resources/deferred").then(({ default: deferred }) => {
    for (const language of DEFERRED_LANGUAGES) {
      i18n.addResourceBundle(language, "translation", deferred[language].translation, true, true);
    }
  });
  return deferredResourcesPromise;
}

i18n.on("languageChanged", (language) => {
  storeLanguage(language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
});

if (typeof document !== "undefined") document.documentElement.lang = i18n.language;

export { i18n };
