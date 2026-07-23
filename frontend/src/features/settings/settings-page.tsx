import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsAccountMaintenancePanel } from "@/features/settings/settings-account-maintenance-panel";
import { SettingsPane } from "@/features/settings/settings-layout";
import { SettingsPoliciesPanel } from "@/features/settings/settings-policies-panel";
import { SettingsProviderPanels } from "@/features/settings/settings-provider-panels";
import { useSettings } from "@/features/settings/use-settings";
import { VersionUpdateSection } from "@/features/system";
import { ErrorState } from "@/shared/components/data-state";

export function SettingsPage() {
  const { t } = useTranslation();
  const { form, settingsQuery, updateMutation, reset } = useSettings();

  if (settingsQuery.isError) {
    return (
      <ErrorState
        message={settingsQuery.error.message}
        onRetry={() => void settingsQuery.refetch()}
      />
    );
  }

  const snapshot = settingsQuery.data;
  const loading = settingsQuery.isPending;
  const statsigMode = form.watch("providerWeb.statsigMode");
  const statsigManualConfigured = form.watch("providerWeb.statsigManualConfigured");
  const buildClientVersion = form.watch("providerBuild.clientVersion");
  const buildUserAgent = form.watch("providerBuild.userAgent");
  const recommendedBuild = snapshot?.recommendedProviderBuild;
  const recommendedBuildApplied =
    recommendedBuild != null &&
    buildClientVersion === recommendedBuild.clientVersion &&
    buildUserAgent === recommendedBuild.userAgent;
  const syncRecommendedBuild = () => {
    if (!recommendedBuild) return;
    form.setValue("providerBuild.clientVersion", recommendedBuild.clientVersion, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue("providerBuild.userAgent", recommendedBuild.userAgent, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };

  return (
    <form
      className="w-full space-y-5"
      onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
    >
      <header className="flex min-h-8 items-center justify-between gap-3">
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
                disabled={loading || updateMutation.isPending || !form.formState.isDirty}
                onClick={reset}
              >
                <RotateCcw />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("common.reset")}</TooltipContent>
          </Tooltip>
          <Button
            type="submit"
            size="sm"
            disabled={loading || updateMutation.isPending || !form.formState.isDirty}
          >
            {updateMutation.isPending ? <Spinner /> : null}
            {t("common.save")}
          </Button>
        </div>
      </header>

      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : null}
      {snapshot ? (
        <Tabs defaultValue="build" className="flex flex-col gap-7 lg:flex-row lg:items-start">
          <TabsList className="flex h-auto w-full shrink-0 justify-start gap-1 overflow-visible rounded-none bg-transparent p-0 [&>span]:rounded-md [&>span]:bg-muted/70 [&>span]:shadow-none lg:w-56 lg:flex-col lg:items-stretch">
            <TabsTrigger
              className="h-9 w-full shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium"
              value="build"
            >
              {t("models.providerGrokBuild")}
            </TabsTrigger>
            <TabsTrigger
              className="h-9 w-full shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium"
              value="web"
            >
              {t("settings.web.title")}
            </TabsTrigger>
            <TabsTrigger
              className="h-9 w-full shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium"
              value="console"
            >
              {t("console.name")}
            </TabsTrigger>
            <TabsTrigger
              className="h-9 w-full shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium"
              value="delivery"
            >
              {t("settings.groups.delivery")}
            </TabsTrigger>
            <TabsTrigger
              className="h-9 w-full shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium"
              value="accounts"
            >
              {t("settings.accounts.title")}
            </TabsTrigger>
            <TabsTrigger
              className="h-9 w-full shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium"
              value="policies"
            >
              {t("settings.groups.policies")}
            </TabsTrigger>
            <TabsTrigger
              className="h-9 w-full shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium"
              value="about"
            >
              {t("updates.title")}
            </TabsTrigger>
          </TabsList>
          <div className="min-w-0 flex-1">
            <SettingsProviderPanels
              t={t}
              form={form}
              recommendedBuild={recommendedBuild}
              recommendedBuildApplied={recommendedBuildApplied}
              loading={loading}
              updatePending={updateMutation.isPending}
              syncRecommendedBuild={syncRecommendedBuild}
              statsigMode={statsigMode}
              statsigManualConfigured={statsigManualConfigured}
            />
            <SettingsAccountMaintenancePanel t={t} form={form} />
            <SettingsPoliciesPanel t={t} form={form} />
            <SettingsPane value="about">
              <VersionUpdateSection />
            </SettingsPane>
          </div>
        </Tabs>
      ) : null}
    </form>
  );
}
