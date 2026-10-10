/**
 * 创作台对外的唯一 API 入口（展示层只从这里导入，测试可整体替换网络边界）。
 * 拆分后按协议分区：
 *  - creative-api-core：共享 DTO、请求/错误映射、媒体地址解析、分页装载。
 *  - creative-responses-protocol：/v1/responses 的 SSE 分帧与事件解码。
 *  - creative-chat-api / creative-image-api / creative-video-api / creative-voice-api：各协议调用。
 * 请求与响应的形状、错误码与错误文案与拆分前保持一致。
 */
export type {
  ChatMessage,
  ChatResponseResult,
  ChatStreamSnapshot,
  ChatToolActivity,
  ImageResult,
  ReasoningEffort,
  STTResult,
  TTSResult,
  VideoStatus,
  VoiceInfo,
} from "@/features/creative-console/creative-api-core";
export { createChatResponse, streamResponses } from "@/features/creative-console/creative-chat-api";
export { generateImage } from "@/features/creative-console/creative-image-api";
export { createVideo, editVideo, extendVideo, getVideo } from "@/features/creative-console/creative-video-api";
export { listVoices, synthesizeSpeech, transcribeSpeech } from "@/features/creative-console/creative-voice-api";
