import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Controller } from "react-hook-form";

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
import { Textarea } from "@/components/ui/textarea";
import {
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
  type SettingsFormApi,
} from "@/features/settings/settings-form-layout";

type AutoCleanConfirm = "enabled" | "includeDisabled";

export function SettingsAccountsPane({ form }: { form: SettingsFormApi }) {
  return (
    <SettingsPane value="accounts">
      <SettingsInvalidationSection form={form} />
      <SettingsBotRiskSection form={form} />
      <SettingsAccountCleanupSection form={form} />
    </SettingsPane>
  );
}

function SettingsInvalidationSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  const codesEnabled = form.watch("accounts.markBuildForbiddenReauth") === true;
  return (
    <SettingsSection testId="settings-section-accounts-invalidation" title={t("settings.accounts.invalidationTitle")}>
      <div className="space-y-0">
        <MarkBuildForbiddenReauthField form={form} />
        <BuildForbiddenReauthCodesField form={form} disabled={!codesEnabled} />
      </div>
    </SettingsSection>
  );
}

function SettingsBotRiskSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsSection testId="settings-section-accounts-bot-risk" title={t("settings.accounts.botRiskSchedulingTitle")}>
      <div className="space-y-0">
        <ExcludeBuildBotFlaggedField form={form} />
      </div>
    </SettingsSection>
  );
}

function SettingsAccountCleanupSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState<AutoCleanConfirm | null>(null);
  const enabled = form.watch("accounts.autoCleanReauthEnabled") === true;
  return (
    <SettingsSection testId="settings-section-accounts-cleanup" title={t("settings.accounts.cleanupTitle")}>
      <div className="space-y-0">
        <AutoCleanReauthEnabledField form={form} onRequestConfirm={setConfirm} />
        <AutoCleanReauthIntervalField form={form} disabled={!enabled} />
        <AutoCleanReauthMinAgeField form={form} disabled={!enabled} />
        <AutoCleanIncludeDisabledField form={form} disabled={!enabled} onRequestConfirm={setConfirm} />
      </div>
      <AutoCleanConfirmDialog
        confirm={confirm}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm === "includeDisabled") {
            form.setValue("accounts.autoCleanIncludeDisabled", true, {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            });
          } else {
            form.setValue("accounts.autoCleanReauthEnabled", true, {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            });
          }
          setConfirm(null);
        }}
      />
    </SettingsSection>
  );
}

function AutoCleanConfirmDialog({
  confirm,
  onOpenChange,
  onConfirm,
}: {
  confirm: AutoCleanConfirm | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const includeDisabled = confirm === "includeDisabled";
  return (
    <AlertDialog open={confirm !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {includeDisabled
              ? t("settings.accounts.autoCleanIncludeDisabledTitle")
              : t("settings.accounts.autoCleanEnableTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {includeDisabled
              ? t("settings.accounts.autoCleanIncludeDisabledDescription")
              : t("settings.accounts.autoCleanEnableDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="settings-auto-clean-confirm"
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {t("settings.accounts.autoCleanConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MarkBuildForbiddenReauthField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="accounts-mark-build-forbidden-reauth"
      label={t("settingsBuildForbidden.markInvalid")}
      description={t("settingsBuildForbidden.markInvalidHelp")}
    >
      <Controller
        control={form.control}
        name="accounts.markBuildForbiddenReauth"
        render={({ field }) => (
          <div className="flex h-9 items-center">
            <Switch
              id="accounts-mark-build-forbidden-reauth"
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          </div>
        )}
      />
    </SettingsField>
  );
}

function BuildForbiddenReauthCodesField({ form, disabled }: { form: SettingsFormApi; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="accounts-build-forbidden-reauth-codes"
      className="sm:col-span-2"
      label={t("settingsBuildForbidden.codes")}
      description={t("settingsBuildForbidden.codesHelp")}
      error={
        form.formState.errors.accounts?.buildForbiddenReauthCodes ? t("settingsBuildForbidden.codesInvalid") : undefined
      }
    >
      <Textarea
        id="accounts-build-forbidden-reauth-codes"
        className="min-h-24 font-mono"
        disabled={disabled}
        placeholder={t("settingsBuildForbidden.codesPlaceholder")}
        {...form.register("accounts.buildForbiddenReauthCodes")}
      />
    </SettingsField>
  );
}

function ExcludeBuildBotFlaggedField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="accounts-exclude-build-bot-flagged"
      label={t("settings.accounts.excludeBuildBotFlaggedFromScheduling")}
      description={t("settings.accounts.excludeBuildBotFlaggedFromSchedulingHelp")}
    >
      <Controller
        control={form.control}
        name="accounts.excludeBuildBotFlaggedFromScheduling"
        render={({ field }) => (
          <div className="flex h-9 items-center">
            <Switch
              id="accounts-exclude-build-bot-flagged"
              checked={Boolean(field.value)}
              onCheckedChange={field.onChange}
            />
          </div>
        )}
      />
    </SettingsField>
  );
}

function AutoCleanReauthEnabledField({
  form,
  onRequestConfirm,
}: {
  form: SettingsFormApi;
  onRequestConfirm: (confirm: AutoCleanConfirm) => void;
}) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="accounts-auto-clean-reauth-enabled"
      label={t("settings.accounts.autoCleanReauthEnabled")}
      description={t("settings.accounts.autoCleanReauthEnabledHelp")}
    >
      <Controller
        control={form.control}
        name="accounts.autoCleanReauthEnabled"
        render={({ field }) => (
          <div className="flex h-9 items-center">
            <Switch
              id="accounts-auto-clean-reauth-enabled"
              checked={Boolean(field.value)}
              onCheckedChange={(checked) => {
                if (checked) {
                  onRequestConfirm("enabled");
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
  );
}

function AutoCleanReauthIntervalField({ form, disabled }: { form: SettingsFormApi; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="accounts-auto-clean-reauth-interval"
      label={t("settings.accounts.autoCleanReauthInterval")}
      description={t("settings.accounts.autoCleanReauthIntervalHelp")}
      error={form.formState.errors.accounts?.autoCleanReauthInterval?.message}
    >
      <Controller
        control={form.control}
        name="accounts.autoCleanReauthInterval"
        render={({ field }) => (
          <DurationInput
            id="accounts-auto-clean-reauth-interval"
            value={field.value}
            onChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
    </SettingsField>
  );
}

function AutoCleanReauthMinAgeField({ form, disabled }: { form: SettingsFormApi; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="accounts-auto-clean-reauth-min-age"
      label={t("settings.accounts.autoCleanReauthMinAge")}
      description={t("settings.accounts.autoCleanReauthMinAgeHelp")}
      error={form.formState.errors.accounts?.autoCleanReauthMinAge?.message}
    >
      <Controller
        control={form.control}
        name="accounts.autoCleanReauthMinAge"
        render={({ field }) => (
          <DurationInput
            id="accounts-auto-clean-reauth-min-age"
            value={field.value}
            onChange={field.onChange}
            disabled={disabled}
          />
        )}
      />
    </SettingsField>
  );
}

function AutoCleanIncludeDisabledField({
  form,
  disabled,
  onRequestConfirm,
}: {
  form: SettingsFormApi;
  disabled: boolean;
  onRequestConfirm: (confirm: AutoCleanConfirm) => void;
}) {
  const { t } = useTranslation();
  return (
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
              disabled={disabled}
              onCheckedChange={(checked) => {
                if (checked) {
                  onRequestConfirm("includeDisabled");
                  return;
                }
                field.onChange(false);
              }}
            />
          </div>
        )}
      />
    </SettingsField>
  );
}
