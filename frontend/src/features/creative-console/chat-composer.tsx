import { ArrowUp, Globe, Sparkle, Square } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ReasoningEffort } from "@/features/creative-console/creative-console-api";
import { composerClassName } from "@/features/creative-console/creative-panel-contract";
import { CompactIconSelect, CompactModelSelect, XSocialIcon } from "@/features/creative-console/creative-widgets";
import type { CreativeChatController } from "@/features/creative-console/use-creative-chat";

export function ChatComposer({ controller }: { controller: CreativeChatController }): ReactNode {
  const { t } = useTranslation();
  return (
    <form
      className="w-full shrink-0 px-3 pb-2 sm:px-6 sm:pb-3"
      onSubmit={controller.submit}
      data-testid="chat-composer"
    >
      <div className={composerClassName}>
        <Textarea
          id="chat-prompt"
          value={controller.prompt}
          onChange={(event) => controller.setPrompt(event.target.value)}
          onKeyDown={controller.handlePromptKeyDown}
          placeholder={t("creativeConsole.chatPlaceholder")}
          className="min-h-24 resize-none border-0 bg-transparent px-4 py-3 text-sm focus-visible:ring-0"
          data-testid="chat-prompt"
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <ChatComposerControls controller={controller} />
          <ChatSubmitButton controller={controller} />
        </div>
      </div>
      {controller.streamError ? (
        <div className="mt-1 px-2 text-[11px] text-destructive">{controller.streamError}</div>
      ) : null}
    </form>
  );
}

function ChatSubmitButton({ controller }: { controller: CreativeChatController }): ReactNode {
  const { t } = useTranslation();
  if (controller.isStreaming) {
    return (
      <Button
        type="button"
        size="icon"
        variant="secondary"
        aria-label={t("creativeConsole.stopGenerating")}
        onClick={controller.stopGenerating}
        data-testid="chat-stop"
      >
        <Square className="size-3.5 fill-current" />
      </Button>
    );
  }
  return (
    <Button
      type="submit"
      size="icon"
      aria-label={t("creativeConsole.send")}
      disabled={!controller.canSubmit}
      data-testid="chat-send"
    >
      <ArrowUp />
    </Button>
  );
}

function SearchToggle({
  value,
  onChange,
  ariaLabel,
  icon,
  offLabel,
  onLabel,
  testId,
}: {
  value: boolean;
  onChange: (value: boolean) => void;
  ariaLabel: string;
  icon: ReactNode;
  offLabel: string;
  onLabel: string;
  testId: string;
}): ReactNode {
  return (
    <CompactIconSelect
      value={value ? "on" : "off"}
      options={[
        { value: "off", label: offLabel },
        { value: "on", label: onLabel },
      ]}
      onChange={(next) => onChange(next === "on")}
      ariaLabel={ariaLabel}
      icon={icon}
      active={value}
      testId={testId}
    />
  );
}

function ChatComposerControls({ controller }: { controller: CreativeChatController }): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-0.5 overflow-x-auto" data-testid="chat-composer-controls">
      <CompactModelSelect
        value={controller.model}
        models={controller.modelOptions}
        onChange={controller.onModelChange}
        testId="chat-model-select"
      />
      <SearchToggle
        value={controller.webSearch}
        onChange={controller.setWebSearch}
        ariaLabel={t("creativeConsole.webSearch")}
        icon={<Globe />}
        offLabel={t("creativeConsole.webSearchOff")}
        onLabel={t("creativeConsole.webSearchOn")}
        testId="chat-web-search-toggle"
      />
      <SearchToggle
        value={controller.xSearch}
        onChange={controller.setXSearch}
        ariaLabel={t("creativeConsole.xSearch")}
        icon={<XSocialIcon />}
        offLabel={t("creativeConsole.xSearchOff")}
        onLabel={t("creativeConsole.xSearchOn")}
        testId="chat-x-search-toggle"
      />
      <CompactIconSelect
        value={controller.reasoningEffort}
        options={controller.reasoningEffortOptions.map((effort) => ({
          value: effort,
          label: t(`creativeConsole.reasoning.${effort}`),
        }))}
        onChange={(value) => controller.setReasoningEffort(value as ReasoningEffort)}
        ariaLabel={t("creativeConsole.reasoningEffort")}
        icon={<Sparkle />}
        active={controller.reasoningEffort !== "auto" && controller.reasoningEffort !== "none"}
        disabled={controller.fixedReasoningModel}
        testId="chat-reasoning-effort-select"
      />
    </div>
  );
}
