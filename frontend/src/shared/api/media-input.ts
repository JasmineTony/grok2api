import type { ApiClient } from "@/shared/api/client";
import { createObjectDecoder, isNumber, isOneOf, isString } from "@/shared/api/decoder";

export type MediaInputDTO = {
  fileId: string;
  kind: "image" | "video";
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
};

const decodeMediaInput = createObjectDecoder<MediaInputDTO>("media input", {
  fileId: isString,
  kind: isOneOf("image", "video"),
  mimeType: isString,
  sizeBytes: isNumber,
  expiresAt: isString,
});

// Temporary inputs never enter the gallery and do not receive public URLs.
export function importMediaInputFromURL(client: ApiClient, url: string): Promise<MediaInputDTO> {
  return client.request(
    "/api/admin/v1/media/inputs/import",
    { method: "POST", body: { url } },
    decodeMediaInput,
  );
}

// Do not set Content-Type manually; the browser supplies the multipart boundary.
export function uploadMediaInput(client: ApiClient, file: File): Promise<MediaInputDTO> {
  const body = new FormData();
  body.append("file", file, file.name);
  return client.request(
    "/api/admin/v1/media/inputs/upload",
    { method: "POST", body },
    decodeMediaInput,
  );
}
