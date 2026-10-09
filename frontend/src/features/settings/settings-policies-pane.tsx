import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import {
  SettingsField,
  SettingsPane,
  SettingsSection,
  type SettingsFormApi,
} from "@/features/settings/settings-form-layout";
import { SettingsRoutingSection } from "@/features/settings/settings-routing-section";

export function SettingsPoliciesPane({ form }: { form: SettingsFormApi }) {
  return (
    <SettingsPane value="policies">
      <SettingsServerSection form={form} />
      <SettingsBatchSection form={form} />
      <SettingsRoutingSection form={form} />
      <SettingsClientKeysSection form={form} />
    </SettingsPane>
  );
}

function SettingsServerSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsSection testId="settings-section-server" title={t("settings.server.title")}>
      <div className="space-y-0">
        <ServerMaxConcurrentRequestsField form={form} />
      </div>
    </SettingsSection>
  );
}

function SettingsBatchSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsSection testId="settings-section-batch" title={t("settings.batch.title")}>
      <div className="space-y-0">
        <BatchImportConcurrencyField form={form} />
        <BatchConversionConcurrencyField form={form} />
        <BatchSyncConcurrencyField form={form} />
        <BatchRefreshConcurrencyField form={form} />
        <BatchRandomDelayField form={form} />
      </div>
    </SettingsSection>
  );
}

function SettingsClientKeysSection({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsSection testId="settings-section-client-keys" title={t("settings.clientKeys.title")}>
      <div className="space-y-0">
        <ClientKeyDefaultRPMField form={form} />
        <ClientKeyDefaultConcurrencyField form={form} />
      </div>
    </SettingsSection>
  );
}

function ServerMaxConcurrentRequestsField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function BatchImportConcurrencyField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function BatchConversionConcurrencyField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function BatchSyncConcurrencyField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function BatchRefreshConcurrencyField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function BatchRandomDelayField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function ClientKeyDefaultRPMField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function ClientKeyDefaultConcurrencyField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}
