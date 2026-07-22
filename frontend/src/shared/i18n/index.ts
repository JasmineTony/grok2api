import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { en } from "@/shared/i18n/locales/en";
import { zhCN } from "@/shared/i18n/locales/zh-CN";

const resources = {
  "zh-CN": { translation: zhCN },
  en: { translation: en },
} as const;

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

i18n.on("languageChanged", (language) => {
  storeLanguage(language);
  if (typeof document !== "undefined") document.documentElement.lang = language;
});

if (typeof document !== "undefined")
  document.documentElement.lang = i18n.language;

export { i18n, resources };
