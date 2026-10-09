import type { EgressScope } from "@/features/settings/settings-api";

/** 出口作用域的固定顺序：下拉选项、筛选与兜底行共用，避免多处各写一份列表。 */
export const egressScopes: EgressScope[] = [
  "grok_build",
  "grok_web",
  "grok_console",
  "grok_web_asset",
  "grok_console_asset",
];
