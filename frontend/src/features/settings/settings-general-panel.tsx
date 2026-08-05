import type { TFunction } from "i18next";
import type { UseFormReturn } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { SettingsField, SettingsSection } from "@/features/settings/settings-layout";
import type { SettingsForm } from "@/features/settings/settings-model";

type SettingsGeneralPanelProps = {
  t: TFunction;
  form: UseFormReturn<SettingsForm>;
};

/**
 * Editable controls that apply to the local service instance and batch work.
 * The shared SettingsRouteShell owns the form so moving to another settings
 * route never discards these values before the complete DTO is saved.
 */
export function SettingsGeneralPanel({ t, form }: SettingsGeneralPanelProps) {
  return (
    <div className="space-y-8">
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
    </div>
  );
}
