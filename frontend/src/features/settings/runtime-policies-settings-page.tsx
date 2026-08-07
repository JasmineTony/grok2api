import { useTranslation } from "react-i18next";

import { SettingsGeneralPanel } from "@/features/settings/settings-general-panel";
import { SettingsRuntimePoliciesPanel } from "@/features/settings/settings-policies-panel";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

/**
 * Upstream-aligned operational route. Service capacity and batch controls are
 * retained here ahead of routing, audit, and client-key policies.
 */
export function RuntimePoliciesSettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();
  return (
    <div className="space-y-8">
      <SettingsGeneralPanel t={t} form={form} />
      <SettingsRuntimePoliciesPanel t={t} form={form} />
    </div>
  );
}
