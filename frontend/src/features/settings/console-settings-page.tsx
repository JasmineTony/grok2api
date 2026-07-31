import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { DurationInput, SettingsField, SettingsSection } from "@/features/settings/settings-layout";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

export function ConsoleSettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();

  return (
    <div className="space-y-8">
      <SettingsSection title={t("console.name")}>
        <div className="space-y-0">
          <SettingsField
            controlId="console-base-url"
            className="sm:col-span-2"
            label={t("console.baseURL")}
            description={t("settings.console.baseURLHelp")}
            error={form.formState.errors.providerConsole?.baseURL?.message}
          >
            <Input id="console-base-url" type="url" {...form.register("providerConsole.baseURL")} />
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
    </div>
  );
}
