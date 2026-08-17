import { describe, expect, it, vi } from "vitest";

import { importConsoleAccounts, importWebAccounts } from "@/features/accounts/account-tasks-api";
import { ApiClient } from "@/shared/api/client";

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

describe("account task API", () => {
  it.each([
    ["Grok Web", importWebAccounts, "/api/admin/v1/accounts/web/import"],
    ["Grok Console", importConsoleAccounts, "/api/admin/v1/accounts/console/import"],
  ] as const)(
    "uploads %s SSO files and accepts an older JSON terminal response",
    async (_, run, path) => {
      const fetchImpl = vi.fn(() =>
        Promise.resolve(jsonResponse({ created: 1, updated: 0, synced: 1, syncFailed: 0 })),
      );
      const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);
      const file = new File(["example-sso-token"], "accounts.txt", { type: "text/plain" });

      await expect(run(client, [file])).resolves.toEqual({
        created: 1,
        updated: 0,
        synced: 1,
        syncFailed: 0,
      });

      const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      const headers = new Headers(init.headers);
      expect(url).toBe(`https://admin.example${path}`);
      expect(init.method).toBe("POST");
      expect(headers.get("Accept")).toBe("text/event-stream");
      expect(headers.has("Content-Type")).toBe(false);
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).getAll("files")).toHaveLength(1);
    },
  );

  it("parses the current SSE terminal response without treating heartbeat comments as events", async () => {
    const body = [
      ": connected",
      "",
      "event: progress",
      'data: {"completed":1,"total":1,"phase":"importing"}',
      "",
      ": heartbeat",
      "",
      "event: complete",
      'data: {"created":1,"updated":0,"synced":1,"syncFailed":0}',
      "",
      "",
    ].join("\n");
    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(body, {
          status: 200,
          headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        }),
      ),
    );
    const client = new ApiClient("https://admin.example", "https://public.example", fetchImpl);
    const progress = vi.fn();

    await expect(
      importWebAccounts(client, [new File(["token"], "accounts.txt")], progress),
    ).resolves.toEqual({ created: 1, updated: 0, synced: 1, syncFailed: 0 });
    expect(progress).toHaveBeenCalledWith({ completed: 1, total: 1, phase: "importing" });
  });
});
