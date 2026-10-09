import type { TFunction } from "i18next";
import { z } from "zod";

import type { ClientKeyDTO, ClientKeyInput } from "@/features/client-keys/client-keys-api";
import { toDateTimeLocal } from "@/shared/lib/format";
import { USD_TICKS_PER_DOLLAR } from "@/shared/lib/usd";

/** 用量上限（USD），与后端校验上限一致。 */
export const MAX_BILLING_LIMIT_USD = 900_000;

const DEFAULT_RPM_LIMIT = 120;
const DEFAULT_MAX_CONCURRENT = 8;
const DEFAULT_BILLING_LIMIT_USD = 10;

function clientKeyFields(t: TFunction) {
  return z.object({
    name: z.string().min(1, t("errors.required")),
    enabled: z.boolean(),
    expiryUnlimited: z.boolean(),
    expiresAt: z.string(),
    rpmUnlimited: z.boolean(),
    rpmLimit: z.number().int().min(1, t("errors.positive")).max(100_000),
    concurrencyUnlimited: z.boolean(),
    maxConcurrent: z.number().int().min(1, t("errors.positive")).max(1_024),
    billingUnlimited: z.boolean(),
    billingLimitUsd: z.number().min(0.01, t("errors.positive")).max(MAX_BILLING_LIMIT_USD),
    allowModelAliases: z.boolean(),
    modelScopeMode: z.enum(["all", "restricted"]),
    allowedModelIds: z.array(z.string()),
    providerScope: z.array(z.enum(["all", "grok_build", "grok_web", "grok_console"])).min(1),
    tierScope: z.array(z.enum(["all", "free", "super"])).min(1),
  });
}

export type ClientKeyFormValues = z.infer<ReturnType<typeof clientKeyFields>>;

export function createClientKeySchema(t: TFunction) {
  return clientKeyFields(t).superRefine((value, context) => {
    if (!value.expiryUnlimited && !value.expiresAt) {
      context.addIssue({ code: "custom", path: ["expiresAt"], message: t("errors.required") });
    }
    if (value.modelScopeMode === "restricted" && value.allowedModelIds.length === 0) {
      context.addIssue({ code: "custom", path: ["allowedModelIds"], message: t("keys.selectModelRequired") });
    }
  });
}

export function createClientKeyDefaults(): ClientKeyFormValues {
  return {
    name: "",
    enabled: true,
    expiryUnlimited: true,
    expiresAt: "",
    rpmUnlimited: false,
    rpmLimit: DEFAULT_RPM_LIMIT,
    concurrencyUnlimited: false,
    maxConcurrent: DEFAULT_MAX_CONCURRENT,
    billingUnlimited: true,
    billingLimitUsd: DEFAULT_BILLING_LIMIT_USD,
    allowModelAliases: false,
    modelScopeMode: "all",
    allowedModelIds: [],
    providerScope: ["all"],
    tierScope: ["all"],
  };
}

/** 把列表行 DTO 还原成表单值：0 表示「不限」，需映射回默认数值。 */
export function clientKeyToFormValues(key: ClientKeyDTO): ClientKeyFormValues {
  return {
    name: key.name,
    enabled: key.enabled,
    expiryUnlimited: !key.expiresAt,
    expiresAt: toDateTimeLocal(key.expiresAt),
    rpmUnlimited: key.rpmLimit === 0,
    rpmLimit: key.rpmLimit > 0 ? key.rpmLimit : DEFAULT_RPM_LIMIT,
    concurrencyUnlimited: key.maxConcurrent === 0,
    maxConcurrent: key.maxConcurrent > 0 ? key.maxConcurrent : DEFAULT_MAX_CONCURRENT,
    billingUnlimited: key.billingLimitUsdTicks === 0,
    billingLimitUsd:
      key.billingLimitUsdTicks > 0 ? key.billingLimitUsdTicks / USD_TICKS_PER_DOLLAR : DEFAULT_BILLING_LIMIT_USD,
    allowModelAliases: key.allowModelAliases,
    modelScopeMode: key.allowedModelIds.length > 0 ? "restricted" : "all",
    allowedModelIds: key.allowedModelIds,
    providerScope: key.providerScope ?? ["all"],
    tierScope: key.tierScope ?? ["all"],
  };
}

/** 表单值 → 创建/更新请求体（不限用 0 表示，与后端约定一致）。 */
export function clientKeyFormToInput(values: ClientKeyFormValues): ClientKeyInput {
  return {
    name: values.name,
    enabled: values.enabled,
    rpmLimit: values.rpmUnlimited ? 0 : values.rpmLimit,
    maxConcurrent: values.concurrencyUnlimited ? 0 : values.maxConcurrent,
    billingLimitUsdTicks: values.billingUnlimited ? 0 : Math.round(values.billingLimitUsd * USD_TICKS_PER_DOLLAR),
    allowModelAliases: values.allowModelAliases,
    allowedModelIds: values.allowedModelIds,
    providerScope: values.providerScope,
    tierScope: values.tierScope,
    expiresAt: values.expiryUnlimited ? "" : new Date(values.expiresAt).toISOString(),
  };
}
