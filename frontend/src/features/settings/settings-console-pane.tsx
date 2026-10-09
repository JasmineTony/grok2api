import { useTranslation } from "react-i18next";
import { Controller } from "react-hook-form";

import { Input } from "@/components/ui/input";
import {
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
  type SettingsFormApi,
} from "@/features/settings/settings-form-layout";

export function SettingsConsolePane({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsPane value="console">
      <SettingsSection testId="settings-section-console" title={t("console.name")}>
        <div className="space-y-0">
          <ConsoleBaseURLField form={form} />
          <ConsoleChatTimeoutField form={form} />
          <ConsoleStreamIdleTimeoutField form={form} />
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}

function ConsoleBaseURLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="console-base-url"
      className="sm:col-span-2"
      label={t("console.baseURL")}
      description={t("settings.console.baseURLHelp")}
      error={form.formState.errors.providerConsole?.baseURL?.message}
    >
      <Input id="console-base-url" type="url" {...form.register("providerConsole.baseURL")} />
    </SettingsField>
  );
}

function ConsoleChatTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
          <DurationInput id="console-chat-timeout" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function ConsoleStreamIdleTimeoutField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="console-stream-idle-timeout"
      label={t("settings.console.streamIdleTimeout")}
      description={t("settings.console.streamIdleTimeoutHelp")}
      error={form.formState.errors.providerConsole?.streamIdleTimeout?.message}
    >
      <Controller
        control={form.control}
        name="providerConsole.streamIdleTimeout"
        render={({ field }) => (
          <DurationInput id="console-stream-idle-timeout" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}
