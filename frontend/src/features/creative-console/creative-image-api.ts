import {
  CreativeApiError,
  publicApiRequest,
  resolveMediaURL,
  isRecord,
  type ImageResult,
} from "@/features/creative-console/creative-api-core";

export async function generateImage(input: {
  apiKey: string;
  model: string;
  prompt: string;
  count: number;
  aspectRatio: string;
  resolution: string;
  quality?: "low" | "medium";
  signal?: AbortSignal;
}): Promise<ImageResult[]> {
  const payload = await publicApiRequest(input.apiKey, "/images/generations", {
    method: "POST",
    body: {
      model: input.model,
      prompt: input.prompt,
      n: input.count,
      aspect_ratio: input.aspectRatio,
      resolution: input.resolution,
      ...(input.quality ? { quality: input.quality } : {}),
      response_format: "url",
      stream: false,
    },
    signal: input.signal,
  });
  const images = readImages(payload);
  if (images.length === 0)
    throw new CreativeApiError(200, "The image response did not contain any images", "invalid_response");
  return images.map((image) => ({ ...image, url: resolveMediaURL(image.url) }));
}

export function readImages(payload: unknown): ImageResult[] {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item) => {
    if (!isRecord(item)) return [];
    const url =
      typeof item.url === "string" && item.url.trim()
        ? item.url
        : typeof item.b64_json === "string" && item.b64_json.trim()
          ? `data:image/png;base64,${item.b64_json}`
          : "";
    return url
      ? [{ url, revisedPrompt: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined }]
      : [];
  });
}
