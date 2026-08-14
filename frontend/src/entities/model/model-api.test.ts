import { describe, expect, it, vi } from "vitest";

import { syncModels } from "@/entities/model/model-api";
import { ApiClient } from "@/shared/api/client";

type CapturedRequest = {
  url: string;
  method: string;
  accept: string | null;
};

function sseClient(body: string, requests: CapturedRequest[]): ApiClient {
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      method: init?.method ?? "GET",
      accept: headers.get("Accept"),
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
      }),
    );
  });
  return new ApiClient("https://admin.example", "https://public.example", fetchImpl);
}

describe("model sync API", () => {
  it("posts an event-stream request, clamps progress, and returns a full result", async () => {
    const requests: CapturedRequest[] = [];
    const progress = vi.fn();
    const client = sseClient(
      [
        'event: progress\ndata: {"completed":-2,"total":4}',
        'event: progress\ndata: {"completed":9,"total":4}',
        'event: complete\ndata: {"synced":7,"accountsSucceeded":4,"accountsFailed":0}',
        "",
      ].join("\n\n"),
      requests,
    );

    await expect(syncModels(client, progress)).resolves.toEqual({
      synced: 7,
      partial: false,
      accountsSucceeded: 4,
      accountsFailed: 0,
    });
    expect(progress.mock.calls).toEqual([
      [{ completed: 0, total: 4 }],
      [{ completed: 4, total: 4 }],
    ]);
    expect(requests).toEqual([
      {
        url: "https://admin.example/api/admin/v1/models/sync",
        method: "POST",
        accept: "text/event-stream",
      },
    ]);
  });

  it("preserves a partial-success terminal result", async () => {
    const client = sseClient(
      'event: complete\ndata: {"synced":5,"partial":true,"accountsSucceeded":3,"accountsFailed":2}\n\n',
      [],
    );

    await expect(syncModels(client)).resolves.toEqual({
      synced: 5,
      partial: true,
      accountsSucceeded: 3,
      accountsFailed: 2,
    });
  });

  it("maps a terminal error event to ApiError", async () => {
    const client = sseClient(
      'event: error\ndata: {"code":"modelSyncInProgress","message":"already running"}\n\n',
      [],
    );

    await expect(syncModels(client)).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: "modelSyncInProgress",
    });
  });

  it("rejects a stream that closes without a complete event", async () => {
    const client = sseClient('event: progress\ndata: {"completed":1,"total":2}\n\n', []);

    await expect(syncModels(client)).rejects.toMatchObject({
      name: "ApiError",
      status: 502,
      code: "invalidResponse",
    });
  });
});
