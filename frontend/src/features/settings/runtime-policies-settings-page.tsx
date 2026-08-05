import { useTranslation } from "react-i18next";

import { SettingsRuntimePoliciesPanel } from "@/features/settings/settings-policies-panel";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

/** Dedicated route for routing, audit, and client-key runtime policy controls. */
export function RuntimePoliciesSettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();
  return <SettingsRuntimePoliciesPanel t={t} form={form} />;
}
