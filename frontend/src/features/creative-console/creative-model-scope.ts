import type { ModelRouteDTO } from "@/entities/model/types";
import type { CreativeMode, VoiceSubMode } from "@/features/creative-console/creative-panel-contract";

/**
 * 按面板用途归组可用模型路由：
 * - video 保留全部路由目标，编辑/续写资格取决于聚合目标里是否存在 Console/grok-imagine-video，
 *   与运营选择的公开名无关。
 * - voice 保留能力维度（tts/stt/realtime），由 TTS/STT 子模式再过滤。
 */
export function groupCreativeModels(models: ModelRouteDTO[]): Record<CreativeMode, ModelRouteDTO[]> {
  return {
    chat: uniqueModelsByPublicID(
      models.filter((model) => model.capability === "chat" || model.capability === "responses"),
    ),
    image: uniqueModelsByPublicID(models.filter((model) => model.capability === "image")),
    video: models.filter((model) => model.capability === "video"),
    voice: models.filter(
      (model) => model.capability === "tts" || model.capability === "stt" || model.capability === "realtime",
    ),
  };
}

export function resolveEffectiveModels(
  groups: Record<CreativeMode, ModelRouteDTO[]>,
  selected: Record<CreativeMode, string>,
  voiceChoices: ModelRouteDTO[],
): Record<CreativeMode, string> {
  return {
    chat: pickAvailableModel(groups.chat, selected.chat),
    image: pickAvailableModel(groups.image, selected.image),
    video: pickAvailableModel(groups.video, selected.video),
    voice: pickAvailableModel(voiceChoices, selected.voice),
  };
}

export function filterVoiceModels(models: ModelRouteDTO[], subMode: VoiceSubMode): ModelRouteDTO[] {
  const matched = models.filter((item) =>
    subMode === "tts" ? item.capability === "tts" || item.capability === "realtime" : item.capability === "stt",
  );
  return uniqueModelsByPublicID(matched);
}

/** 已选公开名仍可用时保持不变，否则回退到该用途的首个可用模型。 */
export function pickAvailableModel(models: ModelRouteDTO[], current: string): string {
  return models.some((model) => model.publicId === current) ? current : (models[0]?.publicId ?? "");
}

/** 视频编辑/续写只对聚合目标包含 Console 视频实现的路由开放。 */
export function selectVideoEditModels(models: ModelRouteDTO[]): ModelRouteDTO[] {
  const eligiblePublicIDs = new Set(
    models
      .filter(
        (item) =>
          item.capability === "video" &&
          item.provider === "grok_console" &&
          item.upstreamModel === "grok-imagine-video",
      )
      .map((item) => item.publicId),
  );
  return uniqueModelsByPublicID(models.filter((item) => item.capability === "video")).filter((item) =>
    eligiblePublicIDs.has(item.publicId),
  );
}
/** 同一公开名只保留一条路由目标（面板按公开名展示，聚合目标由后端决定）。 */
export function uniqueModelsByPublicID(models: ModelRouteDTO[]): ModelRouteDTO[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (seen.has(model.publicId)) return false;
    seen.add(model.publicId);
    return true;
  });
}
