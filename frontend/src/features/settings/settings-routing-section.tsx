import { useRef, useState, type Ref } from "react";
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
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DurationInput,
  SettingsField,
  SettingsSection,
  type SettingsFormApi,
} from "@/features/settings/settings-form-layout";
import { MAX_ROUTING_ATTEMPTS, UNLIMITED_ROUTING_ATTEMPTS } from "@/features/settings/settings-schema";

export function SettingsRoutingSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  const segmentedSelectorEnabled = form.watch("routing.segmentedSelector.enabled") === true;
  return (
    <SettingsSection testId="settings-section-routing" title={t("settings.routing.title")}>
      <div className="space-y-0">
        <RoutingStickyTTLField form={form} />
        <RoutingCooldownBaseField form={form} />
        <RoutingCooldownMaxField form={form} />
        <RoutingCapacityWaitField form={form} />
        <RoutingMaxAttemptsField form={form} />
        <RoutingVideoMaxAttemptsField form={form} />
        <RoutingPreferFreeBuildField form={form} />
        <RoutingMarkBuildChatDeniedAsReauthField form={form} />
        <RoutingAccountIsolatedConnectionsField form={form} />
        <RoutingSegmentedSelectorEnabledField form={form} />
        <RoutingSegmentedMinCandidatesField form={form} disabled={!segmentedSelectorEnabled} />
        <RoutingSegmentedWindowSizeField form={form} disabled={!segmentedSelectorEnabled} />
      </div>
    </SettingsSection>
  );
}

function RoutingAttemptsInput({
  id,
  name,
  value,
  inputRef,
  onBlur,
  onChange,
  blankWhenNonPositive,
  onToggleUnlimited,
}: {
  id: string;
  name: string;
  value: number;
  inputRef: Ref<HTMLInputElement>;
  onBlur: () => void;
  onChange: (value: number) => void;
  blankWhenNonPositive: boolean;
  onToggleUnlimited: (checked: boolean, value: number) => void;
}) {
  const { t } = useTranslation();
  const unlimited = value === UNLIMITED_ROUTING_ATTEMPTS;
  const blank = unlimited || !Number.isFinite(value) || (blankWhenNonPositive && value <= 0);
  return (
    <div className="flex h-9 items-center gap-3">
      <Input
        id={id}
        ref={inputRef}
        name={name}
        type="number"
        min={1}
        max={MAX_ROUTING_ATTEMPTS}
        disabled={unlimited}
        value={blank ? "" : value}
        placeholder={t("settingsRoutingAttempts.unlimited")}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
      />
      <div className="flex shrink-0 items-center gap-2">
        <span className="text-xs text-muted-foreground">{t("settingsRoutingAttempts.unlimited")}</span>
        <Switch
          id={`${id}-unlimited`}
          aria-label={t("settingsRoutingAttempts.unlimited")}
          checked={unlimited}
          onCheckedChange={(checked) => onToggleUnlimited(checked, value)}
        />
      </div>
    </div>
  );
}

function UnlimitedAttemptsDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("settingsRoutingAttempts.unlimitedTitle")}</AlertDialogTitle>
          <AlertDialogDescription>{t("settingsRoutingAttempts.unlimitedDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            data-testid="settings-unlimited-attempts-confirm"
            className="bg-destructive text-white hover:bg-destructive/90"
            onClick={onConfirm}
          >
            {t("settingsRoutingAttempts.unlimitedConfirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RoutingMaxAttemptsField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  const limitedAttemptsRef = useRef(3);
  return (
    <SettingsField
      controlId="routing-max-attempts"
      label={t("settings.routing.maxAttempts")}
      description={t("settingsRoutingAttempts.help")}
      error={form.formState.errors.routing?.maxAttempts?.message}
    >
      <Controller
        control={form.control}
        name="routing.maxAttempts"
        render={({ field }) => (
          <RoutingAttemptsInput
            id="routing-max-attempts"
            name={field.name}
            value={field.value}
            inputRef={field.ref}
            onBlur={field.onBlur}
            onChange={field.onChange}
            blankWhenNonPositive={false}
            onToggleUnlimited={(checked, value) => {
              if (checked) {
                if (value > 0) limitedAttemptsRef.current = value;
                setConfirm(true);
                return;
              }
              field.onChange(limitedAttemptsRef.current);
            }}
          />
        )}
      />
      <UnlimitedAttemptsDialog
        open={confirm}
        onOpenChange={setConfirm}
        onConfirm={() => {
          form.setValue("routing.maxAttempts", UNLIMITED_ROUTING_ATTEMPTS, {
            shouldDirty: true,
            shouldTouch: true,
            shouldValidate: true,
          });
          setConfirm(false);
        }}
      />
    </SettingsField>
  );
}

function RoutingVideoMaxAttemptsField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  const limitedAttemptsRef = useRef(999);
  return (
    <SettingsField
      controlId="routing-video-max-attempts"
      label={t("settings.routing.videoMaxAttempts")}
      description={t("settings.routing.videoMaxAttemptsHelp")}
      error={form.formState.errors.routing?.videoMaxAttempts?.message}
    >
      <Controller
        control={form.control}
        name="routing.videoMaxAttempts"
        render={({ field }) => (
          <RoutingAttemptsInput
            id="routing-video-max-attempts"
            name={field.name}
            value={field.value}
            inputRef={field.ref}
            onBlur={field.onBlur}
            onChange={field.onChange}
            blankWhenNonPositive
            onToggleUnlimited={(checked, value) => {
              if (checked) {
                if (value > 0) limitedAttemptsRef.current = value;
                field.onChange(UNLIMITED_ROUTING_ATTEMPTS);
                return;
              }
              field.onChange(limitedAttemptsRef.current);
            }}
          />
        )}
      />
    </SettingsField>
  );
}

function RoutingStickyTTLField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-sticky-ttl"
      label={t("settings.routing.stickyTTL")}
      description={t("settings.routing.stickyTTLHelp")}
      error={form.formState.errors.routing?.stickyTTL?.message}
    >
      <Controller
        control={form.control}
        name="routing.stickyTTL"
        render={({ field }) => <DurationInput id="routing-sticky-ttl" value={field.value} onChange={field.onChange} />}
      />
    </SettingsField>
  );
}

