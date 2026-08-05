import { useTranslation } from "react-i18next";

import { SettingsGeneralPanel } from "@/features/settings/settings-general-panel";
import { useSettingsRoute } from "@/features/settings/settings-route-context";

/** Compatible `/settings` route for instance capacity and batch-task controls. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { form } = useSettingsRoute();
  return <SettingsGeneralPanel t={t} form={form} />;
}
