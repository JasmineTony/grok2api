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

export function SettingsAuditPane({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsPane value="audit">
      <SettingsSection testId="settings-section-audit-retention" title={t("settings.audit.retentionTitle")}>
        <div className="space-y-0">
          <AuditRetentionDaysField form={form} />
        </div>
      </SettingsSection>
      <SettingsSection testId="settings-section-audit-performance" title={t("settings.audit.performanceTitle")}>
        <div className="space-y-0">
          <AuditBufferSizeField form={form} />
          <AuditBatchSizeField form={form} />
          <AuditFlushIntervalField form={form} />
          <AuditCommitDelayField form={form} />
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}

function AuditRetentionDaysField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="audit-retention-days"
      label={t("settings.audit.retentionDays")}
      description={t("settings.audit.retentionDaysHelp")}
      error={form.formState.errors.audit?.retentionDays?.message}
    >
      <Input
        id="audit-retention-days"
        type="number"
        min={0}
        max={365}
        {...form.register("audit.retentionDays", { valueAsNumber: true })}
      />
    </SettingsField>
  );
}

function AuditBufferSizeField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function AuditBatchSizeField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
  );
}

function AuditFlushIntervalField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
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
          <DurationInput id="audit-flush-interval" value={field.value} onChange={field.onChange} />
        )}
      />
    </SettingsField>
  );
}

function AuditCommitDelayField({ form }: { form: SettingsFormApi }) {
  const { t } = useTranslation();
  return (
    <SettingsField
      controlId="audit-commit-delay"
      label={t("settings.audit.commitDelay")}
      description={t("settings.audit.commitDelayHelp")}
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
  );
}
