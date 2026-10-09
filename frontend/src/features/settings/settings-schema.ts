import { z } from "zod";

import { byteSizeBytes, durationSeconds } from "@/features/settings/settings-units";
import {
  validHTTPURL,
  validPublicAPIBaseURL,
  validStatsigID,
  validStatsigSignerURL,
} from "@/features/settings/settings-url-validation";

export const MAX_ROUTING_ATTEMPTS = 65535;
export const UNLIMITED_ROUTING_ATTEMPTS = -1;

const durationSchema = z.object({ value: z.number().positive(), unit: z.enum(["s", "m", "h", "d"]) });
const positiveInteger = z.number().int().positive();
const byteSizeSchema = z.object({ value: z.number().positive(), unit: z.enum(["MiB", "GiB"]) });
const routingTTLDuration = durationSchema.refine((value) => durationSeconds(value) <= 30 * 86_400);
const routingCooldownDuration = durationSchema.refine((value) => durationSeconds(value) <= 86_400);
const routingCapacityWaitDuration = durationSchema.refine((value) => durationSeconds(value) <= 30);
const auditFlushDuration = durationSchema.refine((value) => {
  const seconds = durationSeconds(value);
  return seconds >= 0.01 && seconds <= 60;
});
const consoleChatDuration = durationSchema.refine((value) => {
  const seconds = durationSeconds(value);
  return seconds >= 5 && seconds <= 30 * 60;
});
const buildResponseHeaderDuration = durationSchema.refine((value) => {
  const seconds = durationSeconds(value);
  return seconds >= 30 && seconds <= 30 * 60;
});
const buildStreamIdleDuration = durationSchema.refine((value) => {
  const seconds = durationSeconds(value);
  return seconds >= 30 && seconds <= 10 * 60;
});
const providerStreamIdleDuration = durationSchema.refine((value) => {
  const seconds = durationSeconds(value);
  return seconds >= 30 && seconds <= 10 * 60;
});
const forbiddenCodePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function parseForbiddenCodes(value: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value.split(/[\n,]/)) {
    const code = item.trim().toLowerCase();
    if (code === "" || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}
export const settingsSchema = z.object({
  server: z.object({
    maxConcurrentRequests: positiveInteger.max(100_000),
  }),
  providerBuild: z.object({
    baseURL: z.url(),
    fallbackBaseURL: z.url().refine((value) => value.startsWith("https://")),
    clientVersion: z.string().trim().min(1),
    clientIdentifier: z.string().trim().min(1),
    tokenAuth: z.string().trim().min(1),
    tokenAuthConfigured: z.boolean(),
    userAgent: z.string().trim().min(1),
    responseHeaderTimeout: buildResponseHeaderDuration,
    streamIdleTimeout: buildStreamIdleDuration,
  }),
  providerWeb: z
    .object({
      baseURL: z.url().refine((value) => value.startsWith("https://")),
      statsigMode: z.enum(["manual", "url"]),
      statsigManualValue: z.string().trim().max(4096),
      statsigManualConfigured: z.boolean(),
      statsigSignerURL: z.string().trim().max(2048),
      clearanceMode: z.enum(["manual", "flaresolverr", "on_demand"]),
      flareSolverrURL: z.string().trim().max(2048),
      clearanceTimeout: durationSchema.refine((value) => durationSeconds(value) >= 10 && durationSeconds(value) <= 300),
      clearanceRefresh: durationSchema.refine(
        (value) => durationSeconds(value) >= 60 && durationSeconds(value) <= 86_400,
      ),
      quotaTimeout: durationSchema,
      chatTimeout: durationSchema,
      streamIdleTimeout: providerStreamIdleDuration,
      imageTimeout: durationSchema,
      videoTimeout: durationSchema,
      mediaConcurrency: positiveInteger.max(64),
      allowNSFW: z.boolean(),
      freeVideoDurationCap: z.number().int().min(1).max(15),
      recoveryBackoffBase: durationSchema,
      recoveryBackoffMax: durationSchema,
    })
    .superRefine((value, context) => {
      if (durationSeconds(value.streamIdleTimeout) > durationSeconds(value.chatTimeout)) {
        context.addIssue({ code: "custom", path: ["streamIdleTimeout"], message: "invalid" });
      }
      if (durationSeconds(value.recoveryBackoffMax) < durationSeconds(value.recoveryBackoffBase)) {
        context.addIssue({ code: "custom", path: ["recoveryBackoffMax"], message: "invalid" });
      }
      if (value.statsigMode === "manual" && !value.statsigManualConfigured && value.statsigManualValue.length === 0) {
        context.addIssue({ code: "custom", path: ["statsigManualValue"], message: "required" });
      }
      if (value.statsigManualValue.length > 0 && !validStatsigID(value.statsigManualValue)) {
        context.addIssue({ code: "custom", path: ["statsigManualValue"], message: "invalid" });
      }
      if (value.statsigMode === "url") {
        if (!validStatsigSignerURL(value.statsigSignerURL)) {
          context.addIssue({ code: "custom", path: ["statsigSignerURL"], message: "invalid" });
        }
      }
      if (value.clearanceMode !== "manual" && !validHTTPURL(value.flareSolverrURL)) {
        context.addIssue({ code: "custom", path: ["flareSolverrURL"], message: "invalid" });
      }
    }),
  providerConsole: z
    .object({
      baseURL: z.url().refine((value) => value.startsWith("https://")),
      chatTimeout: consoleChatDuration,
      streamIdleTimeout: providerStreamIdleDuration,
    })
    .refine((value) => durationSeconds(value.streamIdleTimeout) <= durationSeconds(value.chatTimeout), {
      path: ["streamIdleTimeout"],
      message: "invalid",
    }),
  batch: z.object({
    importConcurrency: positiveInteger.max(50),
    conversionConcurrency: positiveInteger.max(50),
    syncConcurrency: positiveInteger.max(50),
    refreshConcurrency: positiveInteger.max(50),
    randomDelay: z.number().int().min(0).max(5_000),
  }),
  media: z
    .object({
      maxImageSize: byteSizeSchema.refine(
        (value) => byteSizeBytes(value) >= 1 << 20 && byteSizeBytes(value) <= 32 << 20,
      ),
      maxTotalSize: byteSizeSchema.refine((value) => byteSizeBytes(value) <= 2 ** 40),
      cleanupThresholdPercent: z.number().int().min(50).max(95),
      cleanupInterval: durationSchema.refine(
        (value) => durationSeconds(value) >= 60 && durationSeconds(value) <= 86_400,
      ),
    })
    .refine((value) => byteSizeBytes(value.maxTotalSize) >= byteSizeBytes(value.maxImageSize), {
      path: ["maxTotalSize"],
    }),
  frontend: z.object({
    publicApiBaseURL: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => validPublicAPIBaseURL(value), { message: "invalid" }),
  }),
  routing: z
    .object({
      stickyTTL: routingTTLDuration,
      cooldownBase: routingCooldownDuration,
      cooldownMax: routingCooldownDuration,
      capacityWait: routingCapacityWaitDuration,
      maxAttempts: z.union([z.literal(UNLIMITED_ROUTING_ATTEMPTS), positiveInteger.max(65535)]),
      videoMaxAttempts: z.union([z.literal(UNLIMITED_ROUTING_ATTEMPTS), positiveInteger.max(65535)]),
      preferFreeBuild: z.boolean(),
      markBuildChatDeniedAsReauth: z.boolean(),
      accountIsolatedConnections: z.boolean(),
      segmentedSelector: z.object({
        enabled: z.boolean(),
        minCandidates: z.number().int().min(100).max(1_000_000),
        windowSize: z.number().int().min(8).max(256),
      }),
    })
    .refine((value) => durationSeconds(value.cooldownMax) >= durationSeconds(value.cooldownBase), {
      path: ["cooldownMax"],
    })
    .refine((value) => value.segmentedSelector.windowSize <= value.segmentedSelector.minCandidates, {
      path: ["segmentedSelector", "windowSize"],
    }),
  audit: z
    .object({
      bufferSize: positiveInteger.max(262_144),
      batchSize: positiveInteger.max(4_096),
      flushInterval: auditFlushDuration,
      commitDelayMS: positiveInteger.max(50),
      retentionDays: z.number().int().min(0).max(365),
    })
    .refine((value) => value.batchSize <= value.bufferSize, { path: ["batchSize"] }),
  clientKeyDefaults: z.object({ rpmLimit: positiveInteger.max(100_000), maxConcurrent: positiveInteger.max(1_024) }),
  accounts: z.object({
    markBuildForbiddenReauth: z.boolean(),
    buildForbiddenReauthCodes: z.string().superRefine((value, context) => {
      const codes = parseForbiddenCodes(value);
      if (codes.length === 0 || codes.length > 32 || codes.some((code) => !forbiddenCodePattern.test(code))) {
        context.addIssue({ code: "custom", message: "invalid" });
      }
    }),
    excludeBuildBotFlaggedFromScheduling: z.boolean(),
    autoCleanReauthEnabled: z.boolean(),
    autoCleanReauthInterval: durationSchema.refine((value) => {
      const seconds = durationSeconds(value);
      return seconds >= 60 && seconds <= 3_600;
    }),
    autoCleanReauthMinAge: durationSchema.refine((value) => {
      const seconds = durationSeconds(value);
      return seconds >= 60 && seconds <= 30 * 86_400;
    }),
    autoCleanIncludeDisabled: z.boolean(),
  }),
});

export type SettingsForm = z.infer<typeof settingsSchema>;
