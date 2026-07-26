import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ByteSizeInput,
  DurationInput,
  SettingsField,
  SettingsSection,
} from "@/features/settings/settings-layout";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

export function MediaSettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();
  return (
    <div className="space-y-8">
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
              <div className="flex h-8 w-24 shrink-0 items-center rounded-r-md bg-secondary/55 px-3 text-xs">
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

      <SettingsSection title={t("settings.media.executionTitle")}>
        <div className="space-y-0">
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
    </div>
  );
}
