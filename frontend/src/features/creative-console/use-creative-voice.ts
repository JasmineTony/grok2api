import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import type { ModelRouteDTO } from "@/entities/model/types";
import { readErrorMessage } from "@/features/creative-console/creative-api-core";
import {
  listVoices,
  synthesizeSpeech,
  transcribeSpeech,
  type STTResult,
  type TTSResult,
  type VoiceInfo,
} from "@/features/creative-console/creative-console-api";
import type { VoiceSubMode } from "@/features/creative-console/creative-panel-contract";
import { filterVoiceModels, pickAvailableModel } from "@/features/creative-console/creative-model-scope";

export type VoiceDraftFields = {
  subMode: VoiceSubMode;
  prompt: string;
  language: string;
  voiceId: string;
  speed: string;
  audioFile: File | null;
};

export type VoiceDraftSetters = {
  setSubMode: (mode: VoiceSubMode) => void;
  setPrompt: (value: string) => void;
  setLanguage: (value: string) => void;
  setVoiceId: (value: string) => void;
  setSpeed: (value: string) => void;
  setAudioFile: (file: File | null) => void;
};

export type CreativeVoiceController = VoiceDraftFields &
  VoiceDraftSetters & {
    activeVoiceId: string;
    voices: VoiceInfo[];
    voicesPending: boolean;
    filteredModels: ModelRouteDTO[];
    activeModel: string;
    ttsResult: TTSResult | null;
    sttResult: STTResult | null;
    busy: boolean;
    ttsError: string;
    sttError: string;
    submit: (event: FormEvent) => void;
  };

type VoiceRequestState = {
  submit: () => void;
  reset: () => void;
  isPending: boolean;
  errorMessage: string;
};

type VoiceRequestBase = {
  apiKey: string;
  activeModel: string;
  language: string;
};

type CreativeVoiceInput = {
  apiKey: string;
  model: string;
  modelOptions: ModelRouteDTO[];
  onModelChange: (model: string) => void;
};

function useVoiceDraft(): { fields: VoiceDraftFields; setters: VoiceDraftSetters } {
  const [subMode, setSubMode] = useState<VoiceSubMode>("tts");
  const [prompt, setPrompt] = useState("");
  const [language, setLanguage] = useState("zh");
  const [voiceId, setVoiceId] = useState("eve");
  const [speed, setSpeed] = useState("1.0");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  return {
    fields: { subMode, prompt, language, voiceId, speed, audioFile },
    setters: { setSubMode, setPrompt, setLanguage, setVoiceId, setSpeed, setAudioFile },
  };
}

function useVoiceModels(
  input: CreativeVoiceInput,
  subMode: VoiceSubMode,
): { filteredModels: ModelRouteDTO[]; activeModel: string } {
  const { model, modelOptions, onModelChange } = input;
  const filteredModels = useMemo(() => filterVoiceModels(modelOptions, subMode), [modelOptions, subMode]);
  const activeModel = pickAvailableModel(filteredModels, model);
  useEffect(() => {
    if (activeModel !== model) onModelChange(activeModel);
  }, [activeModel, model, onModelChange]);
  return { filteredModels, activeModel };
}

function useVoiceCatalog(
  apiKey: string,
  activeModel: string,
  subMode: VoiceSubMode,
  voiceId: string,
): {
  voices: VoiceInfo[];
  voicesPending: boolean;
  activeVoiceId: string;
} {
  const voicesQuery = useQuery({
    queryKey: ["creative-console", "voices", apiKey, activeModel],
    queryFn: ({ signal }) => listVoices({ apiKey, model: activeModel || "grok-voice-latest", signal }),
    enabled: Boolean(apiKey) && subMode === "tts",
    staleTime: 60_000,
  });
  const voices = voicesQuery.data ?? [];
  const activeVoiceId = voices.some((voice) => voice.voiceId === voiceId) ? voiceId : (voices[0]?.voiceId ?? voiceId);
  return { voices, voicesPending: voicesQuery.isPending, activeVoiceId };
}

function useVoiceResults(): {
  ttsResult: TTSResult | null;
  sttResult: STTResult | null;
  acceptTts: (result: TTSResult) => void;
  acceptStt: (result: STTResult) => void;
} {
  const [ttsResult, setTtsResult] = useState<TTSResult | null>(null);
  const [sttResult, setSttResult] = useState<STTResult | null>(null);
  return {
    ttsResult,
    sttResult,
    acceptTts: (result) => {
      setTtsResult(result);
      setSttResult(null);
    },
    acceptStt: (result) => {
      setSttResult(result);
      setTtsResult(null);
    },
  };
}

