import { Sparkles } from "lucide-react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DurationInput, SettingsField, SettingsSection } from "@/features/settings/settings-layout";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

export function BuildSettingsPage() {
  const { t } = useTranslation();
  const { form, snapshot, loading, updatePending, syncRecommendedBuild } = useSettingsRoute();
  const recommendedBuild = snapshot.recommendedProviderBuild;
  const recommendedBuildApplied =
    recommendedBuild != null &&
    form.watch("providerBuild.clientVersion") === recommendedBuild.clientVersion &&
    form.watch("providerBuild.userAgent") === recommendedBuild.userAgent;

  return (
    <div className="space-y-8">
      <SettingsSection
        title={t("models.providerGrokBuild")}
        action={
          recommendedBuild && !recommendedBuildApplied ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={loading || updatePending}
                  onClick={syncRecommendedBuild}
                >
                  <Sparkles />
                  {t("settings.provider.syncRecommendedVersion")}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t("settings.provider.syncRecommendedVersionDescription")}
              </TooltipContent>
            </Tooltip>
          ) : undefined
        }
      >
        <div className="space-y-0">
          <SettingsField
            controlId="provider-base-url"
            className="sm:col-span-2"
            label={t("settings.provider.baseURL")}
            description={t("settings.provider.baseURLHelp")}
            error={form.formState.errors.providerBuild?.baseURL?.message}
          >
            <Input id="provider-base-url" {...form.register("providerBuild.baseURL")} />
          </SettingsField>
          <SettingsField
            controlId="provider-fallback-base-url"
            className="sm:col-span-2"
            label={t("settings.provider.fallbackBaseURL")}
            description={t("settings.provider.fallbackBaseURLHelp")}
            error={form.formState.errors.providerBuild?.fallbackBaseURL?.message}
          >
            <Input
              id="provider-fallback-base-url"
              {...form.register("providerBuild.fallbackBaseURL")}
            />
          </SettingsField>
          <SettingsField
            controlId="provider-client-version"
            label={t("settings.provider.clientVersion")}
            description={t("settings.provider.clientVersionHelp")}
            badge={
              recommendedBuild
                ? t("settings.provider.recommendedVersion", {
                    version: recommendedBuild.clientVersion,
                  })
                : undefined
            }
            error={form.formState.errors.providerBuild?.clientVersion?.message}
          >
            <Input id="provider-client-version" {...form.register("providerBuild.clientVersion")} />
          </SettingsField>
          <SettingsField
            controlId="provider-client-identifier"
            label={t("settings.provider.clientIdentifier")}
            description={t("settings.provider.clientIdentifierHelp")}
            error={form.formState.errors.providerBuild?.clientIdentifier?.message}
          >
            <Input
              id="provider-client-identifier"
              {...form.register("providerBuild.clientIdentifier")}
            />
          </SettingsField>
          <SettingsField
            controlId="provider-token-auth"
            label={t("settings.provider.tokenAuth")}
            description={t("settings.provider.tokenAuthHelp")}
            error={form.formState.errors.providerBuild?.tokenAuth?.message}
          >
            <Input
              id="provider-token-auth"
              autoComplete="off"
              {...form.register("providerBuild.tokenAuth")}
            />
          </SettingsField>
          <SettingsField
            controlId="provider-user-agent"
            label={t("settings.provider.userAgent")}
            description={t("settings.provider.userAgentHelp")}
            error={form.formState.errors.providerBuild?.userAgent?.message}
          >
            <Input id="provider-user-agent" {...form.register("providerBuild.userAgent")} />
          </SettingsField>
          <SettingsField
            controlId="provider-response-header-timeout"
            label={t("settingsProviderResponseHeader.label")}
            description={t("settingsProviderResponseHeader.help")}
            error={form.formState.errors.providerBuild?.responseHeaderTimeout?.message}
          >
            <Controller
              control={form.control}
              name="providerBuild.responseHeaderTimeout"
              render={({ field }) => (
                <DurationInput
                  id="provider-response-header-timeout"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="provider-stream-idle-timeout"
            label={t("settingsProviderResponseHeader.streamIdleTimeout")}
            description={t("settingsProviderResponseHeader.streamIdleTimeoutHelp")}
            error={form.formState.errors.providerBuild?.streamIdleTimeout?.message}
          >
            <Controller
              control={form.control}
              name="providerBuild.streamIdleTimeout"
              render={({ field }) => (
                <DurationInput
                  id="provider-stream-idle-timeout"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
        </div>
      </SettingsSection>
    </div>
  );
}
