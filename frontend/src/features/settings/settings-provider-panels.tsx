import type { TFunction } from "i18next";
import { Sparkles } from "lucide-react";
import { Controller, type UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EgressNodes } from "@/features/settings/egress-nodes";
import type { SettingsSnapshotDTO } from "@/features/settings/settings-api";
import {
  ByteSizeInput,
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
} from "@/features/settings/settings-layout";
import type { SettingsForm } from "@/features/settings/settings-model";

type SettingsProviderPanelsProps = {
  t: TFunction;
  form: UseFormReturn<SettingsForm>;
  recommendedBuild: SettingsSnapshotDTO["recommendedProviderBuild"] | undefined;
  recommendedBuildApplied: boolean;
  loading: boolean;
  updatePending: boolean;
  syncRecommendedBuild: () => void;
  statsigMode: SettingsForm["providerWeb"]["statsigMode"];
  statsigManualConfigured: boolean;
};

export function SettingsProviderPanels({
  t,
  form,
  recommendedBuild,
  recommendedBuildApplied,
  loading,
  updatePending,
  syncRecommendedBuild,
  statsigMode,
  statsigManualConfigured,
}: SettingsProviderPanelsProps) {
  return (
    <>
      <SettingsPane value="build">
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
              <Input
                id="provider-client-version"
                {...form.register("providerBuild.clientVersion")}
              />
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
          </div>
        </SettingsSection>
      </SettingsPane>

      <SettingsPane value="web">
        <SettingsSection title={t("settings.web.title")}>
          <div className="space-y-0">
            <SettingsField
              controlId="web-base-url"
              className="sm:col-span-2"
              label={t("settings.web.baseURL")}
              description={t("settings.web.baseURLHelp")}
              error={form.formState.errors.providerWeb?.baseURL?.message}
            >
              <Input id="web-base-url" {...form.register("providerWeb.baseURL")} />
            </SettingsField>
            <SettingsField
              controlId="web-statsig-mode"
              className="sm:col-span-2"
              label={t("settings.web.statsigMode")}
              description={t("settings.web.statsigModeHelp")}
              error={form.formState.errors.providerWeb?.statsigMode?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.statsigMode"
                render={({ field }) => (
                  <Tabs value={field.value} onValueChange={field.onChange}>
                    <TabsList id="web-statsig-mode" className="grid w-full grid-cols-2 bg-muted/55">
                      <TabsTrigger value="manual" className="font-normal">
                        {t("settings.web.statsigManual")}
                      </TabsTrigger>
                      <TabsTrigger value="url" className="font-normal">
                        {t("settings.web.statsigURL")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
              />
            </SettingsField>
            {statsigMode === "manual" ? (
              <SettingsField
                controlId="web-statsig-manual"
                className="sm:col-span-2"
                label={t("settings.web.statsigValue")}
                description={t("settings.web.statsigValueHelp")}
                badge={statsigManualConfigured ? t("settings.web.statsigConfigured") : undefined}
                error={form.formState.errors.providerWeb?.statsigManualValue?.message}
              >
                <Input
                  id="web-statsig-manual"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    statsigManualConfigured
                      ? t("settings.web.statsigKeepConfigured")
                      : t("settings.web.statsigValuePlaceholder")
                  }
                  {...form.register("providerWeb.statsigManualValue")}
                />
              </SettingsField>
            ) : (
              <SettingsField
                controlId="web-statsig-url"
                className="sm:col-span-2"
                label={t("settings.web.statsigSignerURL")}
                description={t("settings.web.statsigSignerURLHelp")}
                error={form.formState.errors.providerWeb?.statsigSignerURL?.message}
              >
                <Input
                  id="web-statsig-url"
                  type="url"
                  placeholder="http://grok-signer-go:8788/sign"
                  {...form.register("providerWeb.statsigSignerURL")}
                />
              </SettingsField>
            )}
            <SettingsField
              controlId="web-clearance-mode"
              className="sm:col-span-2"
              label={t("settings.web.clearanceMode")}
              description={t("settings.web.clearanceModeHelp")}
              error={form.formState.errors.providerWeb?.clearanceMode?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.clearanceMode"
                render={({ field }) => (
                  <Tabs value={field.value} onValueChange={field.onChange}>
                    <TabsList
                      id="web-clearance-mode"
                      className="grid w-full grid-cols-2 bg-muted/55"
                    >
                      <TabsTrigger value="manual" className="font-normal">
                        {t("settings.web.clearanceManual")}
                      </TabsTrigger>
                      <TabsTrigger value="flaresolverr" className="font-normal">
                        {t("settings.web.clearanceFlareSolverr")}
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                )}
              />
            </SettingsField>
            {form.watch("providerWeb.clearanceMode") === "flaresolverr" ? (
              <>
                <SettingsField
                  controlId="web-flaresolverr-url"
                  className="sm:col-span-2"
                  label={t("settings.web.flareSolverrURL")}
                  description={t("settings.web.flareSolverrURLHelp")}
                  error={form.formState.errors.providerWeb?.flareSolverrURL?.message}
                >
                  <Input
                    id="web-flaresolverr-url"
                    type="url"
                    {...form.register("providerWeb.flareSolverrURL")}
                  />
                </SettingsField>
                <SettingsField
                  controlId="web-clearance-timeout"
                  label={t("settings.web.clearanceTimeout")}
                  description={t("settings.web.clearanceTimeoutHelp")}
                  error={form.formState.errors.providerWeb?.clearanceTimeout?.message}
                >
                  <Controller
                    control={form.control}
                    name="providerWeb.clearanceTimeout"
                    render={({ field }) => (
                      <DurationInput
                        id="web-clearance-timeout"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </SettingsField>
                <SettingsField
                  controlId="web-clearance-refresh"
                  label={t("settings.web.clearanceRefresh")}
                  description={t("settings.web.clearanceRefreshHelp")}
                  error={form.formState.errors.providerWeb?.clearanceRefresh?.message}
                >
                  <Controller
                    control={form.control}
                    name="providerWeb.clearanceRefresh"
                    render={({ field }) => (
                      <DurationInput
                        id="web-clearance-refresh"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </SettingsField>
              </>
            ) : null}
            <SettingsField
              controlId="web-quota-timeout"
              label={t("settings.web.quotaTimeout")}
              description={t("settings.web.quotaTimeoutHelp")}
              error={form.formState.errors.providerWeb?.quotaTimeout?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.quotaTimeout"
                render={({ field }) => (
                  <DurationInput
                    id="web-quota-timeout"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="web-chat-timeout"
              label={t("settings.web.chatTimeout")}
              description={t("settings.web.chatTimeoutHelp")}
              error={form.formState.errors.providerWeb?.chatTimeout?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.chatTimeout"
                render={({ field }) => (
                  <DurationInput
                    id="web-chat-timeout"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="web-image-timeout"
              label={t("settings.web.imageTimeout")}
              description={t("settings.web.imageTimeoutHelp")}
              error={form.formState.errors.providerWeb?.imageTimeout?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.imageTimeout"
                render={({ field }) => (
                  <DurationInput
                    id="web-image-timeout"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="web-video-timeout"
              label={t("settings.web.videoTimeout")}
              description={t("settings.web.videoTimeoutHelp")}
              error={form.formState.errors.providerWeb?.videoTimeout?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.videoTimeout"
                render={({ field }) => (
                  <DurationInput
                    id="web-video-timeout"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="web-media-concurrency"
              label={t("settings.web.mediaConcurrency")}
              description={t("settings.web.mediaConcurrencyHelp")}
              badge={t("settings.restartRequired")}
              error={form.formState.errors.providerWeb?.mediaConcurrency?.message}
            >
              <Input
                id="web-media-concurrency"
                type="number"
                min={1}
                max={64}
                {...form.register("providerWeb.mediaConcurrency", { valueAsNumber: true })}
              />
            </SettingsField>
            <SettingsField
              controlId="web-recovery-base"
              label={t("settings.web.recoveryBackoffBase")}
              description={t("settings.web.recoveryBackoffBaseHelp")}
              error={form.formState.errors.providerWeb?.recoveryBackoffBase?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.recoveryBackoffBase"
                render={({ field }) => (
                  <DurationInput
                    id="web-recovery-base"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="web-recovery-max"
              label={t("settings.web.recoveryBackoffMax")}
              description={t("settings.web.recoveryBackoffMaxHelp")}
              error={form.formState.errors.providerWeb?.recoveryBackoffMax?.message}
            >
              <Controller
                control={form.control}
                name="providerWeb.recoveryBackoffMax"
                render={({ field }) => (
                  <DurationInput
                    id="web-recovery-max"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="web-nsfw"
              label={t("settings.web.allowNSFW")}
              description={t("settings.web.allowNSFWHelp")}
            >
              <Controller
                control={form.control}
                name="providerWeb.allowNSFW"
                render={({ field }) => (
                  <div className="flex h-8 items-center">
                    <Switch id="web-nsfw" checked={field.value} onCheckedChange={field.onChange} />
                  </div>
                )}
              />
            </SettingsField>
          </div>
        </SettingsSection>
      </SettingsPane>

      <SettingsPane value="console">
        <SettingsSection title={t("console.name")}>
          <div className="space-y-0">
            <SettingsField
              controlId="console-base-url"
              className="sm:col-span-2"
              label={t("console.baseURL")}
              description={t("settings.console.baseURLHelp")}
              error={form.formState.errors.providerConsole?.baseURL?.message}
            >
              <Input
                id="console-base-url"
                type="url"
                {...form.register("providerConsole.baseURL")}
              />
            </SettingsField>
            <SettingsField
              controlId="console-chat-timeout"
              label={t("console.chatTimeout")}
              description={t("settings.console.chatTimeoutHelp")}
              error={form.formState.errors.providerConsole?.chatTimeout?.message}
            >
              <Controller
                control={form.control}
                name="providerConsole.chatTimeout"
                render={({ field }) => (
                  <DurationInput
                    id="console-chat-timeout"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
          </div>
        </SettingsSection>
      </SettingsPane>

      <SettingsPane value="delivery">
        <SettingsSection title={t("settings.media.title")}>
          <div className="space-y-0">
            <SettingsField
              controlId="media-max-image-size"
              label={t("settings.media.maxImageSize")}
              description={t("settings.media.maxImageSizeHelp")}
              error={form.formState.errors.media?.maxImageSize?.message}
            >
              <Controller
                control={form.control}
                name="media.maxImageSize"
                render={({ field }) => (
                  <ByteSizeInput
                    id="media-max-image-size"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="media-max-total-size"
              label={t("settings.media.maxTotalSize")}
              description={t("settings.media.maxTotalSizeHelp")}
              error={form.formState.errors.media?.maxTotalSize?.message}
            >
              <Controller
                control={form.control}
                name="media.maxTotalSize"
                render={({ field }) => (
                  <ByteSizeInput
                    id="media-max-total-size"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="media-cleanup-threshold"
              label={t("settings.media.cleanupThresholdPercent")}
              description={t("settings.media.cleanupThresholdPercentHelp")}
              error={form.formState.errors.media?.cleanupThresholdPercent?.message}
            >
              <div className="flex min-w-0">
                <Input
                  id="media-cleanup-threshold"
                  type="number"
                  min={50}
                  max={95}
                  className="min-w-0 rounded-r-none"
                  {...form.register("media.cleanupThresholdPercent", { valueAsNumber: true })}
                />
                <div className="flex h-8 w-24 shrink-0 items-center justify-start rounded-r-md bg-secondary/55 px-3 text-xs text-foreground">
                  %
                </div>
              </div>
            </SettingsField>
            <SettingsField
              controlId="media-cleanup-interval"
              label={t("settings.media.cleanupInterval")}
              description={t("settings.media.cleanupIntervalHelp")}
              error={form.formState.errors.media?.cleanupInterval?.message}
            >
              <Controller
                control={form.control}
                name="media.cleanupInterval"
                render={({ field }) => (
                  <DurationInput
                    id="media-cleanup-interval"
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </SettingsField>
            <SettingsField
              controlId="frontend-public-api-base-url"
              label={t("settings.media.publicApiBaseURL")}
              description={t("settings.media.publicApiBaseURLHelp")}
              error={form.formState.errors.frontend?.publicApiBaseURL?.message}
              className="sm:col-span-2"
            >
              <Input
                id="frontend-public-api-base-url"
                placeholder="https://api.example.com"
                {...form.register("frontend.publicApiBaseURL")}
              />
            </SettingsField>
          </div>
        </SettingsSection>

        <SettingsSection title={t("settings.egress.title")}>
          <EgressNodes clearanceMode={form.watch("providerWeb.clearanceMode")} />
        </SettingsSection>
      </SettingsPane>
    </>
  );
}
