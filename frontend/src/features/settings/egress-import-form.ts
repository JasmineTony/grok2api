import type { EgressScope } from "@/features/settings/settings-api";

/** 导入表单的本地形态：名称/作用域/容量/代理列表文本。 */
export type EgressImportForm = { name: string; scope: EgressScope; accountCapacity: number; content: string };

export const emptyEgressImport: EgressImportForm = {
  name: "",
  scope: "grok_build",
  accountCapacity: 0,
  content: "",
};
