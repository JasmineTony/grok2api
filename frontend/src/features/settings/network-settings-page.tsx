import { useTranslation } from "react-i18next";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsProviderPanels } from "@/features/settings/settings-provider-panels";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

export function NetworkSettingsPage() {
  const { t } = useTranslation();
  const { form, snapshot, loading, updatePending, syncRecommendedBuild } = useSettingsRoute();
  const recommendedBuild = snapshot.recommendedProviderBuild;
  const recommendedBuildApplied =
    recommendedBuild != null &&
    form.watch("providerBuild.clientVersion") === recommendedBuild.clientVersion &&
    form.watch("providerBuild.userAgent") === recommendedBuild.userAgent;

  return (
    <Tabs defaultValue="build" className="flex flex-col gap-6 lg:flex-row">
      <TabsList className="flex h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto bg-transparent p-0 lg:flex-col">
        <TabsTrigger
          className="h-9 shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium lg:w-full"
          value="build"
        >
          {t("models.providerGrokBuild")}
        </TabsTrigger>
        <TabsTrigger
          className="h-9 shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium lg:w-full"
          value="web"
        >
          {t("settings.web.title")}
        </TabsTrigger>
        <TabsTrigger
          className="h-9 shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium lg:w-full"
          value="console"
        >
          {t("console.name")}
        </TabsTrigger>
        <TabsTrigger
          className="h-9 shrink-0 justify-start rounded-md px-3 text-xs data-[state=active]:font-medium lg:w-full"
          value="egress"
        >
          {t("settings.egress.title")}
        </TabsTrigger>
      </TabsList>
      <div className="min-w-0 flex-1">
        <SettingsProviderPanels
          t={t}
          form={form}
          recommendedBuild={recommendedBuild}
          recommendedBuildApplied={recommendedBuildApplied}
          loading={loading}
          updatePending={updatePending}
          syncRecommendedBuild={syncRecommendedBuild}
          statsigMode={form.watch("providerWeb.statsigMode")}
          statsigManualConfigured={form.watch("providerWeb.statsigManualConfigured")}
        />
      </div>
    </Tabs>
  );
}
