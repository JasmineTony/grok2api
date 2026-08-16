import { describe, expect, it } from "vitest";

import {
  createEgressNode,
  type EgressNodeDTO,
  getSettings,
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
  health: 1,
  failureCount: 0,
});

function settingsSnapshotFixture(videoMaxAttempts?: number): unknown {
  return {
    config: {
      server: { maxConcurrentRequests: 1024 },
      providerBuild: {
        baseURL: "https://build.example.com/v1",
        fallbackBaseURL: "https://api.x.ai/v1",
        clientVersion: "1.0.4",
        clientIdentifier: "grok-shell",
        tokenAuth: "xai-grok-cli",
        tokenAuthConfigured: true,
        userAgent: "grok-shell/1.0.4",
        responseHeaderTimeout: "2m",
        streamIdleTimeout: "90s",
      },
      providerWeb: {
        baseURL: "https://grok.com",
        quotaTimeout: "25s",
        chatTimeout: "2m",
        streamIdleTimeout: "90s",
        imageTimeout: "3m",
        videoTimeout: "15m",
        statsigMode: "manual",
        statsigManualConfigured: true,
        statsigSignerURL: "https://signer.example.com",
        clearanceMode: "manual",
        flareSolverrURL: "https://solver.example.com",
        clearanceTimeout: "1m",
        clearanceRefresh: "10m",
        mediaConcurrency: 4,
        allowNSFW: false,
        recoveryBackoffBase: "30s",
        recoveryBackoffMax: "30m",
      },
      providerConsole: {
        baseURL: "https://console.x.ai",
        chatTimeout: "5m",
        streamIdleTimeout: "2m",
      },
      batch: {
        importConcurrency: 25,
        conversionConcurrency: 25,
        syncConcurrency: 25,
        refreshConcurrency: 25,
        randomDelay: "500ms",
      },
      media: {
        maxImageBytes: 32 * 2 ** 20,
        maxTotalBytes: 2 ** 30,
        cleanupThresholdPercent: 80,
        cleanupInterval: "10m",
      },
      frontend: { publicApiBaseURL: "http://127.0.0.1:8000" },
      routing: {
        stickyTTL: "1h",
        cooldownBase: "30s",
        cooldownMax: "30m",
        capacityWait: "500ms",
        maxAttempts: 3,
        ...(videoMaxAttempts === undefined ? {} : { videoMaxAttempts }),
        preferFreeBuild: false,
      },
      audit: { bufferSize: 16384, batchSize: 256, flushInterval: "250ms", commitDelayMS: 5 },
      clientKeyDefaults: { rpmLimit: 60, maxConcurrent: 4 },
    },
    recommendedProviderBuild: { clientVersion: "1.0.4", userAgent: "grok-shell/1.0.4" },
    updatedAt: "2026-08-14T00:00:00Z",
    revision: "revision-1",
    restartRequired: [],
  };
}

function decodingClient(response: unknown): ApiClient {
  return {
    request: <T>(_path: string, _options: unknown, decoder: ApiDecoder<T>) =>
      Promise.resolve().then(() => decoder(response)),
  } as ApiClient;
}

describe("settings API decoders", () => {
  it.each([
    [undefined, 999],
    [0, 999],
    [-1, -1],
    [5, 5],
  ] as const)(
    "normalizes legacy video attempts %s without dropping routing defaults",
    async (videoMaxAttempts, expected) => {
      const snapshot = await getSettings(decodingClient(settingsSnapshotFixture(videoMaxAttempts)));

      expect(snapshot.config.routing.videoMaxAttempts).toBe(expected);
      expect(snapshot.config.routing.markBuildChatDeniedAsReauth).toBe(false);
      expect(snapshot.config.routing.accountIsolatedConnections).toBe(false);
      expect(snapshot.config.routing.segmentedSelector).toEqual({
        enabled: true,
        minCandidates: 3000,
        windowSize: 64,
      });
    },
  );

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
