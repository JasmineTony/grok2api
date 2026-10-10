import { describe, expect, it } from "vitest";

import type { TFunction } from "i18next";

import { modelGroup, modelRoute } from "@/features/models/models-test-support";
import {
  capabilityLabel,
  displayCapabilityLabel,
  newModelRouteGroup,
  providerDotClassName,
  providerLabel,
  type ModelDisplayCapability,
} from "@/features/models/model-display";
import { i18n } from "@/shared/i18n";

// model-display 是纯展示模型与文案映射：直接以真实 modelRouteGroupDTO 驱动，
// 断言分组状态、账号区间标签与支持说明的分支结果。

// 与被测函数声明的 TFunction 契约一致（同 dashboard-*-format.test.ts 的既有做法）。
const t = ((key: string, options?: Record<string, unknown>) => i18n.t(key, options)) as unknown as TFunction;

const allCapabilities: ModelDisplayCapability[] = [
  "completions",
  "responses",
  "messages",
  "image",
  "image_edit",
  "video",
  "tts",
  "stt",
  "realtime",
];

describe("newModelRouteGroup 分组状态", () => {
  it("全部启用且全部绑定账号时状态为 enabled / bound", () => {
    const group = newModelRouteGroup(
      modelGroup({
        routes: [modelRoute({ bindingMode: true }), modelRoute({ id: "route-2", bindingMode: true })],
      }),
      t,
    );

    expect(group.enabledState).toBe("enabled");
    expect(group.bindingState).toBe("bound");
  });

  it("全部停用且未绑定账号时状态为 disabled / automatic", () => {
    const group = newModelRouteGroup(
      modelGroup({ routes: [modelRoute({ enabled: false }), modelRoute({ id: "route-2", enabled: false })] }),
      t,
    );

    expect(group.enabledState).toBe("disabled");
    expect(group.bindingState).toBe("automatic");
  });

  it("部分启用且部分绑定时状态为 mixed / mixed", () => {
    const group = newModelRouteGroup(
      modelGroup({
        routes: [modelRoute({ enabled: true, bindingMode: true }), modelRoute({ id: "route-2", enabled: false })],
      }),
      t,
    );

    expect(group.enabledState).toBe("mixed");
    expect(group.bindingState).toBe("mixed");
  });

  it("账号支持数一致时用单值标签，不一致时用区间标签", () => {
    const uniform = newModelRouteGroup(
      modelGroup({
        routes: [
          modelRoute({ supportedAccounts: 3, totalAccounts: 4 }),
          modelRoute({ id: "route-2", supportedAccounts: 3, totalAccounts: 4 }),
        ],
      }),
      t,
    );
    const ranged = newModelRouteGroup(
      modelGroup({
        routes: [
          modelRoute({ supportedAccounts: 1, totalAccounts: 2 }),
          modelRoute({ id: "route-2", supportedAccounts: 5, totalAccounts: 7 }),
        ],
      }),
      t,
    );

    expect(uniform.supportedLabel).toBe("3");
    expect(uniform.totalLabel).toBe("4");
    expect(uniform.supportedMax).toBe(3);
    expect(ranged.supportedLabel).toBe("1–5");
    expect(ranged.totalLabel).toBe("2–7");
    expect(ranged.supportedMax).toBe(5);
  });

  it("支持说明按能力逐行拼接，并取最近一次同步时间", () => {
    const group = newModelRouteGroup(
      modelGroup({
        routes: [
          modelRoute({ lastSyncedAt: "2026-01-01T00:00:00Z" }),
          modelRoute({ id: "route-2", capability: "image", lastSyncedAt: "2026-02-02T00:00:00Z" }),
        ],
      }),
      t,
    );

    expect(group.supportTitle.split("\n")).toEqual([
      `${t("models.capabilityConversation")}: ${t("models.supportSummary", { supported: 3, total: 4 })}`,
      `${displayCapabilityLabel("image", t)}: ${t("models.supportSummary", { supported: 3, total: 4 })}`,
    ]);
    expect(group.lastSyncedAt).toBe("2026-02-02T00:00:00Z");
  });

  it("没有任何同步记录时 lastSyncedAt 为 undefined", () => {
    const group = newModelRouteGroup(
      modelGroup({
        routes: [modelRoute({ lastSyncedAt: undefined }), modelRoute({ id: "route-2", lastSyncedAt: undefined })],
      }),
      t,
    );

    expect(group.lastSyncedAt).toBeUndefined();
    expect(group.capabilities).toEqual(["responses"]);
  });
});

describe("capabilityLabel / displayCapabilityLabel", () => {
  it("responses 与 chat 走会话文案，其余走各自能力文案", () => {
    expect(capabilityLabel("responses", t)).toBe(t("models.capabilityConversation"));
    expect(capabilityLabel("chat", t)).toBe(t("models.capabilityConversation"));
    expect(capabilityLabel("image", t)).toBe(t("models.capabilityImage"));
  });

  it("每个对外能力都有独立文案", () => {
    const labels = allCapabilities.map((capability) => displayCapabilityLabel(capability, t));

    expect(labels).toEqual([
      t("models.capabilityCompletions"),
      t("models.capabilityResponses"),
      t("models.capabilityMessages"),
      t("models.capabilityImage"),
      t("models.capabilityImageEdit"),
      t("models.capabilityVideo"),
      t("models.capabilityTTS"),
      t("models.capabilitySTT"),
      t("models.capabilityRealtime"),
    ]);
    expect(new Set(labels).size).toBe(allCapabilities.length);
  });
});

describe("providerLabel / providerDotClassName", () => {
  it("三个来源分别映射到各自文案与色点", () => {
    expect(providerLabel("grok_web", t)).toBe(t("models.providerGrokWeb"));
    expect(providerLabel("grok_console", t)).toBe(t("console.name"));
    expect(providerLabel("grok_build", t)).toBe(t("models.providerGrokBuild"));

    expect(providerDotClassName("grok_web")).toBe("bg-quota-product-2");
    expect(providerDotClassName("grok_console")).toBe("bg-quota-product-4");
    expect(providerDotClassName("grok_build")).toBe("bg-quota-product-1");
  });
});
