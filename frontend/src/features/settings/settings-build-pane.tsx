import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Controller } from "react-hook-form";

import {
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
  type SettingsFormApi,
} from "@/features/settings/settings-form-layout";

export function SettingsBuildPane({
  form,
  disabled,
  recommended,
}: {
  form: SettingsFormApi;
  disabled: boolean;
  recommended?: { clientVersion: string; userAgent: string };
}) {
  const { t } = useTranslation();
  const clientVersion = form.watch("providerBuild.clientVersion");
  const userAgent = form.watch("providerBuild.userAgent");
  const applied =
    recommended != null && clientVersion === recommended.clientVersion && userAgent === recommended.userAgent;
  return (
    <SettingsPane value="build">
      <SettingsSection
        testId="settings-section-provider-build"
        title={t("models.providerGrokBuild")}
        action={
          recommended && !applied ? (
            <SyncRecommendedBuildAction form={form} recommended={recommended} disabled={disabled} />
          ) : undefined
        }
      >
        <div className="space-y-0">
          <ProviderBaseURLField form={form} />
          <ProviderFallbackBaseURLField form={form} />
          <ProviderClientVersionField form={form} recommended={recommended} />
          <ProviderClientIdentifierField form={form} />
          <ProviderTokenAuthField form={form} />
          <ProviderUserAgentField form={form} />
          <ProviderResponseHeaderTimeoutField form={form} />
          <ProviderStreamIdleTimeoutField form={form} />
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}

function SyncRecommendedBuildAction({
  form,
  recommended,
  disabled,
}: {
  form: SettingsFormApi;
  recommended: { clientVersion: string; userAgent: string };
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const syncRecommendedBuild = () => {
    form.setValue("providerBuild.clientVersion", recommended.clientVersion, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
    form.setValue("providerBuild.userAgent", recommended.userAgent, {
      shouldDirty: true,
      shouldTouch: true,
      shouldValidate: true,
    });
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          data-testid="settings-sync-recommended-build"
          onClick={syncRecommendedBuild}
        >
          <Sparkles />
          {t("settings.provider.syncRecommendedVersion")}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{t("settings.provider.syncRecommendedVersionDescription")}</TooltipContent>
    </Tooltip>
  );
}

function ProviderBaseURLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-base-url"
      className="sm:col-span-2"
      label={t("settings.provider.baseURL")}
      description={t("settings.provider.baseURLHelp")}
      error={form.formState.errors.providerBuild?.baseURL?.message}
    >
      <Input id="provider-base-url" {...form.register("providerBuild.baseURL")} />
    </SettingsField>
  );
}

function ProviderFallbackBaseURLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-fallback-base-url"
      className="sm:col-span-2"
      label={t("settings.provider.fallbackBaseURL")}
      description={t("settings.provider.fallbackBaseURLHelp")}
      error={form.formState.errors.providerBuild?.fallbackBaseURL?.message}
    >
      <Input id="provider-fallback-base-url" {...form.register("providerBuild.fallbackBaseURL")} />
    </SettingsField>
  );
}

function ProviderClientVersionField({
  form,
  recommended,
}: {
  form: SettingsFormApi;
  recommended?: { clientVersion: string; userAgent: string };
}) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-client-version"
      label={t("settings.provider.clientVersion")}
      description={t("settings.provider.clientVersionHelp")}
      badge={
        recommended ? t("settings.provider.recommendedVersion", { version: recommended.clientVersion }) : undefined
      }
      error={form.formState.errors.providerBuild?.clientVersion?.message}
    >
      <Input id="provider-client-version" {...form.register("providerBuild.clientVersion")} />
    </SettingsField>
  );
}

function ProviderClientIdentifierField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-client-identifier"
      label={t("settings.provider.clientIdentifier")}
      description={t("settings.provider.clientIdentifierHelp")}
      error={form.formState.errors.providerBuild?.clientIdentifier?.message}
    >
      <Input id="provider-client-identifier" {...form.register("providerBuild.clientIdentifier")} />
    </SettingsField>
  );
}

function ProviderTokenAuthField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-token-auth"
      label={t("settings.provider.tokenAuth")}
      description={t("settings.provider.tokenAuthHelp")}
      error={form.formState.errors.providerBuild?.tokenAuth?.message}
    >
      <Input id="provider-token-auth" autoComplete="off" {...form.register("providerBuild.tokenAuth")} />
    </SettingsField>
  );
}

function ProviderUserAgentField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-user-agent"
      label={t("settings.provider.userAgent")}
      description={t("settings.provider.userAgentHelp")}
      error={form.formState.errors.providerBuild?.userAgent?.message}
    >
      <Input id="provider-user-agent" {...form.register("providerBuild.userAgent")} />
    </SettingsField>
  );
}

function ProviderResponseHeaderTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-response-header-timeout"
      label={t("settingsBuildTransport.responseHeaderTimeout")}
      description={t("settingsBuildTransport.responseHeaderTimeoutHelp")}
      error={form.formState.errors.providerBuild?.responseHeaderTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerBuild.responseHeaderTimeout"
        render={({ field }) => (
          <DurationInput id="provider-response-header-timeout" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function ProviderStreamIdleTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="provider-stream-idle-timeout"
      label={t("settingsBuildTransport.streamIdleTimeout")}
      description={t("settingsBuildTransport.streamIdleTimeoutHelp")}
      error={form.formState.errors.providerBuild?.streamIdleTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerBuild.streamIdleTimeout"
        render={({ field }) => (
          <DurationInput id="provider-stream-idle-timeout" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}
