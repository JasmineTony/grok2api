import { Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { SettingsAccountsPane } from "@/features/settings/settings-accounts-pane";
import { SettingsAuditPane } from "@/features/settings/settings-audit-pane";
import { SettingsBuildPane } from "@/features/settings/settings-build-pane";
import { SettingsConsolePane } from "@/features/settings/settings-console-pane";
import { SettingsDeliveryPane } from "@/features/settings/settings-delivery-pane";
import { SettingsPane } from "@/features/settings/settings-form-layout";
import { SettingsPageHeader, SettingsTabsList } from "@/features/settings/settings-page-tabs";
import { SettingsPoliciesPane } from "@/features/settings/settings-policies-pane";
import { SettingsWebPane } from "@/features/settings/settings-web-pane";
import { useSettings } from "@/features/settings/use-settings";
import { VersionUpdateSection } from "@/features/system/version-update";
import { ErrorState } from "@/shared/components/data-state";

export function SettingsPage() {
  const { form, settingsQuery, updateMutation, reset } = useSettings();

  if (settingsQuery.isError) {
    return <ErrorState message={settingsQuery.error.message} onRetry={() => void settingsQuery.refetch()} />;
  }

  const snapshot = settingsQuery.data;
  const loading = settingsQuery.isPending;
  const pending = updateMutation.isPending;
  const disabled = loading || pending || !form.formState.isDirty;

  return (
    <form className="w-full space-y-5" onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}>
      <SettingsPageHeader disabled={disabled} pending={pending} onReset={reset} />
      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : null}
      {snapshot ? (
        <Tabs defaultValue="build" className="flex min-w-0 flex-col gap-7 lg:flex-row lg:items-start">
          <SettingsTabsList />
          <div className="min-w-0 flex-1">
            <SettingsBuildPane
              form={form}
              disabled={loading || pending}
              recommended={snapshot.recommendedProviderBuild}
            />
            <SettingsWebPane form={form} />
            <SettingsConsolePane form={form} />
            <SettingsDeliveryPane form={form} serverClearanceMode={snapshot.config.providerWeb.clearanceMode} />
            <SettingsPoliciesPane form={form} />
            <SettingsAuditPane form={form} />
            <SettingsAccountsPane form={form} />
            <SettingsPane value="about">
              <VersionUpdateSection />
            </SettingsPane>
          </div>
        </Tabs>
      ) : null}
    </form>
  );
}
