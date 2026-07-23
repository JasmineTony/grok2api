import type { MediaJobDTO } from "@/features/media/types";

export function isTerminalVideoJob(job: MediaJobDTO): boolean {
  return job.status === "completed" || job.status === "failed";
}

export function progressTone(status: MediaJobDTO["status"]): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500";
    case "failed":
      return "bg-red-500";
    case "in_progress":
      return "bg-sky-500";
    case "queued":
      return "bg-amber-500";
  }
}

export function statusTone(status: MediaJobDTO["status"]): { dot: string; text: string } {
  switch (status) {
    case "completed":
      return { dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" };
    case "failed":
      return { dot: "bg-red-500", text: "text-red-700 dark:text-red-300" };
    case "in_progress":
      return { dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" };
    case "queued":
      return { dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" };
  }
}

export function formatSpec(job: MediaJobDTO): string {
  return [job.size, job.quality].filter(Boolean).join(" · ") || "-";
}

export function videoAssetURL(assetID: string): string {
  return `/v1/media/videos/${encodeURIComponent(assetID)}`;
}
