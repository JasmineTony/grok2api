import { z } from "zod";

import type { Translate } from "@/features/accounts/accounts-view-model";

/** 账号编辑表单的校验契约：随账号编辑弹窗一起维护，页面只负责创建与提交。 */
export function createAccountFormSchema(t: Translate) {
  return z.object({
    name: z.string().min(1, t("errors.required")),
    enabled: z.boolean(),
    priority: z.number().int(),
    maxConcurrent: z.number().int().min(1, t("errors.positive")).max(256),
    minimumRemaining: z.number().min(0),
    cloudflareCookies: z.string().max(16 << 10, t("settings.invalidValue")),
    clearCloudflareCookies: z.boolean(),
    buildSuperEntitled: z.boolean(),
    buildRouteMode: z.enum(["auto", "build", "xai"]),
  });
}

export type AccountForm = z.infer<ReturnType<typeof createAccountFormSchema>>;

export function createAccountFormDefaults(): AccountForm {
  return {
    name: "",
    enabled: true,
    priority: 1,
    maxConcurrent: 8,
    minimumRemaining: 0,
    cloudflareCookies: "",
    clearCloudflareCookies: false,
    buildSuperEntitled: false,
    buildRouteMode: "auto",
  };
}