function RoutingCooldownBaseField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-cooldown-base"
      label={t("settings.routing.cooldownBase")}
      description={t("settings.routing.cooldownBaseHelp")}
      error={form.formState.errors.routing?.cooldownBase?.message}
    >
      <Controller
        control={form.control}
        name="routing.cooldownBase"
        render={({ field }) => (
          <DurationInput id="routing-cooldown-base" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function RoutingCooldownMaxField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-cooldown-max"
      label={t("settings.routing.cooldownMax")}
      description={t("settings.routing.cooldownMaxHelp")}
      error={form.formState.errors.routing?.cooldownMax?.message}
    >
      <Controller
        control={form.control}
        name="routing.cooldownMax"
        render={({ field }) => (
          <DurationInput id="routing-cooldown-max" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function RoutingCapacityWaitField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-capacity-wait"
      label={t("settings.routing.capacityWait", { defaultValue: "Saturated account wait" })}
      description={t("settings.routing.capacityWaitHelp")}
      error={form.formState.errors.routing?.capacityWait?.message}
    >
      <Controller
        control={form.control}
        name="routing.capacityWait"
        render={({ field }) => (
          <DurationInput id="routing-capacity-wait" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function RoutingPreferFreeBuildField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-prefer-free-build"
      label={t("settings.routing.preferFreeBuild")}
      description={t("settings.routing.preferFreeBuildHelp")}
    >
      <Controller
        control={form.control}
        name="routing.preferFreeBuild"
        render={({ field }) => (
          <div className="flex h-9 items-center">
            <Switch id="routing-prefer-free-build" checked={field.value} onCheckedChange={field.onChange} />
          </div>
        )}
      />
    </SettingsField>
  );
}

function RoutingMarkBuildChatDeniedAsReauthField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-mark-build-chat-denied-as-reauth"
      label={t("settings.routing.markBuildChatDeniedAsReauth")}
      description={t("settings.routing.markBuildChatDeniedAsReauthHelp")}
    >
      <Controller
        control={form.control}
        name="routing.markBuildChatDeniedAsReauth"
        render={({ field }) => (
          <div className="flex h-9 items-center">
            <Switch
              id="routing-mark-build-chat-denied-as-reauth"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </div>
        )}
      />
    </SettingsField>
  );
}

function RoutingAccountIsolatedConnectionsField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-account-isolated-connections"
      label={t("settings.routing.accountIsolatedConnections")}
      description={t("settings.routing.accountIsolatedConnectionsHelp")}
    >
      <Controller
        control={form.control}
        name="routing.accountIsolatedConnections"
        render={({ field }) => (
          <div className="flex h-9 items-center">
            <Switch id="routing-account-isolated-connections" checked={field.value} onCheckedChange={field.onChange} />
          </div>
        )}
      />
    </SettingsField>
  );
}

function RoutingSegmentedSelectorEnabledField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-segmented-selector-enabled"
      label={t("settingsRoutingSegmented.enabled")}
      description={t("settingsRoutingSegmented.enabledHelp")}
    >
      <Controller
        control={form.control}
        name="routing.segmentedSelector.enabled"
        render={({ field }) => (
          <div className="flex h-9 items-center">
            <Switch id="routing-segmented-selector-enabled" checked={field.value} onCheckedChange={field.onChange} />
          </div>
        )}
      />
    </SettingsField>
  );
}

function RoutingSegmentedMinCandidatesField({ form, disabled }: { form: SettingsFormApi; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-segmented-min-candidates"
      label={t("settingsRoutingSegmented.minCandidates")}
      description={t("settingsRoutingSegmented.minCandidatesHelp")}
      error={form.formState.errors.routing?.segmentedSelector?.minCandidates?.message}
    >
      <Input
        id="routing-segmented-min-candidates"
        type="number"
        min={100}
        max={1_000_000}
        disabled={disabled}
        {...form.register("routing.segmentedSelector.minCandidates", { valueAsNumber: true })}
      />
    </SettingsField>
  );
}

function RoutingSegmentedWindowSizeField({ form, disabled }: { form: SettingsFormApi; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="routing-segmented-window-size"
      label={t("settingsRoutingSegmented.windowSize")}
      description={t("settingsRoutingSegmented.windowSizeHelp")}
      error={form.formState.errors.routing?.segmentedSelector?.windowSize?.message}
    >
      <Input
        id="routing-segmented-window-size"
        type="number"
        min={8}
        max={256}
        disabled={disabled}
        {...form.register("routing.segmentedSelector.windowSize", { valueAsNumber: true })}
      />
    </SettingsField>
  );
}
