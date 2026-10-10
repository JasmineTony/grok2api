import { ArrowUp, AudioLines, Clock3, ExternalLink, Loader2, Mic, Upload, X } from "lucide-react";
import { useRef, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { STTResult, TTSResult, VoiceInfo } from "@/features/creative-console/creative-console-api";
import {
  composerClassName,
  voiceLanguages,
  voiceSpeeds,
  type CreativePanelProps,
} from "@/features/creative-console/creative-panel-contract";
import {
  CompactModelSelect,
  CompactSelect,
  LoadingResult,
  WelcomeState,
} from "@/features/creative-console/creative-widgets";
import type { CreativeVoiceController } from "@/features/creative-console/use-creative-voice";
import { useCreativeVoice } from "@/features/creative-console/use-creative-voice";

const defaultVoices: VoiceInfo[] = [{ voiceId: "eve", name: "eve" }];

export function VoicePanel({ apiKey, model, modelOptions, onModelChange }: CreativePanelProps): ReactNode {
  const { t } = useTranslation();
  const controller = useCreativeVoice({ apiKey, model, modelOptions, onModelChange });
  const idle = !controller.ttsResult && !controller.sttResult && !controller.busy;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="voice-panel">
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-4">
        {idle ? <WelcomeState title={t("creativeConsole.welcomeVoice")} testId="voice-welcome-state" /> : null}
        {controller.busy ? (
          <LoadingResult
            text={controller.subMode === "tts" ? t("creativeConsole.synthesizing") : t("creativeConsole.transcribing")}
            testId="voice-loading-state"
          />
        ) : null}
        {controller.ttsResult ? <TTSPreview result={controller.ttsResult} /> : null}
        {controller.sttResult ? <STTTranscript result={controller.sttResult} /> : null}
        {controller.ttsError ? (
          <div className="px-2 text-[11px] text-destructive" data-testid="voice-tts-error">
            {controller.ttsError}
          </div>
        ) : null}
        {controller.sttError ? (
          <div className="px-2 text-[11px] text-destructive" data-testid="voice-stt-error">
            {controller.sttError}
          </div>
        ) : null}
      </div>
      <VoiceComposer controller={controller} apiKey={apiKey} onModelChange={onModelChange} />
    </div>
  );
}

function TTSPreview({ result }: { result: TTSResult }): ReactNode {
  const { t } = useTranslation();
  return (
    <div
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 rounded-2xl bg-secondary/40 p-4"
      data-testid="voice-tts-preview"
    >
      <audio controls src={result.url} className="w-full" data-testid="voice-tts-audio" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {result.contentType}
          {typeof result.duration === "number" ? ` · ${result.duration.toFixed(2)}s` : ""}
        </span>
        <Button variant="secondary" size="sm" asChild>
          <a href={result.url} download="speech.mp3" data-testid="voice-tts-download">
            <ExternalLink />
            {t("creativeConsole.open")}
          </a>
        </Button>
      </div>
    </div>
  );
}

function STTTranscript({ result }: { result: STTResult }): ReactNode {
  return (
    <div
      className="mx-auto w-full max-w-3xl space-y-3 rounded-2xl bg-secondary/40 p-4"
      data-testid="voice-stt-transcript"
    >
      <p className="whitespace-pre-wrap text-sm leading-6">{result.text}</p>
      <div className="text-xs text-muted-foreground">
        {[result.language, typeof result.duration === "number" ? `${result.duration.toFixed(2)}s` : ""]
          .filter(Boolean)
          .join(" · ")}
      </div>
    </div>
  );
}

