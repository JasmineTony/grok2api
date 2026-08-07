import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import type { ModelRouteDTO, ModelRouteGroupDTO } from "@/entities/model/types";
import { capabilityLabel, newModelRouteGroup } from "@/features/models/model-group-utils";

const t = ((key: string, options?: Record<string, unknown>) => {
  if (key === "models.supportSummary")
    return String(options?.supported) + "/" + String(options?.total);
  return key;
}) as TFunction;

function route(overrides: Partial<ModelRouteDTO>): ModelRouteDTO {
  return {
    id: "1",
    publicId: "grok-shared",
    provider: "grok_console",
    upstreamModel: "grok-4",
    capability: "responses",
    origin: "catalog",
    enabled: true,
    accountIds: [],
    bindingMode: false,
    supportedAccounts: 2,
    syncedAccounts: 2,
    totalAccounts: 3,
    capabilityKnown: true,
    available: true,
    ...overrides,
  };
}

describe("model route grouping", () => {
  it("aggregates mixed capability routes without sorting the input array", () => {
    const routes = [
      route({
        id: "2",
        capability: "image",
        enabled: false,
        supportedAccounts: 1,
        lastSyncedAt: "2026-08-05T12:00:00Z",
      }),
      route({
        id: "1",
        capability: "responses",
        bindingMode: true,
        accountIds: ["8"],
        supportedAccounts: 3,
        totalAccounts: 4,
        lastSyncedAt: "2026-08-06T12:00:00Z",
      }),
    ];
    const value: ModelRouteGroupDTO = {
      key: "grok_console|grok-shared|grok-4",
      routes,
      endpointCapabilities: ["responses", "image"],
    };

    const group = newModelRouteGroup(value, t);

    expect(group.enabledState).toBe("mixed");
    expect(group.bindingState).toBe("mixed");
    expect(group.supportedLabel).toBe("1–3");
    expect(group.totalLabel).toBe("3–4");
    expect(group.supportedMax).toBe(3);
    expect(group.lastSyncedAt).toBe("2026-08-06T12:00:00Z");
    expect(group.routes).toBe(routes);
  });

  it("uses a shared conversation label for chat and responses routes", () => {
    expect(capabilityLabel("chat", t)).toBe("models.capabilityConversation");
    expect(capabilityLabel("responses", t)).toBe("models.capabilityConversation");
    expect(capabilityLabel("image", t)).toBe("models.capabilityImage");
  });
});
