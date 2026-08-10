import { describe, expect, it } from "vitest";

import {
  createEgressNode,
  type EgressNodeDTO,
  listEgressNodes,
} from "@/features/settings/settings-api";
import type { ApiClient } from "@/shared/api/client";
import type { ApiDecoder } from "@/shared/api/decoder";

const egressNodeFixture = (): EgressNodeDTO => ({
  id: "node-1",
  name: "Primary",
  scope: "grok_web",
  enabled: true,
  proxyConfigured: true,
  userAgent: "Mozilla/5.0",
  cookieConfigured: false,
  accountBoundProxy: false,
  proxyPool: false,
  accountCapacity: 10,
  assignedAccountCount: 2,
  probeStatus: "healthy",
  probeLatencyMs: 42,
  probeProvider: "cloudflare",
  ipv4Probe: {
    status: "healthy",
    testedAt: "2026-08-10T00:00:00Z",
    latencyMs: 42,
    exitIp: "192.0.2.1",
  },
  ipv6Probe: {
    status: "unknown",
    latencyMs: 0,
  },
  health: 100,
  failureCount: 0,
});

function decodingClient(response: unknown): ApiClient {
  return {
    request: <T>(_path: string, _options: unknown, decoder: ApiDecoder<T>) =>
      Promise.resolve().then(() => decoder(response)),
  } as ApiClient;
}

describe("settings API decoders", () => {
  it("uses the same egress node contract for list and mutation responses", async () => {
    const node = egressNodeFixture();
    const list = await listEgressNodes(
      decodingClient({
        items: [node],
        defaultUserAgents: {
          grok_build: "",
          grok_web: "Mozilla/5.0",
          grok_console: "Mozilla/5.0",
          grok_web_asset: "Mozilla/5.0",
        },
      }),
    );
    const created = await createEgressNode(decodingClient(node), {
      name: node.name,
      scope: node.scope,
      enabled: node.enabled,
      accountCapacity: node.accountCapacity,
      userAgent: node.userAgent,
    });

    expect(list.items).toEqual([node]);
    expect(created).toEqual(node);
  });

  it("rejects the same invalid egress node field in list and mutation responses", async () => {
    const invalidNode = { ...egressNodeFixture(), health: "healthy" };
    const defaults = {
      grok_build: "",
      grok_web: "Mozilla/5.0",
      grok_console: "Mozilla/5.0",
      grok_web_asset: "Mozilla/5.0",
    };

    await expect(
      listEgressNodes(decodingClient({ items: [invalidNode], defaultUserAgents: defaults })),
    ).rejects.toThrow("egress node list response shape is invalid");
    await expect(
      createEgressNode(decodingClient(invalidNode), {
        name: "Primary",
        scope: "grok_web",
        enabled: true,
        accountCapacity: 10,
        userAgent: "Mozilla/5.0",
      }),
    ).rejects.toThrow("egress node response shape is invalid");
  });
});
