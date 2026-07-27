import { useTranslation } from "react-i18next";

import { VersionChangelogSection } from "@/entities/system/version-update";

export function ChangelogSettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex min-h-8 items-center px-1">
          <h2 className="text-sm font-medium tracking-tight">{t("settings.changelog.title")}</h2>
        </div>
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
          {t("settings.changelog.description")}
        </p>
      </section>
      <VersionChangelogSection />
    </div>
  );
}
