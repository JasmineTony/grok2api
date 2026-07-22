import { z } from "zod";

export function createAccountSchema(translate: (key: string) => string) {
  return z.object({
    name: z.string().min(1, translate("errors.required")),
    enabled: z.boolean(),
    priority: z.number().int(),
    maxConcurrent: z
      .number()
      .int()
      .min(1, translate("errors.positive"))
      .max(256),
    minimumRemaining: z.number().min(0),
    cloudflareCookies: z
      .string()
      .max(16 << 10, translate("settings.invalidValue")),
    clearCloudflareCookies: z.boolean(),
    buildSuperEntitled: z.boolean(),
    buildRouteMode: z.enum(["auto", "build", "xai"]),
  });
}

export type AccountFormValues = z.infer<ReturnType<typeof createAccountSchema>>;
