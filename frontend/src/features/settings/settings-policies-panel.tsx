import type { TFunction } from "i18next";
import { Controller, type UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DurationInput,
  SettingsField,
  SettingsPane,
  SettingsSection,
} from "@/features/settings/settings-layout";
import type { SettingsForm } from "@/features/settings/settings-model";

type SettingsPoliciesPanelProps = {
  t: TFunction;
  form: UseFormReturn<SettingsForm>;
};

export function SettingsPoliciesPanel({ t, form }: SettingsPoliciesPanelProps) {
  return (
    <SettingsPane value="policies">
      <SettingsSection title={t("settings.server.title")}>
        <div className="space-y-0">
          <SettingsField
            controlId="server-max-concurrent-requests"
            label={t("settings.server.maxConcurrentRequests")}
            description={t("settings.server.maxConcurrentRequestsHelp")}
            error={form.formState.errors.server?.maxConcurrentRequests?.message}
          >
            <Input
              id="server-max-concurrent-requests"
              type="number"
              min={1}
              max={100_000}
              {...form.register("server.maxConcurrentRequests", { valueAsNumber: true })}
            />
          </SettingsField>
        </div>
      </SettingsSection>

      <SettingsSection title={t("settings.batch.title")}>
        <div className="space-y-0">
          <SettingsField
            controlId="batch-import-concurrency"
            label={t("settings.batch.importConcurrency")}
            description={t("settings.batch.importConcurrencyHelp")}
            error={form.formState.errors.batch?.importConcurrency?.message}
          >
            <Input
              id="batch-import-concurrency"
              type="number"
              min={1}
              max={50}
              {...form.register("batch.importConcurrency", { valueAsNumber: true })}
            />
          </SettingsField>
          <SettingsField
            controlId="batch-conversion-concurrency"
            label={t("settings.batch.conversionConcurrency")}
            description={t("settings.batch.conversionConcurrencyHelp")}
            error={form.formState.errors.batch?.conversionConcurrency?.message}
          >
            <Input
              id="batch-conversion-concurrency"
              type="number"
              min={1}
              max={50}
              {...form.register("batch.conversionConcurrency", { valueAsNumber: true })}
            />
          </SettingsField>
          <SettingsField
            controlId="batch-sync-concurrency"
            label={t("settings.batch.syncConcurrency")}
            description={t("settings.batch.syncConcurrencyHelp")}
            error={form.formState.errors.batch?.syncConcurrency?.message}
          >
            <Input
              id="batch-sync-concurrency"
              type="number"
              min={1}
              max={50}
              {...form.register("batch.syncConcurrency", { valueAsNumber: true })}
            />
          </SettingsField>
          <SettingsField
            controlId="batch-refresh-concurrency"
            label={t("settings.batch.refreshConcurrency")}
            description={t("settings.batch.refreshConcurrencyHelp")}
            error={form.formState.errors.batch?.refreshConcurrency?.message}
          >
            <Input
              id="batch-refresh-concurrency"
              type="number"
              min={1}
              max={50}
              {...form.register("batch.refreshConcurrency", { valueAsNumber: true })}
            />
          </SettingsField>
          <SettingsField
            controlId="batch-random-delay"
            label={t("settings.batch.randomDelay")}
            description={t("settings.batch.randomDelayHelp")}
            error={form.formState.errors.batch?.randomDelay?.message}
          >
            <Input
              id="batch-random-delay"
              type="number"
              min={0}
              max={5_000}
              step={10}
              {...form.register("batch.randomDelay", { valueAsNumber: true })}
            />
          </SettingsField>
        </div>
      </SettingsSection>

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
            description={t("settings.routing.maxAttemptsHelp")}
            error={form.formState.errors.routing?.maxAttempts?.message}
          >
            <Input
              id="routing-max-attempts"
              type="number"
              min={1}
              max={10}
              {...form.register("routing.maxAttempts", { valueAsNumber: true })}
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
        </div>
      </SettingsSection>

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
    </SettingsPane>
  );
}
