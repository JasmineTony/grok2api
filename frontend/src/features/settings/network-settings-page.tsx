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
    <Tabs defaultValue="build" className="network-settings-layout grid min-w-0 gap-6">
      <div className="network-settings-tabs sticky top-6 min-w-0 overflow-x-auto">
        <TabsList className="flex h-auto w-full shrink-0 justify-start gap-1 overflow-x-auto bg-transparent p-0 lg:flex-col">
          <NetworkTab value="build" label={t("models.providerGrokBuild")} />
          <NetworkTab value="web" label={t("settings.web.title")} />
          <NetworkTab value="console" label={t("console.name")} />
          <NetworkTab value="egress" label={t("settings.egress.title")} />
        </TabsList>
      </div>
      <div className="w-full min-w-0 overflow-hidden">
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

function NetworkTab({ value, label }: { value: string; label: string }) {
  return (
    <TabsTrigger
      className="h-9 shrink-0 justify-start rounded-lg px-3 text-xs data-[state=active]:font-medium lg:w-full"
      value={value}
    >
      {label}
    </TabsTrigger>
  );
}
