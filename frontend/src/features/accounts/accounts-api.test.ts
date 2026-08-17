import { describe, expect, it, vi } from "vitest";

import {
  listAccounts,
  pollDeviceAuthorization,
  startDeviceAuthorization,
  updateAccount,
} from "@/features/accounts/accounts-api";
import { ApiClient } from "@/shared/api/client";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function accountFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "1",
    provider: "grok_build",
    authType: "oauth",
    name: "Build account",
    enabled: true,
    authStatus: "active",
    refreshable: true,
    cloudflareCookieConfigured: false,
    buildSuperEntitled: false,
    buildRouteMode: "auto",
    buildBotFlagged: false,
    refreshFailureCount: 0,
    priority: 100,
    maxConcurrent: 1,
    minimumRemaining: 0,
    failureCount: 0,
    createdAt: "2026-08-17T00:00:00Z",
    quota: {
      type: "unknown",
      source: "unknown",
      confidence: "",
      status: "active",
      used: 0,
      limit: 0,
      remaining: 0,
      usagePercent: 0,
      limitKnown: false,
      observed: false,
      confirmed: false,
    },
    ...overrides,
  };
}

describe("accounts API", () => {
  it("starts Build Device OAuth with the upstream method and path", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse(
          {
            sessionId: "session-1",
            userCode: "ABCD-EFGH",
            verificationUri: "https://auth.x.ai/activate",
            intervalSeconds: 5,
            expiresAt: "2026-08-17T01:00:00Z",
          },
          201,
        ),
      ),
    );
    const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);

    await expect(startDeviceAuthorization(client)).resolves.toMatchObject({
      sessionId: "session-1",
      verificationUri: "https://auth.x.ai/activate",
    });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://admin.example/api/admin/v1/accounts/device/start");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
  });

  it("normalizes upstream account responses that predate runtime state fields", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          items: [
            accountFixture(),
            accountFixture({ id: "2", enabled: false }),
            accountFixture({
              id: "3",
              quota: { ...accountFixture().quota, status: "waitingReset" },
            }),
            accountFixture({ id: "4", cooldownUntil: "2099-01-01T00:00:00Z" }),
            accountFixture({
              id: "5",
              provider: "grok_console",
              quotaWindows: [
                {
                  mode: "console",
                  remaining: 0,
                  total: 100,
                  usagePercent: 100,
                  windowSeconds: 7200,
                  source: "upstream",
                },
              ],
            }),
          ],
          page: 1,
          pageSize: 20,
          total: 5,
        }),
      ),
    );
    const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);

    const result = await listAccounts(client, { page: 1, pageSize: 20 });

    expect(result.items.map((account) => account.state)).toEqual([
      "ready",
      "disabled",
      "quota_exhausted",
      "cooldown",
      "quota_exhausted",
    ]);
  });

  it("normalizes a successful Device poll account from an older backend", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          status: "succeeded",
          account: accountFixture({ authStatus: "reauthRequired" }),
          synced: 0,
          syncFailed: 0,
        }),
      ),
    );
    const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);
    const signal = new AbortController().signal;

    const result = await pollDeviceAuthorization(client, "session-1", signal);

    expect(result.account?.state).toBe("reauth_required");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://admin.example/api/admin/v1/accounts/device/session-1/poll");
    expect(init).toEqual(expect.objectContaining({ method: "POST", signal }));
  });

  it("normalizes an updated account returned by an older backend", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(jsonResponse(accountFixture())));
    const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);

    await expect(
      updateAccount(client, "1", {
        name: "Updated account",
        enabled: true,
        priority: 90,
        maxConcurrent: 2,
        minimumRemaining: 10,
      }),
    ).resolves.toMatchObject({ id: "1", state: "ready" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://admin.example/api/admin/v1/accounts/1");
    expect(init.method).toBe("PATCH");
    if (typeof init.body !== "string") throw new Error("expected JSON request body");
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Updated account",
      maxConcurrent: 2,
    });
  });
});
