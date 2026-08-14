import type { TFunction } from "i18next";
import { z } from "zod";

export function createModelSchema(t: TFunction) {
  return z
    .object({
      publicId: z.string().min(1, t("errors.required")),
      provider: z.enum(["grok_build", "grok_web", "grok_console"]),
      upstreamModel: z.string().min(1, t("errors.required")),
      capability: z.enum([
        "responses",
        "chat",
        "image",
        "image_edit",
        "video",
        "tts",
        "stt",
        "realtime",
      ]),
      enabled: z.boolean(),
      bindingMode: z.boolean(),
      accountIds: z.array(z.string()),
    })
    .refine((value) => !value.bindingMode || value.accountIds.length > 0, {
      path: ["accountIds"],
      message: t("models.selectAccountRequired"),
    });
}

export type ModelForm = ReturnType<typeof createModelSchema>["_output"];