function VoiceComposer({
  controller,
  apiKey,
  onModelChange,
}: {
  controller: CreativeVoiceController;
  apiKey: string;
  onModelChange: (model: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  return (
    <form onSubmit={controller.submit} className={composerClassName} data-testid="voice-composer">
      <div className="flex items-center gap-2 px-3 pt-3" data-testid="voice-submode-switch">
        <VoiceSubModeButton
          active={controller.subMode === "tts"}
          label={t("creativeConsole.synthesize")}
          icon={<AudioLines />}
          onSelect={() => controller.setSubMode("tts")}
          testId="voice-submode-tts"
        />
        <VoiceSubModeButton
          active={controller.subMode === "stt"}
          label={t("creativeConsole.transcribe")}
          icon={<Mic />}
          onSelect={() => controller.setSubMode("stt")}
          testId="voice-submode-stt"
        />
      </div>
      {controller.subMode === "tts" ? (
        <Textarea
          id="voice-prompt"
          value={controller.prompt}
          onChange={(event) => controller.setPrompt(event.target.value)}
          placeholder={t("creativeConsole.voicePlaceholder")}
          className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
          data-testid="voice-prompt"
        />
      ) : (
        <VoiceAudioPicker controller={controller} fileInputRef={fileInputRef} />
      )}
      <div className="flex items-center justify-between gap-2 px-3 pb-3">
        <VoiceComposerControls controller={controller} onModelChange={onModelChange} />
        <VoiceSubmitButton controller={controller} apiKey={apiKey} />
      </div>
    </form>
  );
}

function VoiceSubModeButton({
  active,
  label,
  icon,
  onSelect,
  testId,
}: {
  active: boolean;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  testId: string;
}): ReactNode {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="h-8 gap-1.5"
      onClick={onSelect}
      data-testid={testId}
    >
      {icon}
      {label}
    </Button>
  );
}

function VoiceAudioPicker({
  controller,
  fileInputRef,
}: {
  controller: CreativeVoiceController;
  fileInputRef: RefObject<HTMLInputElement | null>;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-4 py-3" data-testid="voice-audio-picker">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac"
        className="hidden"
        data-testid="voice-audio-input"
        onChange={(event) => controller.setAudioFile(event.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => fileInputRef.current?.click()}
        data-testid="voice-audio-upload"
      >
        <Upload />
        {controller.audioFile ? controller.audioFile.name : t("creativeConsole.uploadAudio")}
      </Button>
      {controller.audioFile ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("creativeConsole.clearAudio")}
          onClick={() => controller.setAudioFile(null)}
          data-testid="voice-audio-clear"
        >
          <X />
        </Button>
      ) : null}
    </div>
  );
}

function VoiceSelect({ controller }: { controller: CreativeVoiceController }): ReactNode {
  const { t } = useTranslation();
  const options = controller.voices.length > 0 ? controller.voices : defaultVoices;
  return (
    <Select
      value={controller.activeVoiceId}
      onValueChange={controller.setVoiceId}
      disabled={controller.voices.length === 0 && controller.voicesPending}
    >
      <SelectTrigger
        className="h-8 w-auto max-w-40 gap-1 border-0 bg-transparent px-2 shadow-none hover:bg-secondary/70 focus:ring-0"
        aria-label={t("creativeConsole.voiceId")}
        data-testid="voice-id-select"
      >
        <SelectValue placeholder={t("creativeConsole.voiceId")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((voice) => (
          <SelectItem key={voice.voiceId} value={voice.voiceId}>
            {voice.name || voice.voiceId}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function VoiceComposerControls({
  controller,
  onModelChange,
}: {
  controller: CreativeVoiceController;
  onModelChange: (model: string) => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1" data-testid="voice-composer-controls">
      <CompactModelSelect
        value={controller.activeModel}
        models={controller.filteredModels}
        onChange={onModelChange}
        testId="voice-model-select"
      />
      <CompactSelect
        value={controller.language}
        options={voiceLanguages}
        onChange={controller.setLanguage}
        ariaLabel={t("creativeConsole.voiceLanguage")}
        testId="voice-language-select"
      />
      {controller.subMode === "tts" ? (
        <CompactSelect
          value={controller.speed}
          options={voiceSpeeds}
          onChange={controller.setSpeed}
          ariaLabel={t("creativeConsole.voiceSpeed")}
          suffix="x"
          icon={<Clock3 />}
          testId="voice-speed-select"
        />
      ) : null}
      {controller.subMode === "tts" ? <VoiceSelect controller={controller} /> : null}
    </div>
  );
}

function VoiceSubmitButton({ controller, apiKey }: { controller: CreativeVoiceController; apiKey: string }): ReactNode {
  const { t } = useTranslation();
  const label = controller.subMode === "tts" ? t("creativeConsole.synthesize") : t("creativeConsole.transcribe");
  const disabled =
    !apiKey ||
    !controller.activeModel ||
    controller.busy ||
    (controller.subMode === "tts" ? !controller.prompt.trim() : !controller.audioFile);
  return (
    <Button
      type="submit"
      size="icon"
      aria-label={label}
      disabled={disabled}
      data-testid={controller.subMode === "tts" ? "voice-synthesize" : "voice-transcribe"}
    >
      {controller.busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
    </Button>
  );
}
