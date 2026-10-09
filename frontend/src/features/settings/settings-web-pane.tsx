import { useTranslation } from "react-i18next";
import { Controller } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
  type SettingsFormApi,
} from "@/features/settings/settings-form-layout";

export function SettingsWebPane({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  const statsigMode = form.watch("providerWeb.statsigMode");
  const statsigManualConfigured = form.watch("providerWeb.statsigManualConfigured");
  return (
    <SettingsPane value="web">
      <SettingsSection testId="settings-section-provider-web" title={t("settings.web.title")}>
        <div className="space-y-0">
          <WebBaseURLField form={form} />
          <StatsigModeField form={form} />
          {statsigMode === "manual" ? (
            <StatsigManualValueField form={form} configured={statsigManualConfigured} />
          ) : (
            <StatsigSignerURLField form={form} />
          )}
          <WebQuotaTimeoutField form={form} />
          <WebChatTimeoutField form={form} />
          <WebStreamIdleTimeoutField form={form} />
          <WebImageTimeoutField form={form} />
          <WebVideoTimeoutField form={form} />
          <WebFreeVideoDurationCapField form={form} />
          <WebMediaConcurrencyField form={form} />
          <WebRecoveryBackoffBaseField form={form} />
          <WebRecoveryBackoffMaxField form={form} />
          <WebAllowNSFWField form={form} />
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}

function WebBaseURLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-base-url"
      className="sm:col-span-2"
      label={t("settings.web.baseURL")}
      description={t("settings.web.baseURLHelp")}
      error={form.formState.errors.providerWeb?.baseURL?.message}
    >
      <Input id="web-base-url" {...form.register("providerWeb.baseURL")} />
    </SettingsField>
  );
}

function StatsigModeField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function StatsigManualValueField({ form, configured }: { form: SettingsFormApi; configured: boolean }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-statsig-manual"
      className="sm:col-span-2"
      label={t("settings.web.statsigValue")}
      description={t("settings.web.statsigValueHelp")}
      badge={configured ? t("settings.web.statsigConfigured") : undefined}
      error={form.formState.errors.providerWeb?.statsigManualValue?.message}
    >
      <Input
        id="web-statsig-manual"
        type="password"
        autoComplete="off"
        placeholder={configured ? t("settings.web.statsigKeepConfigured") : t("settings.web.statsigValuePlaceholder")}
        {...form.register("providerWeb.statsigManualValue")}
      />
    </SettingsField>
  );
}

function StatsigSignerURLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function WebQuotaTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-quota-timeout"
      label={t("settings.web.quotaTimeout")}
      description={t("settings.web.quotaTimeoutHelp")}
      error={form.formState.errors.providerWeb?.quotaTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.quotaTimeout"
        render={({ field }) => <DurationInput id="web-quota-timeout" value={field.value} onChange={field.onChange} />}
      />
    </SettingsField>
  );
}

function WebChatTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-chat-timeout"
      label={t("settings.web.chatTimeout")}
      description={t("settings.web.chatTimeoutHelp")}
      error={form.formState.errors.providerWeb?.chatTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.chatTimeout"
        render={({ field }) => <DurationInput id="web-chat-timeout" value={field.value} onChange={field.onChange} />}
      />
    </SettingsField>
  );
}

function WebStreamIdleTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-stream-idle-timeout"
      label={t("settings.web.streamIdleTimeout")}
      description={t("settings.web.streamIdleTimeoutHelp")}
      error={form.formState.errors.providerWeb?.streamIdleTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.streamIdleTimeout"
        render={({ field }) => (
          <DurationInput id="web-stream-idle-timeout" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function WebImageTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-image-timeout"
      label={t("settings.web.imageTimeout")}
      description={t("settings.web.imageTimeoutHelp")}
      error={form.formState.errors.providerWeb?.imageTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.imageTimeout"
        render={({ field }) => <DurationInput id="web-image-timeout" value={field.value} onChange={field.onChange} />}
      />
    </SettingsField>
  );
}

function WebVideoTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-video-timeout"
      label={t("settings.web.videoTimeout")}
      description={t("settings.web.videoTimeoutHelp")}
      error={form.formState.errors.providerWeb?.videoTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.videoTimeout"
        render={({ field }) => <DurationInput id="web-video-timeout" value={field.value} onChange={field.onChange} />}
      />
    </SettingsField>
  );
}

function WebFreeVideoDurationCapField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-free-video-duration-cap"
      label={t("settings.web.freeVideoDurationCap")}
      description={t("settings.web.freeVideoDurationCapHelp")}
      error={form.formState.errors.providerWeb?.freeVideoDurationCap?.message}
    >
      <Input
        id="web-free-video-duration-cap"
        type="number"
        min={1}
        max={15}
        {...form.register("providerWeb.freeVideoDurationCap", { valueAsNumber: true })}
      />
    </SettingsField>
  );
}

function WebMediaConcurrencyField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function WebRecoveryBackoffBaseField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-recovery-base"
      label={t("settings.web.recoveryBackoffBase")}
      description={t("settings.web.recoveryBackoffBaseHelp")}
      error={form.formState.errors.providerWeb?.recoveryBackoffBase?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.recoveryBackoffBase"
        render={({ field }) => <DurationInput id="web-recovery-base" value={field.value} onChange={field.onChange} />}
      />
    </SettingsField>
  );
}

function WebRecoveryBackoffMaxField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="web-recovery-max"
      label={t("settings.web.recoveryBackoffMax")}
      description={t("settings.web.recoveryBackoffMaxHelp")}
      error={form.formState.errors.providerWeb?.recoveryBackoffMax?.message}
    >
      <Controller
        control={form.control}
        name="providerWeb.recoveryBackoffMax"
        render={({ field }) => <DurationInput id="web-recovery-max" value={field.value} onChange={field.onChange} />}
      />
    </SettingsField>
  );
}

function WebAllowNSFWField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}
