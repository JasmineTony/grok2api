import type { TFunction } from "i18next";
import { useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { DurationInput, SettingsField, SettingsSection } from "@/features/settings/settings-layout";
import {
  MAX_ROUTING_ATTEMPTS,
  type SettingsForm,
  UNLIMITED_ROUTING_ATTEMPTS,
} from "@/features/settings/settings-model";

type SettingsRuntimePoliciesPanelProps = {
  t: TFunction;
  form: UseFormReturn<SettingsForm>;
};

/**
 * Gateway scheduling, audit persistence, and client-key defaults. Keeping these
 * controls separate from service capacity makes policy changes easier to review
 * without changing their underlying form paths or save semantics.
 */
export function SettingsRuntimePoliciesPanel({ t, form }: SettingsRuntimePoliciesPanelProps) {
  const [confirmUnlimited, setConfirmUnlimited] = useState(false);
  const limitedAttempts = useRef(3);
  const segmentedSelectorEnabled = form.watch("routing.segmentedSelector.enabled") === true;

  return (
    <div className="space-y-8">
      <SettingsSection title={t("settings.routing.title")}>
        <div className="space-y-0">
          <SettingsField
            controlId="routing-sticky-ttl"
            label={t("settings.routing.stickyTTL")}
            description={t("settings.routing.stickyTTLHelp")}
            error={form.formState.errors.routing?.stickyTTL?.message}
          >
            <Controller
              control={form.control}
              name="routing.stickyTTL"
              render={({ field }) => (
                <DurationInput
                  id="routing-sticky-ttl"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
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
                <DurationInput
                  id="routing-cooldown-base"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
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
                <DurationInput
                  id="routing-cooldown-max"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="routing-capacity-wait"
            label={t("settings.routing.capacityWait", {
              defaultValue: "Saturated account wait",
            })}
            description={t("settings.routing.capacityWaitHelp")}
            error={form.formState.errors.routing?.capacityWait?.message}
          >
            <Controller
              control={form.control}
              name="routing.capacityWait"
              render={({ field }) => (
                <DurationInput
                  id="routing-capacity-wait"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="routing-max-attempts"
            label={t("settings.routing.maxAttempts")}
            description={t("settingsRoutingAttempts.help")}
            error={form.formState.errors.routing?.maxAttempts?.message}
          >
            <Controller
              control={form.control}
              name="routing.maxAttempts"
              render={({ field }) => {
                const unlimited = field.value === UNLIMITED_ROUTING_ATTEMPTS;
                return (
                  <div className="flex items-center gap-2">
                    <Input
                      id="routing-max-attempts"
                      ref={field.ref}
                      name={field.name}
                      type="number"
                      min={1}
                      max={MAX_ROUTING_ATTEMPTS}
                      disabled={unlimited}
                      value={unlimited || !Number.isFinite(field.value) ? "" : field.value}
                      onBlur={field.onBlur}
                      onChange={(event) => {
                        const value = Number(event.target.value);
                        if (Number.isFinite(value)) {
                          limitedAttempts.current = value;
                          field.onChange(value);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant={unlimited ? "destructive" : "outline"}
                      onClick={() => {
                        if (unlimited) {
                          field.onChange(limitedAttempts.current);
                        } else {
                          limitedAttempts.current =
                            Number.isFinite(field.value) && field.value > 0 ? field.value : 3;
                          setConfirmUnlimited(true);
                        }
                      }}
                    >
                      {unlimited
                        ? t("settingsRoutingAttempts.restoreLimited")
                        : t("settingsRoutingAttempts.unlimited")}
                    </Button>
                  </div>
                );
              }}
            />
          </SettingsField>
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
                  <Switch
                    id="routing-prefer-free-build"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="routing-mark-build-chat-denied-reauth"
            label={t("settings.routing.markBuildChatDeniedAsReauth")}
            description={t("settings.routing.markBuildChatDeniedAsReauthHelp")}
          >
            <Controller
              control={form.control}
              name="routing.markBuildChatDeniedAsReauth"
              render={({ field }) => (
                <div className="flex h-9 items-center">
                  <Switch
                    id="routing-mark-build-chat-denied-reauth"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          </SettingsField>
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
                  <Switch
                    id="routing-account-isolated-connections"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          </SettingsField>
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
                  <Switch
                    id="routing-segmented-selector-enabled"
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                </div>
              )}
            />
          </SettingsField>
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
              disabled={!segmentedSelectorEnabled}
              {...form.register("routing.segmentedSelector.minCandidates", { valueAsNumber: true })}
            />
          </SettingsField>
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
              disabled={!segmentedSelectorEnabled}
              {...form.register("routing.segmentedSelector.windowSize", { valueAsNumber: true })}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <AlertDialog open={confirmUnlimited} onOpenChange={setConfirmUnlimited}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settingsRoutingAttempts.unlimitedTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settingsRoutingAttempts.unlimitedDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                form.setValue("routing.maxAttempts", UNLIMITED_ROUTING_ATTEMPTS, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                });
                setConfirmUnlimited(false);
              }}
            >
              {t("settingsRoutingAttempts.unlimitedConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <SettingsSection title={t("settings.audit.title")}>
        <div className="space-y-0">
          <SettingsField
            controlId="audit-buffer-size"
            label={t("settings.audit.bufferSize")}
            description={t("settings.audit.bufferSizeHelp")}
            badge={t("settings.restartRequired")}
            error={form.formState.errors.audit?.bufferSize?.message}
          >
            <Input
              id="audit-buffer-size"
              type="number"
              min={1}
              max={262_144}
              {...form.register("audit.bufferSize", { valueAsNumber: true })}
            />
          </SettingsField>
          <SettingsField
            controlId="audit-batch-size"
            label={t("settings.audit.batchSize")}
            description={t("settings.audit.batchSizeHelp")}
            error={form.formState.errors.audit?.batchSize?.message}
          >
            <Input
              id="audit-batch-size"
              type="number"
              min={1}
              max={4_096}
              {...form.register("audit.batchSize", { valueAsNumber: true })}
            />
          </SettingsField>
          <SettingsField
            controlId="audit-flush-interval"
            label={t("settings.audit.flushInterval")}
            description={t("settings.audit.flushIntervalHelp")}
            error={form.formState.errors.audit?.flushInterval?.message}
          >
            <Controller
              control={form.control}
              name="audit.flushInterval"
              render={({ field }) => (
                <DurationInput
                  id="audit-flush-interval"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </SettingsField>
          <SettingsField
            controlId="audit-commit-delay"
            label={t("settingsAuditCommitDelay.label")}
            description={t("settingsAuditCommitDelay.help")}
            error={form.formState.errors.audit?.commitDelayMS?.message}
          >
            <Input
              id="audit-commit-delay"
              type="number"
              min={1}
              max={50}
              {...form.register("audit.commitDelayMS", { valueAsNumber: true })}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.clientKeys.title")}>
        <div className="space-y-0">
          <SettingsField
            controlId="client-key-default-rpm"
            label={t("settings.clientKeys.rpmLimit")}
            description={t("settings.clientKeys.rpmLimitHelp")}
            error={form.formState.errors.clientKeyDefaults?.rpmLimit?.message}
          >
            <Input
              id="client-key-default-rpm"
              type="number"
              min={1}
              max={100_000}
              {...form.register("clientKeyDefaults.rpmLimit", { valueAsNumber: true })}
            />
          </SettingsField>
          <SettingsField
            controlId="client-key-default-concurrency"
            label={t("settings.clientKeys.maxConcurrent")}
            description={t("settings.clientKeys.maxConcurrentHelp")}
            error={form.formState.errors.clientKeyDefaults?.maxConcurrent?.message}
          >
            <Input
              id="client-key-default-concurrency"
              type="number"
              min={1}
              max={1_024}
              {...form.register("clientKeyDefaults.maxConcurrent", { valueAsNumber: true })}
            />
          </SettingsField>
        </div>
      </SettingsSection>
    </div>
  );
}
