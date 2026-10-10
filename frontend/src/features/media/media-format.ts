import type { MediaAssetDTO, MediaJobDTO } from "@/features/media/types";

/** 管理端图库与 API 同源，使用相对路径避免依赖未配置或仅对外可用的公共地址。 */
export function imageAssetURL(id: string): string {
  return `/v1/media/images/${encodeURIComponent(id)}`;
}

export function videoAssetURL(assetID: string): string {
  return `/v1/media/videos/${encodeURIComponent(assetID)}`;
}

/** 只有终态任务允许被选中或预览。 */
export function isTerminalVideoJob(job: MediaJobDTO): boolean {
  return job.status === "completed" || job.status === "failed";
}

export function formatSpec(job: MediaJobDTO): string {
  return [job.size, job.quality].filter(Boolean).join(" · ") || "-";
}

export function formatMediaType(image: MediaAssetDTO): string {
  const subtype = image.mimeType.split("/")[1]?.split(";")[0]?.trim();
  return subtype || image.kind || "-";
}

export function formatBytes(value: number, locale: string): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: unitIndex === 0 || size >= 10 ? 0 : 1 }).format(size)} ${units[unitIndex]}`;
}
