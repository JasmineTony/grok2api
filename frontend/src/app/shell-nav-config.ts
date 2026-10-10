import {
  AudioLines,
  Box,
  Eye,
  Image,
  KeyRound,
  LayoutDashboard,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";

export type NavigationItem = { href: string; label: string; icon: LucideIcon };
export type DocumentationItem = { href: string; label: string; method: "GET" | "POST" };
export type DocumentationSection = { label: string; icon: LucideIcon; items: DocumentationItem[] };

/** 需要沉浸式布局（不显示页脚、使用紧凑上间距）的工作区路由。 */
export const MEDIA_WORKSPACE_PATHS = ["/creative-console", "/gallery", "/video-gallery"];

export const navigation: NavigationItem[] = [
  { href: "/dashboard", label: "nav.dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "nav.accounts", icon: Users },
  { href: "/client-keys", label: "nav.clientKeys", icon: KeyRound },
  { href: "/models", label: "nav.models", icon: Box },
  { href: "/gallery", label: "nav.gallery", icon: Image },
  { href: "/video-gallery", label: "nav.videoGallery", icon: Video },
  { href: "/request-audits", label: "nav.audits", icon: Eye },
  { href: "/quality-guard", label: "nav.qualityGuard", icon: ShieldCheck },
  { href: "/creative-console", label: "nav.creativeConsole", icon: Sparkles },
];

export const documentation: DocumentationSection[] = [
  {
    label: "Chat",
    icon: MessageSquareText,
    items: [
      { href: "/docs/chat/completions", label: "Chat Completions", method: "POST" },
      { href: "/docs/chat/responses", label: "Responses", method: "POST" },
      { href: "/docs/chat/messages", label: "Messages", method: "POST" },
    ],
  },
  {
    label: "Image",
    icon: Image,
    items: [
      { href: "/docs/image/generations", label: "Image Generations", method: "POST" },
      { href: "/docs/image/edits", label: "Image Edits", method: "POST" },
    ],
  },
  {
    label: "Video",
    icon: Video,
    items: [
      { href: "/docs/video/generations", label: "Video Generations", method: "POST" },
      { href: "/docs/video/edits", label: "Video Edits", method: "POST" },
      { href: "/docs/video/extensions", label: "Video Extensions", method: "POST" },
      { href: "/docs/video/get", label: "Get Video", method: "GET" },
    ],
  },
  {
    label: "Voice",
    icon: AudioLines,
    items: [
      { href: "/docs/voice/tts", label: "Text to Speech", method: "POST" },
      { href: "/docs/voice/audio-speech", label: "OpenAI Speech", method: "POST" },
      { href: "/docs/voice/audio-tasks", label: "OpenAI Audio Tasks", method: "POST" },
      { href: "/docs/voice/audio-transcriptions", label: "OpenAI Transcriptions", method: "POST" },
      { href: "/docs/voice/voices", label: "List Voices", method: "GET" },
      { href: "/docs/voice/stt", label: "Speech to Text", method: "POST" },
      { href: "/docs/voice/realtime", label: "Realtime WebSocket", method: "GET" },
    ],
  },
];
