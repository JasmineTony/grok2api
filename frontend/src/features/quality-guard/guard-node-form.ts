import type { EgressNodeInput } from "@/features/settings/settings-api";

// 出口节点表单的初始值与提交映射：从 quality-guard-page.tsx 拆出，供弹窗状态与保存 mutation 共用。

export function emptyNodeInput(): EgressNodeInput {
  return {
    name: "",
    scope: "grok_build",
    enabled: true,
    proxyPool: false,
    accountCapacity: 0,
    proxyURL: "",
    userAgent: "",
    cloudflareCookies: "",
  };
}

// 守护页只维护 Grok Build 范围的节点：User-Agent 与 Cookie 由出口设置页负责，提交时显式清空。
export function nodeInputFromForm(form: EgressNodeInput): EgressNodeInput {
  return {
    ...form,
    name: form.name.trim(),
    scope: "grok_build",
    proxyURL: form.proxyURL?.trim() || undefined,
    userAgent: "",
    cloudflareCookies: undefined,
  };
}
