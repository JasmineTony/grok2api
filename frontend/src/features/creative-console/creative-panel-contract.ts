import type { ModelRouteDTO } from "@/entities/model/types";

export type CreativeMode = "chat" | "image" | "video" | "voice";

/** 四个创作面板共享的密钥与模型契约。 */
export type CreativePanelProps = {
  apiKey: string;
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
};

/** 四个面板 composer 的共享外观。 */
export const composerClassName =
  "overflow-hidden rounded-2xl bg-secondary/45 ring-1 ring-transparent transition-colors focus-within:bg-secondary/60 focus-within:ring-ring";

export const imageAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export const videoAspectRatios = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"] as const;
export const imageResolutions = ["1k", "2k"] as const;
export const videoResolutions = ["480p", "720p", "1080p"] as const;
export const imageCounts = ["1", "2", "3", "4"] as const;
export const videoDurations = ["6", "10", "15"] as const;
export const videoExtendDurations = ["2", "4", "6", "8", "10"] as const;
export const imageQualities = ["low", "medium"] as const;
export const voiceLanguages = ["auto", "zh", "en", "ja", "ko", "fr", "de", "es"] as const;
export const voiceSpeeds = ["0.7", "0.8", "0.9", "1.0", "1.1", "1.2", "1.3", "1.4", "1.5"] as const;

export type VideoAction = "generate" | "edit" | "extend";
export type VoiceSubMode = "tts" | "stt";
export type ImageQuality = (typeof imageQualities)[number];
