import { describe, expect, it, vi } from "vitest";

import {
  createVideo,
  editVideo,
  extendVideo,
  listVoices,
} from "@/features/creative-console/creative-console-api";
import { ApiClient } from "@/shared/api/client";

type CapturedRequest = {
  url: string;
  method: string;
  authorization: string | null;
  body: Record<string, unknown> | null;
};

function publicClient(responses: unknown[], requests: CapturedRequest[]): ApiClient {
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const body =
      typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    requests.push({
      url: input instanceof Request ? input.url : input instanceof URL ? input.href : input,
      method: init?.method ?? "GET",
      authorization: new Headers(init?.headers).get("Authorization"),
      body,
    });
    return Promise.resolve(
      new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  return new ApiClient("https://admin.example", "https://public.example", fetchImpl);
}

describe("creative console video API", () => {
  it("preserves generation reference inputs and voice ids", async () => {
    const requests: CapturedRequest[] = [];
    const client = publicClient([{ request_id: "request-generate" }], requests);

    await expect(
      createVideo(client, {
        apiKey: "client-key",
        model: "video-public",
        prompt: "animate the reference",
        referenceImages: [{ fileId: "image-file" }],
        referenceVoiceIds: ["eve"],
        duration: 6,
        aspectRatio: "16:9",
        resolution: "720p",
      }),
    ).resolves.toBe("request-generate");

    expect(requests).toEqual([
      {
        url: "https://public.example/v1/videos/generations",
        method: "POST",
        authorization: "Bearer client-key",
        body: {
          model: "video-public",
          prompt: "animate the reference",
          duration: 6,
          aspect_ratio: "16:9",
          resolution: "720p",
          reference_images: [{ file_id: "image-file" }],
          reference_audios: [{ voice_id: "eve" }],
        },
      },
    ]);
  });

  it("uses distinct edit and extension contracts", async () => {
    const requests: CapturedRequest[] = [];
    const client = publicClient(
      [{ request_id: "request-edit" }, { request_id: "request-extend" }],
      requests,
    );

    await editVideo(client, {
      apiKey: "client-key",
      model: "video-public",
      prompt: "change the sky",
      videoURL: "https://media.example/source.mp4",
    });
    await extendVideo(client, {
      apiKey: "client-key",
      model: "video-public",
      prompt: "continue the camera move",
      videoFileID: "video-file",
      duration: 8,
    });

    expect(requests.map(({ url, body }) => ({ url, body }))).toEqual([
      {
        url: "https://public.example/v1/videos/edits",
        body: {
          model: "video-public",
          prompt: "change the sky",
          video: { url: "https://media.example/source.mp4" },
        },
      },
      {
        url: "https://public.example/v1/videos/extensions",
        body: {
          model: "video-public",
          prompt: "continue the camera move",
          video: { file_id: "video-file" },
          duration: 8,
        },
      },
    ]);
  });

  it("decodes reference voice metadata", async () => {
    const requests: CapturedRequest[] = [];
    const client = publicClient(
      [{ voices: [{ voice_id: "eve", name: "Eve", language: "en" }] }],
      requests,
    );

    await expect(
      listVoices(client, { apiKey: "client-key", model: "grok-voice-latest" }),
    ).resolves.toEqual([{ voiceId: "eve", name: "Eve", language: "en" }]);
    expect(requests[0]?.url).toBe("https://public.example/v1/tts/voices?model=grok-voice-latest");
  });
});
