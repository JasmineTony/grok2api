import { type TFunction } from "i18next";
import { useState } from "react";
import { Controller, type UseFormReturn } from "react-hook-form";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import {
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
} from "@/features/settings/settings-layout";
import type { SettingsForm } from "@/features/settings/settings-model";

type Confirmation = "enabled" | "includeDisabled" | null;

export function SettingsAccountMaintenancePanel({
  t,
  form,
}: {
  t: TFunction;
  form: UseFormReturn<SettingsForm>;
}) {
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const enabled = form.watch("accounts.autoCleanReauthEnabled") === true;

  function confirm(): void {
    if (confirmation === "includeDisabled") {
      form.setValue("accounts.autoCleanIncludeDisabled", true, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    } else if (confirmation === "enabled") {
      form.setValue("accounts.autoCleanReauthEnabled", true, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
    setConfirmation(null);
  }

  return (
    <SettingsPane value="accounts">
      <SettingsSection title={t("settings.accounts.title")}>
        <div className="space-y-0">
          <SettingsField
            controlId="accounts-auto-clean-enabled"
            label={t("settings.accounts.autoCleanReauthEnabled")}
            description={t("settings.accounts.autoCleanReauthEnabledHelp")}
          >
            <Controller
              control={form.control}
              name="accounts.autoCleanReauthEnabled"
              render={({ field }) => (
                <div className="flex h-9 items-center">
                  <Switch
                    id="accounts-auto-clean-enabled"
                    checked={Boolean(field.value)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setConfirmation("enabled");
                        return;
                      }
                      field.onChange(false);
                      form.setValue("accounts.autoCleanIncludeDisabled", false, {
                        shouldDirty: true,
                        shouldTouch: true,
                      });
                    }}
                  />
                </div>
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="accounts-auto-clean-interval"
            label={t("settings.accounts.autoCleanReauthInterval")}
            description={t("settings.accounts.autoCleanReauthIntervalHelp")}
            error={form.formState.errors.accounts?.autoCleanReauthInterval?.message}
          >
            <Controller
              control={form.control}
              name="accounts.autoCleanReauthInterval"
              render={({ field }) => (
                <DurationInput
                  id="accounts-auto-clean-interval"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!enabled}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="accounts-auto-clean-min-age"
            label={t("settings.accounts.autoCleanReauthMinAge")}
            description={t("settings.accounts.autoCleanReauthMinAgeHelp")}
            error={form.formState.errors.accounts?.autoCleanReauthMinAge?.message}
          >
            <Controller
              control={form.control}
              name="accounts.autoCleanReauthMinAge"
              render={({ field }) => (
                <DurationInput
                  id="accounts-auto-clean-min-age"
                  value={field.value}
                  onChange={field.onChange}
                  disabled={!enabled}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="accounts-auto-clean-include-disabled"
            label={t("settings.accounts.autoCleanIncludeDisabled")}
            description={t("settings.accounts.autoCleanIncludeDisabledHelp")}
          >
            <Controller
              control={form.control}
              name="accounts.autoCleanIncludeDisabled"
              render={({ field }) => (
                <div className="flex h-9 items-center">
                  <Switch
                    id="accounts-auto-clean-include-disabled"
                    checked={Boolean(field.value)}
                    disabled={!enabled}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setConfirmation("includeDisabled");
                        return;
                      }
                      field.onChange(false);
                    }}
                  />
                </div>
              )}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(
                confirmation === "includeDisabled"
                  ? "settings.accounts.autoCleanIncludeDisabledTitle"
                  : "settings.accounts.autoCleanEnableTitle",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                confirmation === "includeDisabled"
                  ? "settings.accounts.autoCleanIncludeDisabledDescription"
                  : "settings.accounts.autoCleanEnableDescription",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirm}
            >
              {t("settings.accounts.autoCleanConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPane>
  );
}
