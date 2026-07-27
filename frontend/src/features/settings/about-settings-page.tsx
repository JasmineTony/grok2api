import { Code2, GitFork, Scale } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { VersionAboutSection } from "@/entities/system/version-update";

export function AboutSettingsPage() {
  const { t } = useTranslation();
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex min-h-8 items-center px-1">
          <h2 className="text-sm font-medium tracking-tight">{t("settings.about.title")}</h2>
        </div>
        <p className="max-w-3xl text-xs leading-5 text-muted-foreground">
          {t("settings.about.description")}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href="https://github.com/JasmineTony/grok2api" target="_blank" rel="noreferrer">
              <Code2 />
              {t("settings.about.maintainedRepository")}
            </a>
          </Button>
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href="https://github.com/chenyme/grok2api" target="_blank" rel="noreferrer">
              <GitFork />
              {t("settings.about.upstreamRepository")}
            </a>
          </Button>
          <span className="flex items-center gap-2 px-2 text-xs text-muted-foreground">
            <Scale className="size-4" />
            {t("updates.noteTitle")}
          </span>
        </div>
      </section>
      <VersionAboutSection />
    </div>
  );
}
