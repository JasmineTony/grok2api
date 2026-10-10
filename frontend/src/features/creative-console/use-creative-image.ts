import { useMutation } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import type { ImageQuality } from "@/features/creative-console/creative-panel-contract";
import { generateImage, type ImageResult } from "@/features/creative-console/creative-console-api";
import { readErrorMessage } from "@/features/creative-console/creative-api-core";

export type CreativeImageController = {
  prompt: string;
  setPrompt: (value: string) => void;
  count: string;
  setCount: (value: string) => void;
  aspectRatio: string;
  setAspectRatio: (value: string) => void;
  resolution: string;
  setResolution: (value: string) => void;
  quality: ImageQuality;
  setQuality: (value: ImageQuality) => void;
  supportsQuality: boolean;
  images: ImageResult[];
  isPending: boolean;
  errorMessage: string;
  submit: (event: FormEvent) => void;
};

/** 图像生成：表单参数 + 单次生成请求，结果整体替换（不增量追加）。 */
export function useCreativeImage({ apiKey, model }: { apiKey: string; model: string }): CreativeImageController {
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1k");
  const [quality, setQuality] = useState<ImageQuality>("medium");
  const [images, setImages] = useState<ImageResult[]>([]);
  const supportsQuality = model.toLowerCase().endsWith("grok-imagine-image-2.0");

  const mutation = useMutation({
    mutationFn: (request: Parameters<typeof generateImage>[0]) => generateImage(request),
    onSuccess: setImages,
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!apiKey || !model || !prompt.trim() || mutation.isPending) return;
    mutation.reset();
    mutation.mutate({
      apiKey,
      model,
      prompt: prompt.trim(),
      count: Number(count),
      aspectRatio,
      resolution,
      quality: supportsQuality ? quality : undefined,
    });
  }

  return {
    prompt,
    setPrompt,
    count,
    setCount,
    aspectRatio,
    setAspectRatio,
    resolution,
    setResolution,
    quality,
    setQuality,
    supportsQuality,
    images,
    isPending: mutation.isPending,
    errorMessage: mutation.isError ? readErrorMessage(mutation.error) : "",
    submit,
  };
}
