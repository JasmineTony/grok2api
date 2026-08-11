import type { ApiClient } from "@/shared/api/client";
import { createValidatedDecoder, hasShape, isNumber, isString } from "@/shared/api/decoder";

export type MediaInputDTO = {
  fileId: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
};

const decodeMediaInput = createValidatedDecoder<MediaInputDTO>(
  "media input",
  hasShape({
    fileId: isString,
    mimeType: isString,
    sizeBytes: isNumber,
    expiresAt: isString,
  }),
);

export function importVideoInputFromURL(client: ApiClient, url: string): Promise<MediaInputDTO> {
  return client.request(
    "/api/admin/v1/media/inputs/import",
    { method: "POST", body: { url } },
    decodeMediaInput,
  );
}

// Do not set Content-Type manually; the browser supplies the multipart boundary.
export function uploadVideoInput(client: ApiClient, file: File): Promise<MediaInputDTO> {
  const body = new FormData();
  body.append("file", file, file.name);
  return client.request(
    "/api/admin/v1/media/inputs/upload",
    { method: "POST", body },
    decodeMediaInput,
  );
}
