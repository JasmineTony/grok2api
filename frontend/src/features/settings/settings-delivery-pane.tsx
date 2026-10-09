import { useTranslation } from "react-i18next";
import { Controller } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EgressNodes } from "@/features/settings/egress-nodes";
import type { ClearanceMode } from "@/features/settings/settings-dto";
import {
  ByteSizeInput,
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
  type SettingsFormApi,
} from "@/features/settings/settings-form-layout";

export function SettingsDeliveryPane({
  form,
  serverClearanceMode,
}: {
  form: SettingsFormApi;
  serverClearanceMode: ClearanceMode;
}) {
  const { t } = useTranslation();
  return (
    <SettingsPane value="delivery">
      <SettingsMediaSection form={form} />
      <SettingsClearanceSection form={form} />
      <EgressNodes title={t("settings.egress.title")} clearanceMode={serverClearanceMode} />
    </SettingsPane>
  );
}

function SettingsMediaSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsSection testId="settings-section-media" title={t("settings.media.title")}>
      <div className="space-y-0">
        <MediaMaxImageSizeField form={form} />
        <MediaMaxTotalSizeField form={form} />
        <MediaCleanupThresholdField form={form} />
        <MediaCleanupIntervalField form={form} />
        <FrontendPublicAPIBaseURLField form={form} />
      </div>
    </SettingsSection>
  );
}

function SettingsClearanceSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  const draftClearanceMode = form.watch("providerWeb.clearanceMode");
  return (
    <SettingsSection testId="settings-section-egress-clearance" title={t("settings.egress.clearance")}>
      <div className="space-y-0">
        <ClearanceModeField form={form} />
        {draftClearanceMode !== "manual" ? <ClearanceTunnelFields form={form} mode={draftClearanceMode} /> : null}
      </div>
    </SettingsSection>
  );
}

function ClearanceTunnelFields({ form, mode }: { form: SettingsFormApi; mode: Exclude<ClearanceMode, "manual"> }) {
  return (
    <>
      <FlareSolverrURLField form={form} />
      <ClearanceTimeoutField form={form} />
      {mode === "flaresolverr" ? <ClearanceRefreshField form={form} /> : null}
    </>
  );
}

function MediaMaxImageSizeField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
          <ByteSizeInput id="media-max-image-size" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function MediaMaxTotalSizeField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
          <ByteSizeInput id="media-max-total-size" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function MediaCleanupThresholdField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function MediaCleanupIntervalField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
          <DurationInput id="media-cleanup-interval" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function FrontendPublicAPIBaseURLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function ClearanceModeField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="egress-clearance-mode"
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
            <TabsList id="egress-clearance-mode" className="grid w-full grid-cols-3 bg-muted/55">
              <TabsTrigger value="manual" className="font-normal">
                {t("settings.web.clearanceManual")}
              </TabsTrigger>
              <TabsTrigger value="flaresolverr" className="font-normal">
                {t("settings.web.clearanceFlareSolverr")}
              </TabsTrigger>
              <TabsTrigger value="on_demand" className="font-normal">
                {t("settings.web.clearanceOnDemand")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
      />
    </SettingsField>
  );
}

function FlareSolverrURLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="egress-flaresolverr-url"
      className="sm:col-span-2"
      label={t("settings.web.flareSolverrURL")}
      description={t("settings.web.flareSolverrURLHelp")}
      error={form.formState.errors.providerWeb?.flareSolverrURL?.message}
    >
      <Input
        id="egress-flaresolverr-url"
        type="url"
        placeholder="http://flaresolverr:8191"
        {...form.register("providerWeb.flareSolverrURL")}
      />
    </SettingsField>
  );
}

function ClearanceTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="egress-clearance-timeout"
      label={t("settings.web.clearanceTimeout")}
      description={t("settings.web.clearanceTimeoutHelp")}
      error={form.formState.errors.providerWeb?.clearanceTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.clearanceTimeout"
        render={({ field }) => (
          <DurationInput id="egress-clearance-timeout" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function ClearanceRefreshField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="egress-clearance-refresh"
      label={t("settings.web.clearanceRefresh")}
      description={t("settings.web.clearanceRefreshHelp")}
      error={form.formState.errors.providerWeb?.clearanceRefresh?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.clearanceRefresh"
        render={({ field }) => (
          <DurationInput id="egress-clearance-refresh" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}
