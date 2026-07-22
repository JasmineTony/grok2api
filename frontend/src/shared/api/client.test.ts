import { describe, expect, it, vi } from "vitest";

import { ApiClient } from "@/shared/api/client";

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(status >= 400 ? { error: data } : { data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const decodeString = (value: unknown): string => {
  if (typeof value !== "string") throw new Error("expected string");
  return value;
};

describe("ApiClient", () => {
  it("isolates authentication state between provider-scoped clients", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
        authorization: headers.get("Authorization"),
      });
      return Promise.resolve(jsonResponse("ok"));
    });
    const first = new ApiClient("https://admin-a.example", "https://public-a.example", fetchImpl);
    const second = new ApiClient("https://admin-b.example", "https://public-b.example", fetchImpl);
    first.setAccessToken("token-a");

    await first.request("/value", {}, decodeString);
    await second.request("/value", {}, decodeString);

    expect(requests).toEqual([
      { url: "https://admin-a.example/value", authorization: "Bearer token-a" },
      { url: "https://admin-b.example/value", authorization: null },
    ]);
  });

  it("deduplicates concurrent refresh requests without module-level state", async () => {
    const fetchImpl = vi.fn(async () => {
      await Promise.resolve();
      return jsonResponse({
        accessToken: "refreshed-token",
        accessTokenExpiresAt: "2099-01-01T00:00:00Z",
        refreshTokenExpiresAt: "2099-01-01T00:00:00Z",
      });
    });
    const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);

    await expect(
      Promise.all([client.refreshAccessToken(), client.refreshAccessToken()]),
    ).resolves.toEqual(["refreshed", "refreshed"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses the injected public base URL and preserves cancellation", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    const client = new ApiClient(
      "https://admin.example",
      "https://gateway.example/root",
      fetchImpl,
    );
    const controller = new AbortController();

    await client.publicRequest("/v1/models", { signal: controller.signal });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gateway.example/root/v1/models",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("notifies subscribers when refresh credentials are rejected", async () => {
    const fetchImpl = vi.fn(() =>
      Promise.resolve(jsonResponse({ code: "unauthenticated", message: "expired" }, 401)),
    );
    const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);
    const invalidated = vi.fn();
    client.subscribeSessionInvalidated(invalidated);

    await expect(client.refreshAccessToken()).resolves.toBe("invalid");
    expect(invalidated).toHaveBeenCalledTimes(1);
  });
});
