import { useTranslation } from "react-i18next";

import { SettingsAccountMaintenancePanel } from "@/features/settings/settings-account-maintenance-panel";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

/** Dedicated route for reauthentication policy and account retention automation. */
export function AccountMaintenanceSettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();
  return <SettingsAccountMaintenancePanel t={t} form={form} />;
}