function useTtsRequest(
  params: VoiceRequestBase & {
    prompt: string;
    voiceId: string;
    speed: string;
    onSuccess: (result: TTSResult) => void;
  },
): VoiceRequestState {
  const mutation = useMutation({
    mutationFn: () =>
      synthesizeSpeech({
        apiKey: params.apiKey,
        model: params.activeModel || "grok-voice-latest",
        text: params.prompt.trim(),
        voiceId: params.voiceId,
        language: params.language,
        speed: Number(params.speed),
      }),
    onSuccess: params.onSuccess,
  });
  return {
    submit: mutation.mutate,
    reset: mutation.reset,
    isPending: mutation.isPending,
    errorMessage: mutation.isError ? readErrorMessage(mutation.error) : "",
  };
}

function useSttRequest(
  params: VoiceRequestBase & { file: File | null; onSuccess: (result: STTResult) => void },
): VoiceRequestState {
  const { t } = useTranslation();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!params.file) throw new Error(t("creativeConsole.errors.noAudio"));
      return transcribeSpeech({
        apiKey: params.apiKey,
        model: params.activeModel || "grok-stt",
        file: params.file,
        language: params.language,
      });
    },
    onSuccess: params.onSuccess,
  });
  return {
    submit: mutation.mutate,
    reset: mutation.reset,
    isPending: mutation.isPending,
    errorMessage: mutation.isError ? readErrorMessage(mutation.error) : "",
  };
}

/** 提交按钮的禁用条件同等校验一次，避免重复请求与空输入。 */
function createVoiceSubmit(params: {
  apiKey: string;
  activeModel: string;
  subMode: VoiceSubMode;
  prompt: string;
  audioFile: File | null;
  tts: VoiceRequestState;
  stt: VoiceRequestState;
}): (event: FormEvent) => void {
  return (event: FormEvent): void => {
    event.preventDefault();
    if (!params.apiKey || !params.activeModel) return;
    if (params.subMode === "tts") {
      if (!params.prompt.trim() || params.tts.isPending) return;
      params.tts.reset();
      params.tts.submit();
      return;
    }
    if (!params.audioFile || params.stt.isPending) return;
    params.stt.reset();
    params.stt.submit();
  };
}

/** 语音合成/转写：子模式切换会重算可用模型与音色，两种结果互斥展示。 */
function useVoiceRequests(
  input: CreativeVoiceInput,
  fields: VoiceDraftFields,
  activeModel: string,
  activeVoiceId: string,
  results: ReturnType<typeof useVoiceResults>,
): { tts: VoiceRequestState; stt: VoiceRequestState; busy: boolean; submit: (event: FormEvent) => void } {
  const tts = useTtsRequest({
    apiKey: input.apiKey,
    activeModel,
    language: fields.language,
    prompt: fields.prompt,
    voiceId: activeVoiceId,
    speed: fields.speed,
    onSuccess: results.acceptTts,
  });
  const stt = useSttRequest({
    apiKey: input.apiKey,
    activeModel,
    language: fields.language,
    file: fields.audioFile,
    onSuccess: results.acceptStt,
  });
  return {
    tts,
    stt,
    busy: tts.isPending || stt.isPending,
    submit: createVoiceSubmit({
      apiKey: input.apiKey,
      activeModel,
      subMode: fields.subMode,
      prompt: fields.prompt,
      audioFile: fields.audioFile,
      tts,
      stt,
    }),
  };
}

/** 语音合成/转写：子模式切换会重算可用模型与音色，两种结果互斥展示。 */
export function useCreativeVoice(input: CreativeVoiceInput): CreativeVoiceController {
  const draft = useVoiceDraft();
  const models = useVoiceModels(input, draft.fields.subMode);
  const catalog = useVoiceCatalog(input.apiKey, models.activeModel, draft.fields.subMode, draft.fields.voiceId);
  const results = useVoiceResults();
  const requests = useVoiceRequests(input, draft.fields, models.activeModel, catalog.activeVoiceId, results);
  return {
    ...draft.fields,
    ...draft.setters,
    ...models,
    voices: catalog.voices,
    voicesPending: catalog.voicesPending,
    activeVoiceId: catalog.activeVoiceId,
    ttsResult: results.ttsResult,
    sttResult: results.sttResult,
    busy: requests.busy,
    ttsError: requests.tts.errorMessage,
    sttError: requests.stt.errorMessage,
    submit: requests.submit,
  };
}
