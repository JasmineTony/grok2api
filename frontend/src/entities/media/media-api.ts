import type { MediaInputDTO } from "@/entities/media/types";
import { apiRequest } from "@/shared/api/client";
import { createValidatedDecoder, hasShape, isNumber, isString } from "@/shared/api/decoder";

// 媒体临时输入契约：creative-console 提交视频任务前把 http(s)/本地文件落到有 TTL 的临时输入区。
// 图库查询/删除等媒体 feature 专属操作仍归 features/media。

const decodeMediaInput = createValidatedDecoder<MediaInputDTO>(
  "media input",
  hasShape({
    fileId: isString,
    kind: isString,
    mimeType: isString,
    sizeBytes: isNumber,
    expiresAt: isString,
  }),
);

export function importVideoInputFromURL(url: string): Promise<MediaInputDTO> {
  return apiRequest("/api/admin/v1/media/inputs/import", { method: "POST", body: { url } }, decodeMediaInput);
}

// 以 multipart/form-data 上传本地图片或视频到有 TTL 的临时输入区。
// 注意：不要手动设置 Content-Type，浏览器会自动带上 multipart 边界。
export function uploadMediaInput(file: File): Promise<MediaInputDTO> {
  const body = new FormData();
  body.append("file", file, file.name);
  return apiRequest("/api/admin/v1/media/inputs/upload", { method: "POST", body }, decodeMediaInput);
}
