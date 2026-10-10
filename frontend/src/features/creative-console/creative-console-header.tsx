import { AudioLines, ImageIcon, MessageSquareText, Video } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CreativeMode } from "@/features/creative-console/creative-panel-contract";
import { InlineError, RetryableError } from "@/features/creative-console/creative-widgets";
import type { CreativeConsoleController } from "@/features/creative-console/use-creative-console";
import { cn } from "@/shared/lib/cn";

const creativeModeTabs: Array<{ value: CreativeMode; labelKey: string; icon: ReactNode }> = [
  { value: "chat", labelKey: "creativeConsole.modes.chat", icon: <MessageSquareText /> },
  { value: "image", labelKey: "creativeConsole.modes.image", icon: <ImageIcon /> },
  { value: "video", labelKey: "creativeConsole.modes.video", icon: <Video /> },
  { value: "voice", labelKey: "creativeConsole.modes.voice", icon: <AudioLines /> },
];

export function CreativeConsoleHeader({
  controller,
  onToolbarElement,
}: {
  controller: CreativeConsoleController;
  onToolbarElement: (element: HTMLDivElement | null) => void;
}): ReactNode {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-9 shrink-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <Tabs value={controller.mode} onValueChange={(value) => controller.setMode(value as CreativeMode)}>
        <TabsList className="h-9 w-full rounded-full bg-secondary/50 p-1 lg:w-auto">
          {creativeModeTabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              className="flex-1 gap-1.5 rounded-full px-3 lg:min-w-20 [&_svg]:size-3.5"
              value={tab.value}
              data-testid={`creative-mode-tab-${tab.value}`}
            >
              {tab.icon}
              {t(tab.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex min-w-0 items-center gap-2">
        <CreativeKeySelect controller={controller} />
        <div
          ref={onToolbarElement}
          className={cn("items-center gap-1", controller.mode === "chat" ? "flex" : "hidden")}
        />
      </div>
    </div>
  );
}

export function CreativeConsoleAlerts({ controller }: { controller: CreativeConsoleController }): ReactNode {
  const { t } = useTranslation();
  const noActiveKeys = !controller.keysPending && !controller.keysError && controller.activeKeys.length === 0;
  return (
    <div className="shrink-0 space-y-2 px-3" data-testid="creative-console-alerts">
      {controller.keysError ? (
        <RetryableError
          message={controller.keysError}
          onRetry={controller.retryKeys}
          testId="creative-console-keys-error"
          retryTestId="creative-console-keys-retry"
        />
      ) : null}
      {noActiveKeys ? (
        <InlineError message={t("creativeConsole.errors.noKeys")} testId="creative-console-no-keys" />
      ) : null}
      {controller.keyError ? <InlineError message={controller.keyError} testId="creative-console-key-error" /> : null}
      {controller.modelsError ? (
        <RetryableError
          message={controller.modelsError}
          onRetry={controller.retryModels}
          testId="creative-console-models-error"
          retryTestId="creative-console-models-retry"
        />
      ) : null}
    </div>
  );
}

function CreativeKeySelect({ controller }: { controller: CreativeConsoleController }): ReactNode {
  const { t } = useTranslation();
  return (
    <Select
      value={controller.effectiveKeyId}
      onValueChange={controller.changeKey}
      disabled={controller.keysPending || controller.activeKeys.length === 0}
    >
      <SelectTrigger
        id="creative-key"
        className="min-w-0 flex-1 bg-secondary/55 lg:w-64 lg:flex-none"
        aria-label={t("creativeConsole.clientKey")}
        data-testid="creative-key-select"
      >
        <SelectValue placeholder={controller.keysPending ? t("common.loading") : t("creativeConsole.selectKey")} />
      </SelectTrigger>
      <SelectContent>
        {controller.activeKeys.map((key) => (
          <SelectItem key={key.id} value={key.id}>
            {key.name} · {key.prefix}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
