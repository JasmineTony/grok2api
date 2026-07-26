import { useTranslation } from "react-i18next";

import { SettingsAccountMaintenancePanel } from "@/features/settings/settings-account-maintenance-panel";
import { SettingsPoliciesPanel } from "@/features/settings/settings-policies-panel";
import { useSettingsRoute } from "@/features/settings/settings-route-context";
import { VersionUpdateSection } from "@/features/system";

export function SettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();
  return (
    <div className="space-y-8">
      <SettingsPoliciesPanel t={t} form={form} />
      <SettingsAccountMaintenancePanel t={t} form={form} />
      <VersionUpdateSection />
    </div>
  );
}
