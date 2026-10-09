import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const settingsTabs = [
  { value: "build", labelKey: "models.providerGrokBuild" },
  { value: "web", labelKey: "settings.web.title" },
  { value: "console", labelKey: "console.name" },
  { value: "delivery", labelKey: "settings.groups.delivery" },
  { value: "policies", labelKey: "settings.groups.policies" },
  { value: "audit", labelKey: "settings.audit.tabTitle" },
  { value: "accounts", labelKey: "settings.accounts.title" },
  { value: "about", labelKey: "updates.title" },
];

export function SettingsTabsList() {
  return (
    <TabsList className="flex h-auto w-full max-w-full shrink-0 justify-start gap-1 overflow-x-auto overscroll-x-contain rounded-none bg-transparent p-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&>span]:rounded-md [&>span]:bg-muted/70 [&>span]:shadow-none lg:sticky lg:top-[148px] lg:w-56 lg:flex-col lg:items-stretch lg:overflow-visible">
      {settingsTabs.map((tab) => (
        <SettingsTabTrigger key={tab.value} value={tab.value} labelKey={tab.labelKey} />
      ))}
    </TabsList>
  );
}

function SettingsTabTrigger({ value, labelKey }: { value: string; labelKey: string }) {
  const { t } = useTranslation();
  return (
    <TabsTrigger
      className="h-9 w-auto shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium lg:w-full"
      value={value}
      data-testid={`settings-tab-${value}`}
    >
      {t(labelKey)}
    </TabsTrigger>
  );
}

export function SettingsPageHeader({
  disabled,
  pending,
  onReset,
}: {
  disabled: boolean;
  pending: boolean;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="relative sticky top-12 z-30 -mx-2 flex min-h-12 items-center justify-between gap-3 bg-background px-2 py-2 lg:top-20 lg:z-40 lg:before:pointer-events-none lg:before:absolute lg:before:inset-x-0 lg:before:-top-[100vh] lg:before:h-[100vh] lg:before:bg-background lg:before:content-['']">
      <div className="min-w-0">
        <h1 className="text-xl font-medium">{t("settings.title")}</h1>
        <p className="sr-only">{t("settings.description")}</p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8"
              aria-label={t("common.reset")}
              data-testid="settings-reset"
              disabled={disabled}
              onClick={onReset}
            >
              <RotateCcw />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("common.reset")}</TooltipContent>
        </Tooltip>
        <Button type="submit" size="sm" data-testid="settings-save" disabled={disabled}>
          {pending ? <Spinner /> : null}
          {t("common.save")}
        </Button>
      </div>
    </header>
  );
}
