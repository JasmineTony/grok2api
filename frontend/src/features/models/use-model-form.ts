import { zodResolver } from "@hookform/resolvers/zod";
import type { TFunction } from "i18next";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import type { ModelRouteDTO } from "@/entities/model/types";

// 模型创建/编辑表单的 schema、默认值与表单实例：从 models-page.tsx 拆出。
// schema 由工厂生成，保证校验文案跟随当前语言。

export type ModelForm = z.infer<ReturnType<typeof modelFormSchema>>;

export type ModelFormReturn = UseFormReturn<ModelForm>;

export function modelFormSchema(t: TFunction) {
  return z
    .object({
      publicId: z.string().min(1, t("errors.required")),
      provider: z.enum(["grok_build", "grok_web", "grok_console"]),
      upstreamModel: z.string().min(1, t("errors.required")),
      capability: z.enum(["responses", "chat", "image", "image_edit", "video", "tts", "stt", "realtime"]),
      enabled: z.boolean(),
      bindingMode: z.boolean(),
      accountIds: z.array(z.string()),
    })
    .refine((value) => !value.bindingMode || value.accountIds.length > 0, {
      path: ["accountIds"],
      message: t("models.selectAccountRequired"),
    });
}

export function emptyModelForm(): ModelForm {
  return {
    publicId: "",
    provider: "grok_build",
    upstreamModel: "",
    capability: "responses",
    enabled: true,
    bindingMode: false,
    accountIds: [],
  };
}

export function modelFormValues(model: ModelRouteDTO): ModelForm {
  return {
    publicId: model.publicId,
    provider: model.provider,
    upstreamModel: model.upstreamModel,
    capability: model.capability,
    enabled: model.enabled,
    bindingMode: model.bindingMode,
    accountIds: model.accountIds,
  };
}

export function useModelForm(): ModelFormReturn {
  const { t } = useTranslation();
  return useForm<ModelForm>({
    resolver: zodResolver(modelFormSchema(t)),
    defaultValues: emptyModelForm(),
  });
}
