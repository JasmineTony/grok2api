import type { EgressSourceInput } from "@/features/settings/settings-api";

/** 订阅源表单的本地形态：代理开关独立于后端 clearProxyURL 语义。 */
export type EgressSourceForm = Omit<EgressSourceInput, "url" | "proxyURL" | "clearProxyURL"> & {
  url: string;
  proxyEnabled: boolean;
  proxyURL: string;
};

export const emptyEgressSource: EgressSourceForm = {
  name: "",
  scope: "grok_build",
  enabled: true,
  url: "",
  proxyEnabled: false,
  proxyURL: "",
  refreshIntervalSeconds: 900,
  defaultAccountCapacity: 0,
};
